#!/usr/bin/env python3
import hashlib
import json
import logging
import os
import signal
import sys
import time
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import requests
from kafka import KafkaConsumer
from kafka.errors import KafkaError


def load_env_file(path: str) -> None:
    if not path or not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file(os.getenv("ENV_FILE", ".env"))

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(message)s",
)
LOG = logging.getLogger("graylog-alert-consumer")

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "172.17.33.153:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "graylog-alerts")
KAFKA_GROUP_ID = os.getenv("KAFKA_GROUP_ID", "thehive-docker-172-17-33-200")
KAFKA_AUTO_OFFSET_RESET = os.getenv("KAFKA_AUTO_OFFSET_RESET", "latest")
KAFKA_MAX_POLL_RECORDS = int(os.getenv("KAFKA_MAX_POLL_RECORDS", "25"))

THEHIVE_URL = os.getenv("THEHIVE_URL", "http://127.0.0.1:9000").rstrip("/")
THEHIVE_API_KEY = os.getenv("THEHIVE_API_KEY", "")
THEHIVE_ORG = os.getenv("THEHIVE_ORG", "")
VERIFY_SSL = os.getenv("VERIFY_SSL", "false").lower() in {"1", "true", "yes"}

GRAYLOG_URL = os.getenv("GRAYLOG_URL", "http://172.17.33.153:9000").rstrip("/")
ALERT_SOURCE = os.getenv("ALERT_SOURCE", "Graylog/Wazuh")
ALERT_TYPE = os.getenv("ALERT_TYPE", "external")
DEFAULT_TLP = int(os.getenv("DEFAULT_TLP", "2"))
DEFAULT_PAP = int(os.getenv("DEFAULT_PAP", "2"))

STOP = False


def stop(signum: int, _frame: Any) -> None:
    global STOP
    STOP = True
    LOG.info("received signal %s, stopping after current batch", signum)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)


