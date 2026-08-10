#!/usr/bin/env python3
"""Verify a SOCIA workflow against a MENTORA network capture.

This script mirrors the matcher in ``@socia/runtime``. It checks each
signature on its own and then replays the events in time order with milestone
dependencies enabled.

Usage:
  uv run apps/skills/workflow-generator/scripts/verify_workflow.py \
    <workflow.json> <mentora.zip|recording-directory|network-log.json>
"""

from __future__ import annotations

import json
import re
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PLACEHOLDER = re.compile(r"\{\{(\w+(?:\.\w+)*)\}\}")
REDACTED = "[REDACTED]"


@dataclass
class Capture:
    events: list[dict[str, Any]]
    metadata: dict[str, Any] | None
    source: str


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _zip_member(archive: zipfile.ZipFile, filename: str) -> str | None:
    matches = [name for name in archive.namelist() if Path(name).name == filename]
    if not matches:
        return None
    if len(matches) > 1:
        raise ValueError(f"el ZIP contiene varios archivos llamados {filename}")
    return matches[0]


def load_capture(path: Path) -> Capture:
    if path.is_dir():
        network_files = list(path.rglob("network-log.json"))
        if len(network_files) != 1:
            raise ValueError(
                f"se esperaba un network-log.json y se encontraron {len(network_files)}"
            )
        network_path = network_files[0]
        metadata_path = network_path.with_name("metadata.json")
        metadata = _read_json(metadata_path) if metadata_path.exists() else None
        return Capture(_read_json(network_path), metadata, str(network_path))

    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            network_member = _zip_member(archive, "network-log.json")
            if network_member is None:
                raise ValueError("el ZIP no contiene network-log.json")
            events = json.loads(archive.read(network_member).decode("utf-8"))
            metadata_member = _zip_member(archive, "metadata.json")
            metadata = (
                json.loads(archive.read(metadata_member).decode("utf-8"))
                if metadata_member
                else None
            )
        return Capture(events, metadata, str(path))

    if path.name != "network-log.json":
        raise ValueError(
            "la captura debe ser un ZIP de MENTORA, una carpeta extraída o network-log.json"
        )
    metadata_path = path.with_name("metadata.json")
    metadata = _read_json(metadata_path) if metadata_path.exists() else None
    return Capture(_read_json(path), metadata, str(path))


def interpolate(text: str, variables: dict[str, str]) -> str:
    return PLACEHOLDER.sub(lambda match: variables.get(match.group(1), match.group(0)), text)


def contains(
    target: str | None,
    pattern: str | list[str] | None,
    variables: dict[str, str],
    match_mode: str = "all",
) -> bool:
    if pattern is None:
        return True
    if not target:
        return False
    target_lower = target.lower()
    patterns = [pattern] if isinstance(pattern, str) else pattern
    checks = [interpolate(item, variables).lower() in target_lower for item in patterns]
    return any(checks) if match_mode == "any_of_body" else all(checks)


def url_contains(
    url: str, pattern: str | list[str], variables: dict[str, str]
) -> bool:
    url_lower = url.lower()
    patterns = [pattern] if isinstance(pattern, str) else pattern
    return any(interpolate(item, variables).lower() in url_lower for item in patterns)


def matches(
    event: dict[str, Any], milestone: dict[str, Any], variables: dict[str, str]
) -> bool:
    return any(
        matches_signature(event, signature, milestone, variables)
        for signature in milestone_signatures(milestone)
    )


def milestone_signatures(milestone: dict[str, Any]) -> list[dict[str, Any]]:
    alternatives = milestone.get("network_signatures")
    if isinstance(alternatives, list):
        return alternatives
    signature = milestone.get("network_signature")
    return [signature] if isinstance(signature, dict) else []


def matches_signature(
    event: dict[str, Any],
    signature: dict[str, Any],
    milestone: dict[str, Any],
    variables: dict[str, str],
) -> bool:
    methods = signature["method"]
    if isinstance(methods, str):
        methods = [methods]
    if str(event.get("method", "")).upper() not in {item.upper() for item in methods}:
        return False

    host_pattern = interpolate(signature["host_contains"], variables).lower()
    if host_pattern not in str(event.get("host", "")).lower():
        return False
    if not url_contains(str(event.get("url", "")), signature["url_contains"], variables):
        return False
    if event.get("status") not in signature["response_status"]:
        return False

    match_mode = milestone.get("match_mode", "all")
    if not contains(
        event.get("requestBody"),
        signature.get("request_body_contains"),
        variables,
        match_mode,
    ):
        return False
    return contains(
        event.get("responseBody"),
        signature.get("response_body_contains"),
        variables,
        match_mode,
    )


def dependencies_met(milestone: dict[str, Any], completed: set[str]) -> bool:
    return all(item in completed for item in milestone.get("depends_on", [])) and (
        not milestone.get("after_milestone")
        or milestone["after_milestone"] in completed
    )


def walk_strings(node: Any, path: str = "") -> list[tuple[str, str]]:
    if isinstance(node, str):
        return [(path, node)]
    if isinstance(node, list):
        result: list[tuple[str, str]] = []
        for index, value in enumerate(node):
            result.extend(walk_strings(value, f"{path}[{index}]"))
        return result
    if isinstance(node, dict):
        result = []
        for key, value in node.items():
            child = f"{path}.{key}" if path else key
            result.extend(walk_strings(value, child))
        return result
    return []


def redacted_fields(event: dict[str, Any], body: str) -> set[str]:
    key = "requestBodyRedactions" if body == "request" else "responseBodyRedactions"
    fields: set[str] = set()
    for path in event.get(key, []):
        names = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", str(path))
        if names:
            fields.add(names[-1].lower())
    return fields