def first_present(mapping: Dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        if key in mapping and mapping[key] not in (None, ""):
            return mapping[key]
    return None


def clean_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text in {"N/A", "None", "none", "unknown", "Unknown", "null"}:
        return None
    return text


def split_tags(value: Any) -> List[str]:
    text = clean_value(value)
    if not text:
        return []
    return [part.strip() for part in text.split(",") if part.strip()]


def severity_from_rule_level(value: Any) -> int:
    try:
        level = int(value)
    except (TypeError, ValueError):
        return 2
    if level >= 12:
        return 4
    if level >= 10:
        return 3
    if level >= 7:
        return 2
    return 1


def add_artifact(
    artifacts: List[Dict[str, Any]],
    seen: Set[Tuple[str, str]],
    data_type: str,
    data: Any,
    tags: List[str],
    message: Optional[str] = None,
) -> None:
    value = clean_value(data)
    if not value:
        return
    key = (data_type, value)
    if key in seen:
        return
    seen.add(key)
    artifact = {"dataType": data_type, "data": value, "tags": tags}
    if message:
        artifact["message"] = message
    artifacts.append(artifact)


def flatten(prefix: str, value: Any, output: Dict[str, Any]) -> None:
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            next_key = f"{prefix}_{child_key}" if prefix else str(child_key)
            flatten(next_key, child_value, output)
    else:
        output[prefix] = value


def message_fields(message: Dict[str, Any]) -> Dict[str, Any]:
    fields: Dict[str, Any] = {}
    if isinstance(message.get("fields"), dict):
        fields.update(message["fields"])
    raw_message = message.get("message")
    if isinstance(raw_message, str) and raw_message.strip().startswith("{"):
        try:
            decoded = json.loads(raw_message)
            flatten("", decoded, fields)
        except json.JSONDecodeError:
            pass
    for key, value in message.items():
        if key not in {"fields", "message"}:
            fields.setdefault(key, value)
    return fields


FIELD_ALIASES = {
    "rule_description": ("rule_description", "Rule_Description", "Rule description", "description", "Description"),
    "rule_level": ("rule_level", "Rule_Level", "Level", "level"),
    "rule_firedtimes": ("rule_firedtimes", "rule_fired_times", "Fired_times", "Fired Times", "firedtimes"),
    "rule_frequency": ("rule_frequency", "Rule_Frequency", "Frequency"),
    "rule_id": ("rule_id", "Rule_ID", "Rule ID", "ID_rule"),
    "agent_name": ("agent_name", "Agent_Name", "Agent", "agent", "hostname", "Host", "host"),
    "agent_id": ("agent_id", "Agent_ID", "Agent ID"),
    "agent_ip": ("agent_ip", "Agent_IP", "Agent IP"),
    "agent_group": ("agent_labels_agent_group", "agent_group", "Agent_Group", "Agent Group"),
    "data_srcip": ("data_srcip", "src_ip", "source_ip", "Source_IP", "Source IP"),
    "data_dstip": ("data_dstip", "dst_ip", "destination_ip", "Destination_IP", "Destination IP"),
    "data_srcport": ("data_srcport", "src_port", "Source_Port", "Source Port"),
    "data_dstuser": ("data_dstuser", "dst_user", "target_user", "Target_User", "Target user"),
    "decoder_name": ("decoder_name", "Decoder_Name", "Decoder", "decoder"),
    "rule_mitre_tactic": ("rule_mitre_tactic", "mitre_tactic", "threat_tactic", "Mitre", "MITRE", "Tactic"),
    "rule_mitre_technique": ("rule_mitre_technique", "mitre_technique", "threat_technique", "Technique"),
    "rule_mitre_id": ("rule_mitre_id", "mitre_id", "threat_id", "MITRE_ID", "Mitre_ID", "Technique_ID"),
    "full_log": ("full_log", "Full_log", "Full Log", "message"),
    "previous_output": ("previous_output", "Previous_output", "Previous Output"),
    "url": ("data_url", "url", "URL", "Url"),
}


def normalize_wazuh_fields(fields: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(fields)
    lower_lookup = {str(key).lower(): value for key, value in fields.items()}
    for target, aliases in FIELD_ALIASES.items():
        if clean_value(normalized.get(target)):
            continue
        for alias in aliases:
            if alias in fields and clean_value(fields.get(alias)):
                normalized[target] = fields[alias]
                break
            lowered = alias.lower()
            if lowered in lower_lookup and clean_value(lower_lookup[lowered]):
                normalized[target] = lower_lookup[lowered]
                break
    return normalized


def looks_like_wazuh(fields: Dict[str, Any]) -> bool:
    markers = (
        "rule_description",
        "rule_level",
        "rule_id",
        "agent_name",
        "agent_ip",
        "data_srcip",
        "decoder_name",
        "rule_mitre_tactic",
        "full_log",
    )
    return any(clean_value(fields.get(key)) for key in markers)


def build_wazuh_description(fields: Dict[str, Any], event_title: str, message: Dict[str, Any]) -> str:
    lines: List[str] = []
    lines.append(f"## {clean_value(fields.get('rule_description')) or event_title or 'Graylog Alert'}")
    lines.append("")

    level_parts = []
    if clean_value(fields.get("rule_level")):
        level_parts.append(f"**Level:** {fields['rule_level']}")
    if clean_value(fields.get("rule_firedtimes")):
        level_parts.append(f"**Fired times:** {fields['rule_firedtimes']}")
    if clean_value(fields.get("rule_frequency")):
        level_parts.append(f"**Frequency:** {fields['rule_frequency']}")
    if level_parts:
        lines.append(" | ".join(level_parts))
    if clean_value(fields.get("rule_id")):
        lines.append(f"**Rule ID:** {fields['rule_id']}")
    lines.append("")

    agent_lines = []
    if clean_value(fields.get("agent_name")):
        entry = f"- **Name:** {fields['agent_name']}"
        if clean_value(fields.get("agent_id")):
            entry += f" (ID: {fields['agent_id']})"
        agent_lines.append(entry)
    if clean_value(fields.get("agent_ip")):
        agent_lines.append(f"- **IP:** {fields['agent_ip']}")
    if clean_value(fields.get("agent_group")):
        agent_lines.append(f"- **Group:** {fields['agent_group']}")
    if agent_lines:
        lines.append("### Agent")
        lines.extend(agent_lines)
        lines.append("")

    attack_lines = []
    if clean_value(fields.get("data_srcip")):
        attack_lines.append(f"- **IP:** {fields['data_srcip']}")
    if clean_value(fields.get("data_srcport")):
        attack_lines.append(f"- **Port:** {fields['data_srcport']}")
    if clean_value(fields.get("data_dstuser")):
        attack_lines.append(f"- **Target user:** {fields['data_dstuser']}")
    if clean_value(fields.get("data_dstip")):
        attack_lines.append(f"- **Destination IP:** {fields['data_dstip']}")
    if clean_value(fields.get("decoder_name")):
        attack_lines.append(f"- **Decoder:** {fields['decoder_name']}")
    if attack_lines:
        lines.append("### Attack origin")
        lines.extend(attack_lines)
        lines.append("")

    mitre_lines = []
    if clean_value(fields.get("rule_mitre_tactic")):
        mitre_lines.append(f"- **Tactic:** {fields['rule_mitre_tactic']}")
    if clean_value(fields.get("rule_mitre_technique")) or clean_value(fields.get("rule_mitre_id")):
        technique = clean_value(fields.get("rule_mitre_technique")) or ""
        mitre_id = clean_value(fields.get("rule_mitre_id")) or ""
        entry = f"- **Technique:** {technique}".rstrip()
        if mitre_id:
            entry += f" ({mitre_id})"
        mitre_lines.append(entry)
    if mitre_lines:
        lines.append("### MITRE ATT&CK")
        lines.extend(mitre_lines)
        lines.append("")

    if clean_value(fields.get("full_log")):
        lines.append("### Log")
        lines.append(f"```\n{fields['full_log']}\n```")
        lines.append("")
    if clean_value(fields.get("previous_output")):
        lines.append("### Previous logs")
        lines.append(f"```\n{fields['previous_output']}\n```")
        lines.append("")

    index = message.get("index") or fields.get("index")
    msg_id = message.get("id") or fields.get("id") or fields.get("gl2_message_id")
    if index and msg_id:
        lines.append(f"[View in Graylog]({GRAYLOG_URL}/messages/{index}/{msg_id})")

    return "\n".join(lines).strip()


def build_generic_description(event_title: str, payload: Dict[str, Any]) -> str:
    lines = [f"Alert Condition:\n{event_title}", "", "Matching messages:"]
    for message in payload.get("backlog") or []:
        if not isinstance(message, dict):
            continue
        fields = message_fields(message)
        source = message.get("source") or fields.get("source") or "unknown"
        index = message.get("index") or fields.get("index")
        msg_id = message.get("id") or fields.get("id") or fields.get("gl2_message_id")
        lines.extend(["", "---", "", f"**Source:** {source}"])
        if index and msg_id:
            lines.append(f"**Log URL:** {GRAYLOG_URL}/messages/{index}/{msg_id}")
        lines.append("")
        for key in sorted(fields):
            if key in {"message", "source"}:
                continue
            try:
                rendered = json.dumps(fields[key], ensure_ascii=False)
            except TypeError:
                rendered = str(fields[key])
            lines.append(f"**{key}:** {rendered}")
        lines.extend(["", "**Raw Message:**", "", "```", json.dumps(message, ensure_ascii=False), "```"])
    return "\n".join(lines)


def wazuh_title(fields: Dict[str, Any], event_title: str) -> str:
    rule_desc = clean_value(fields.get("rule_description")) or event_title or "Graylog Alert"
    agent = clean_value(fields.get("agent_name")) or "unknown"
    title = f"[{agent}] {rule_desc}"
    src_ip = clean_value(fields.get("data_srcip"))
    if src_ip:
        title += f" from {src_ip}"
    return title


def normalize_graylog_payload(envelope: Dict[str, Any]) -> Tuple[str, Dict[str, Any], List[str]]:
    payload = envelope.get("payload") if isinstance(envelope.get("payload"), dict) else envelope
    source_ref_material: List[str] = []

    event_title = (
        envelope.get("event_definition_title")
        or payload.get("event_definition_title")
        or "Graylog Alert"
    )
    event_dto = payload.get("event_dto")
    if isinstance(event_dto, dict):
        event_title = str(event_dto.get("message") or event_title)
        source_ref_material.extend(
            str(value)
            for value in (
                event_dto.get("id"),
                event_dto.get("key"),
                event_dto.get("origin_context"),
                event_dto.get("timestamp"),
            )
            if value not in (None, "")
        )

    # Graylog HTTP notifications include both an event DTO and a backlog. The
    # event DTO often contains only reduced custom fields; the backlog carries
    # the original Wazuh fields used by the old .104 parser.
    if isinstance(payload.get("backlog"), list) and payload.get("backlog"):
        payload.setdefault("event_definition_title", event_title)
        return str(event_title), payload, source_ref_material

    if isinstance(event_dto, dict):
        fields = event_dto.get("fields") if isinstance(event_dto.get("fields"), dict) else {}
        message = dict(fields)
        message.setdefault("source", event_dto.get("source"))
        message.setdefault("timestamp", event_dto.get("timestamp"))
        message.setdefault("id", event_dto.get("id"))
        message.setdefault("event_key", event_dto.get("key"))
        message.setdefault("origin_context", event_dto.get("origin_context"))
        message.setdefault("event_definition_id", event_dto.get("event_definition_id"))
        return event_title, {"backlog": [message], "event_definition_title": event_title}, source_ref_material

    return str(event_title), payload, source_ref_material


def build_alert(envelope: Dict[str, Any]) -> Dict[str, Any]:
    event_title, payload, source_ref_material = normalize_graylog_payload(envelope)

    tags = ["graylog", "graylog-alerts"]
    artifacts: List[Dict[str, Any]] = []
    seen_artifacts: Set[Tuple[str, str]] = set()
    max_rule_level = None
    best_wazuh_fields: Optional[Dict[str, Any]] = None
    best_wazuh_message: Dict[str, Any] = {}
    source_ref_material = [event_title] + source_ref_material

    for message in payload.get("backlog") or []:
        if not isinstance(message, dict):
            continue
        fields = normalize_wazuh_fields(message_fields(message))
        if best_wazuh_fields is None and looks_like_wazuh(fields):
            best_wazuh_fields = fields
            best_wazuh_message = message

        for tag_key in (
            "rule_mitre_tactic",
            "rule_mitre_id",
            "decoder_name",
            "rule_id",
            "rule_level",
            "threat_name",
            "threat_tactic",
            "threat_technique",
            "threat_id",
        ):
            value = fields.get(tag_key)
            if value not in (None, ""):
                if tag_key in {"rule_id", "rule_level"}:
                    tag = f"{tag_key}:{value}"
                    if tag not in tags:
                        tags.append(tag)
                else:
                    for tag in split_tags(value):
                        if tag not in tags:
                            tags.append(tag)
        rule_level = fields.get("rule_level")
        if rule_level is not None:
            try:
                max_rule_level = max(int(rule_level), int(max_rule_level or rule_level))
            except (TypeError, ValueError):
                pass
        add_artifact(artifacts, seen_artifacts, "ip", fields.get("data_srcip"), ["src_ip", "attacker"], "Attack source IP")
        add_artifact(artifacts, seen_artifacts, "ip", fields.get("data_dstip"), ["dst_ip", "destination"], "Destination IP")
        add_artifact(artifacts, seen_artifacts, "ip", fields.get("agent_ip"), ["agent"], "Wazuh agent IP")
        add_artifact(artifacts, seen_artifacts, "hostname", fields.get("agent_name"), ["agent"], "Agent name")
        add_artifact(artifacts, seen_artifacts, "other", fields.get("data_dstuser"), ["target_user"], "Target user")
        add_artifact(artifacts, seen_artifacts, "other", fields.get("data_srcport"), ["port"], "Source port")
        add_artifact(artifacts, seen_artifacts, "url", fields.get("url"), ["url"], "URL")
        for ref_key in ("index", "id", "gl2_message_id", "timestamp"):
            value = fields.get(ref_key) or message.get(ref_key)
            if value not in (None, ""):
                source_ref_material.append(str(value))

    source_ref = hashlib.sha1("|".join(source_ref_material).encode("utf-8")).hexdigest()[:32]
    severity = severity_from_rule_level(max_rule_level)
    if best_wazuh_fields is not None:
        title = wazuh_title(best_wazuh_fields, event_title)
        description = build_wazuh_description(best_wazuh_fields, event_title, best_wazuh_message)
    else:
        title = f"Graylog Alert: {event_title}"
        description = build_generic_description(event_title, payload)

    return {
        "title": title,
        "description": description,
        "type": ALERT_TYPE,
        "source": ALERT_SOURCE,
        "sourceRef": source_ref,
        "severity": severity,
        "tlp": DEFAULT_TLP,
        "pap": DEFAULT_PAP,
        "tags": tags,
        "observables": artifacts,
    }


def thehive_headers() -> Dict[str, str]:
    if not THEHIVE_API_KEY:
        raise RuntimeError("THEHIVE_API_KEY is empty")
    headers = {
        "Authorization": f"Bearer {THEHIVE_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if THEHIVE_ORG:
        headers["X-Organisation"] = THEHIVE_ORG
    return headers


def send_alert(alert: Dict[str, Any]) -> bool:
    url = f"{THEHIVE_URL}/api/v1/alert"
    response = requests.post(url, headers=thehive_headers(), json=alert, timeout=20, verify=VERIFY_SSL)
    if response.status_code in {200, 201}:
        LOG.info("created alert sourceRef=%s title=%r", alert.get("sourceRef"), alert.get("title"))
        return True
    duplicate_markers = ("sourceRef", "already exists")
    if response.status_code in {400, 409} and any(marker in response.text for marker in duplicate_markers):
        LOG.warning("duplicate alert sourceRef=%s status=%s body=%s", alert.get("sourceRef"), response.status_code, response.text[:500])
        return True
    LOG.error("failed to create alert status=%s body=%s", response.status_code, response.text[:1000])
    return False


def make_consumer() -> KafkaConsumer:
    return KafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=[server.strip() for server in KAFKA_BOOTSTRAP_SERVERS.split(",") if server.strip()],
        group_id=KAFKA_GROUP_ID,
        enable_auto_commit=False,
        auto_offset_reset=KAFKA_AUTO_OFFSET_RESET,
        max_poll_records=KAFKA_MAX_POLL_RECORDS,
        value_deserializer=lambda raw: json.loads(raw.decode("utf-8")),
        consumer_timeout_ms=1000,
    )


def main() -> int:
    LOG.info(
        "starting graylog alert consumer topic=%s group_id=%s kafka=%s thehive=%s org=%s",
        KAFKA_TOPIC,
        KAFKA_GROUP_ID,
        KAFKA_BOOTSTRAP_SERVERS,
        THEHIVE_URL,
        THEHIVE_ORG or "<default>",
    )
    consumer = make_consumer()
    try:
        while not STOP:
            try:
                records = consumer.poll(timeout_ms=1000, max_records=KAFKA_MAX_POLL_RECORDS)
                if not records:
                    continue
                batch_ok = True
                for messages in records.values():
                    for message in messages:
                        alert = build_alert(message.value)
                        if not send_alert(alert):
                            batch_ok = False
                            break
                    if not batch_ok:
                        break
                if batch_ok:
                    consumer.commit()
                else:
                    LOG.warning("batch failed; offsets not committed, will retry")
                    time.sleep(10)
            except json.JSONDecodeError:
                LOG.exception("invalid JSON message; committing to avoid blocking")
                consumer.commit()
            except (KafkaError, requests.RequestException):
                LOG.exception("transient processing error")
                time.sleep(10)
    finally:
        consumer.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