def pattern_names(pattern: str | list[str] | None) -> set[str]:
    if pattern is None:
        return set()
    values = [pattern] if isinstance(pattern, str) else pattern
    return {
        name.lower()
        for value in values
        for name in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", value)
    }


def event_time(event: dict[str, Any]) -> int:
    value = event.get("t", event.get("timestamp", 0))
    return value if isinstance(value, int) else 0


def milestone_list(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        milestone
        for phase in workflow["phases"]
        for milestone in phase["milestones"]
    ]


def capture_health(metadata: dict[str, Any] | None) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    notes: list[str] = []
    if metadata is None:
        notes.append("no se encontró metadata.json; no se pueden revisar límites ni avisos")
        return errors, notes

    warnings = metadata.get("captureWarnings", [])
    if warnings:
        errors.append(f"metadata.captureWarnings contiene {len(warnings)} aviso(s): {warnings}")
    else:
        notes.append("captureWarnings: 0")

    limits = metadata.get("captureLimits", {})
    for kind in ("actions", "network"):
        values = limits.get(kind, {})
        dropped = values.get("droppedEvents", 0)
        reached = values.get("limitReached", False)
        notes.append(f"{kind}: {dropped} eventos descartados; límite alcanzado: {str(reached).lower()}")
        if dropped or reached:
            errors.append(
                f"captureLimits.{kind} indica una captura parcial "
                f"(droppedEvents={dropped}, limitReached={reached})"
            )
    return errors, notes


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(
            "usage: verify_workflow.py <workflow.json> "
            "<mentora.zip|recording-directory|network-log.json>",
            file=sys.stderr,
        )
        return 2

    try:
        workflow_path = Path(argv[1])
        workflow = _read_json(workflow_path)
        capture = load_capture(Path(argv[2]))
    except (OSError, json.JSONDecodeError, zipfile.BadZipFile, ValueError) as error:
        print(f"❌ No se pudieron leer los datos: {error}", file=sys.stderr)
        return 1

    errors, health_notes = capture_health(capture.metadata)
    variables = workflow.get("variables", {})
    milestones = milestone_list(workflow)
    events = sorted(
        [event for event in capture.events if event.get("outcome", "completed") == "completed"],
        key=event_time,
    )

    for path, value in walk_strings(workflow):
        if REDACTED.lower() in value.lower():
            errors.append(f"{path} contiene {REDACTED}")

    independent: dict[str, list[dict[str, Any]]] = {}
    for milestone in milestones:
        found = [event for event in events if matches(event, milestone, variables)]
        independent[milestone["id"]] = found
        if not found:
            errors.append(f"{milestone['id']}: la firma no coincide con ningún evento")
            continue
        for signature_index, signature in enumerate(milestone_signatures(milestone)):
            signature_matches = [
                event
                for event in events
                if matches_signature(event, signature, milestone, variables)
            ]
            if not signature_matches:
                errors.append(
                    f"{milestone['id']}[firma {signature_index}]: la alternativa "
                    "no coincide con ningún evento"
                )
                continue
            for body in ("request", "response"):
                patterns = pattern_names(signature.get(f"{body}_body_contains"))
                affected = set().union(
                    *(redacted_fields(event, body) for event in signature_matches)
                )
                reused = patterns & affected
                if reused:
                    errors.append(
                        f"{milestone['id']}[firma {signature_index}]: usa campo(s) "
                        f"oculto(s) del cuerpo {body}: {', '.join(sorted(reused))}"
                    )

    completed: set[str] = set()
    replayed_at: dict[str, int] = {}
    shared_event: dict[int, list[str]] = {}
    for event in events:
        for milestone in milestones:
            milestone_id = milestone["id"]
            if milestone_id in completed or not dependencies_met(milestone, completed):
                continue
            if matches(event, milestone, variables):
                completed.add(milestone_id)
                timestamp = event_time(event)
                replayed_at[milestone_id] = timestamp
                shared_event.setdefault(timestamp, []).append(milestone_id)

    missing_in_replay = [m["id"] for m in milestones if m["id"] not in completed]
    if missing_in_replay:
        errors.append(
            "la reproducción cronológica no completa: " + ", ".join(missing_in_replay)
        )

    print(f"Captura: {capture.source}")
    print(f"Eventos completos analizados: {len(events)}")
    for note in health_notes:
        print(f"- {note}")
    print("\nHitos:")
    for milestone in milestones:
        milestone_id = milestone["id"]
        found = independent[milestone_id]
        first = event_time(found[0]) if found else "—"
        replay = replayed_at.get(milestone_id, "—")
        marker = "✅" if found and milestone_id in completed else "❌"
        print(
            f"{marker} {milestone_id}: {len(found)} coincidencia(s), "
            f"primera t={first}, reproducción t={replay}"
        )

    collisions = {t: ids for t, ids in shared_event.items() if len(ids) > 1}
    if collisions:
        print("\nAvisos:")
        for timestamp, ids in collisions.items():
            print(
                f"- Un mismo evento t={timestamp} completa varios hitos: {', '.join(ids)}"
            )

    print(
        f"\nVerificados {sum(bool(v) for v in independent.values())}/{len(milestones)} "
        "hitos contra el network-log."
    )
    print(f"Reproducción cronológica: {len(completed)}/{len(milestones)} hitos.")

    if errors:
        print(f"\n❌ {len(errors)} error(es):", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("✅ Todas las firmas y dependencias quedan verificadas.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
