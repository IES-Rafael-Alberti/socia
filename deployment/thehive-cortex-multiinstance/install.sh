#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/socia-thehive}"
SERVICE_USER="${SERVICE_USER:-socia-thehive}"
THEHIVE_URL="${THEHIVE_URL:-http://127.0.0.1:9000}"
THEHIVE_ADMIN_EMAIL="${THEHIVE_ADMIN_EMAIL:-admin@thehive.local}"
THEHIVE_ADMIN_PASSWORD="${THEHIVE_ADMIN_PASSWORD:-secret}"
THEHIVE_ORG="${THEHIVE_ORG:-IES Rafael Alberti}"
KAFKA_BOOTSTRAP_SERVERS="${KAFKA_BOOTSTRAP_SERVERS:-172.17.33.153:9092}"
GRAYLOG_ALERT_KAFKA_TOPIC="${GRAYLOG_ALERT_KAFKA_TOPIC:-graylog-alerts}"
GRAYLOG_ALERT_KAFKA_GROUP_ID="${GRAYLOG_ALERT_KAFKA_GROUP_ID:-thehive-docker-$(hostname -I | awk '{print $1}' | tr . -)}"
KAFKA_AUTO_OFFSET_RESET="${KAFKA_AUTO_OFFSET_RESET:-earliest}"
KAFKA_MAX_POLL_RECORDS="${KAFKA_MAX_POLL_RECORDS:-50}"
THEHIVE_ALLOWED_RULE_IDS="${THEHIVE_ALLOWED_RULE_IDS:-31151,31104,5763,40111,5758,5551}"
THEHIVE_DROP_RULE_IDS="${THEHIVE_DROP_RULE_IDS:-31101,5760}"
THEHIVE_AGGREGATE_RULE_IDS="${THEHIVE_AGGREGATE_RULE_IDS:-31151}"
THEHIVE_AGGREGATION_WINDOW_SECONDS="${THEHIVE_AGGREGATION_WINDOW_SECONDS:-10}"
THEHIVE_AGGREGATION_MAX_EXAMPLES="${THEHIVE_AGGREGATION_MAX_EXAMPLES:-20}"
MISP_URL="${MISP_URL:-https://172.17.33.145}"
MISP_API_KEY="${MISP_API_KEY:-}"
MISP_NAME="${MISP_NAME:-MISP local}"
MISP_PURPOSE="${MISP_PURPOSE:-ImportAndExport}"
MISP_INTERVAL="${MISP_INTERVAL:-10 minutes}"
MISP_ACCEPT_ANY_CERT="${MISP_ACCEPT_ANY_CERT:-true}"
CORTEX_URL="${CORTEX_URL:-http://127.0.0.1:9001}"
CORTEX_INTERNAL_URL="${CORTEX_INTERNAL_URL:-http://cortex:9001}"
CORTEX_ADMIN_USER="${CORTEX_ADMIN_USER:-admin}"
CORTEX_ADMIN_PASSWORD="${CORTEX_ADMIN_PASSWORD:-secret}"
CORTEX_THEHIVE_USER="${CORTEX_THEHIVE_USER:-thehive}"
CORTEX_THEHIVE_PASSWORD="${CORTEX_THEHIVE_PASSWORD:-thehive1234}"
CORTEX_ORG="${CORTEX_ORG:-cortex}"
CORTEX_API_KEY="${CORTEX_API_KEY:-}"
CORTEX_ANALYZERS_SOURCE="${CORTEX_ANALYZERS_SOURCE:-/opt/Cortex-Analyzers}"
CORTEX_ENABLE_ANALYZERS="${CORTEX_ENABLE_ANALYZERS:-MISP_2_1,AbuseIPDB_1_0,AbuseIPDB_2_0,Abuse_Finder_3_0,VirusTotal_Scan_3_1,AIL_OnionLookup_1_0,VirusTotal_GetReport_3_1}"
CORTEX_ANALYZER_CONFIGS_FILE="${CORTEX_ANALYZER_CONFIGS_FILE:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este script como root: sudo ./install.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

random_secret() {
  openssl rand -hex 32 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom | head -c 64
}

ensure_env_var() {
  local key="$1"
  local value="$2"
  if [[ ! -f "${INSTALL_DIR}/.env" ]] || ! grep -q "^${key}=" "${INSTALL_DIR}/.env"; then
    printf '%s=%s\n' "${key}" "${value}" >>"${INSTALL_DIR}/.env"
  fi
}

set_env_var() {
  local key="$1"
  local value="$2"
  local escaped_value
  escaped_value="${value//\\/\\\\}"
  escaped_value="${escaped_value//&/\\&}"
  escaped_value="${escaped_value//|/\\|}"
  if [[ -f "${INSTALL_DIR}/.env" ]] && grep -q "^${key}=" "${INSTALL_DIR}/.env"; then
    sed -i "s|^${key}=.*|${key}=${escaped_value}|" "${INSTALL_DIR}/.env"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${INSTALL_DIR}/.env"
  fi
}

extract_api_key() {
  local response="$1"
  local key
  key="$(printf '%s' "${response}" | jq -er '.key // .apiKey // .apikey // .password // .value // empty' 2>/dev/null || true)"
  if [[ -n "${key}" ]]; then
    printf '%s' "${key}"
  elif printf '%s' "${response}" | jq -e . >/dev/null 2>&1; then
    return 0
  else
    printf '%s' "${response}" | tr -d '\r\n'
  fi
}

install_docker() {
  apt-get update
  apt-get install -y ca-certificates curl gnupg jq openssl python3-venv python3-pip

  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  local codename
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian %s stable\n' \
    "$(dpkg --print-architecture)" "${codename}" >/etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

prepare_files() {
  sysctl -w vm.max_map_count=262144 >/dev/null
  printf 'vm.max_map_count=262144\n' >/etc/sysctl.d/99-socia-thehive.conf

  if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --home "${INSTALL_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
  fi

  mkdir -p "${INSTALL_DIR}"
  cp -a "${SCRIPT_DIR}/." "${INSTALL_DIR}/"

  if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    : >"${INSTALL_DIR}/.env"
  fi
  ensure_env_var "THEHIVE_SECRET" "$(random_secret)"
  ensure_env_var "THEHIVE_PUBLIC_URL" "${THEHIVE_URL}"
  ensure_env_var "CORTEX_SECRET" "$(random_secret)"
  ensure_env_var "CORTEX_DOCKER_JOB_DIRECTORY" "${INSTALL_DIR}/cortex/jobs"

  mkdir -p "${INSTALL_DIR}/cortex/jobs" "${INSTALL_DIR}/cortex/config" "${INSTALL_DIR}/cortex/Cortex-Analyzers"
  if [[ -d "${CORTEX_ANALYZERS_SOURCE}" && "$(readlink -f "${CORTEX_ANALYZERS_SOURCE}")" != "$(readlink -f "${INSTALL_DIR}/cortex/Cortex-Analyzers")" ]]; then
    echo "Copiando Cortex-Analyzers desde ${CORTEX_ANALYZERS_SOURCE}..."
    cp -a "${CORTEX_ANALYZERS_SOURCE}/." "${INSTALL_DIR}/cortex/Cortex-Analyzers/"
  elif [[ -d "${SCRIPT_DIR}/cortex/Cortex-Analyzers" && "$(readlink -f "${SCRIPT_DIR}/cortex/Cortex-Analyzers")" != "$(readlink -f "${INSTALL_DIR}/cortex/Cortex-Analyzers")" ]]; then
    echo "Copiando Cortex-Analyzers desde el proyecto..."
    cp -a "${SCRIPT_DIR}/cortex/Cortex-Analyzers/." "${INSTALL_DIR}/cortex/Cortex-Analyzers/"
  fi

  python3 -m venv "${INSTALL_DIR}/consumer/venv"
  "${INSTALL_DIR}/consumer/venv/bin/pip" install --upgrade pip
  "${INSTALL_DIR}/consumer/venv/bin/pip" install -r "${INSTALL_DIR}/consumer/requirements.txt"

  python3 -m venv "${INSTALL_DIR}/graylog-alert-consumer/venv"
  "${INSTALL_DIR}/graylog-alert-consumer/venv/bin/pip" install --upgrade pip
  "${INSTALL_DIR}/graylog-alert-consumer/venv/bin/pip" install -r "${INSTALL_DIR}/graylog-alert-consumer/requirements.txt"
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
}

start_thehive() {
  cd "${INSTALL_DIR}"
  docker compose up -d
  docker exec -u 0 socia-thehive sh -lc 'mkdir -p /opt/thp/thehive/files/attachment && chown -R thehive:thehive /opt/thp/thehive/files /var/log/thehive'
}

wait_for_thehive() {
  echo "Esperando a TheHive en ${THEHIVE_URL}/api/status ..."
  for _ in $(seq 1 90); do
    if curl -fsS "${THEHIVE_URL}/api/status" >/dev/null 2>&1; then
      echo "TheHive responde."
      return 0
    fi
    sleep 10
  done
  echo "TheHive no respondió a tiempo."
  docker compose -f "${INSTALL_DIR}/docker-compose.yml" logs --tail=200 thehive
  exit 1
}

wait_for_cortex() {
  echo "Esperando a Cortex en ${CORTEX_URL}/api/status ..."
  for _ in $(seq 1 90); do
    if curl -fsS "${CORTEX_URL}/api/status" >/dev/null 2>&1; then
      echo "Cortex responde."
      return 0
    fi
    sleep 10
  done
  echo "Cortex no respondió a tiempo."
  docker compose -f "${INSTALL_DIR}/docker-compose.yml" logs --tail=200 cortex
  exit 1
}

api_call() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local auth_header=()
  if [[ -n "${AUTH_TOKEN:-}" ]]; then
    auth_header=(-H "Authorization: Bearer ${AUTH_TOKEN}")
  fi
  if [[ -n "${body}" ]]; then
    curl -fsS -X "${method}" "${THEHIVE_URL}${path}" -H "Content-Type: application/json" "${auth_header[@]}" -d "${body}"
  else
    curl -fsS -X "${method}" "${THEHIVE_URL}${path}" "${auth_header[@]}"
  fi
}

bootstrap_api_key() {
  echo "Obteniendo API key de TheHive para el consumidor..."
  local login_response
  login_response="$(curl -fsS -X POST "${THEHIVE_URL}/api/v1/login" \
    -H "Content-Type: application/json" \
    -d "{\"login\":\"${THEHIVE_ADMIN_EMAIL}\",\"password\":\"${THEHIVE_ADMIN_PASSWORD}\"}" || true)"

  AUTH_TOKEN="$(printf '%s' "${login_response}" | jq -r '.token // .access_token // .session // empty')"
  if [[ -z "${AUTH_TOKEN}" ]]; then
    echo "No se pudo iniciar sesión por API con ${THEHIVE_ADMIN_EMAIL}."
    echo "Si es la primera ejecución, entra en ${THEHIVE_URL}, completa el asistente inicial y vuelve a ejecutar install.sh."
    exit 1
  fi

  local key_response api_key
  key_response="$(api_call POST "/api/v1/user/current/key/renew" "" || api_call PATCH "/api/v1/user/current/key/renew" "" || true)"
  api_key="$(printf '%s' "${key_response}" | jq -r '.key // .apiKey // .apikey // .password // .value // empty')"

  if [[ -z "${api_key}" ]]; then
    key_response="$(api_call GET "/api/v1/user/current" "" || true)"
    api_key="$(printf '%s' "${key_response}" | jq -r '.key // .apiKey // .apikey // empty')"
  fi

  if [[ -z "${api_key}" ]]; then
    echo "Login correcto, pero no pude renovar/leer la API key con los endpoints probados."
    echo "Crea una API key en TheHive para ${THEHIVE_ADMIN_EMAIL} y ponla en ${INSTALL_DIR}/graylog-alert-consumer/.env."
    exit 1
  fi

  cat >"${INSTALL_DIR}/graylog-alert-consumer/.env" <<EOF_ENV
KAFKA_BOOTSTRAP_SERVERS=${KAFKA_BOOTSTRAP_SERVERS}
KAFKA_TOPIC=${GRAYLOG_ALERT_KAFKA_TOPIC}
KAFKA_GROUP_ID=${GRAYLOG_ALERT_KAFKA_GROUP_ID}
KAFKA_AUTO_OFFSET_RESET=latest
KAFKA_MAX_POLL_RECORDS=25
THEHIVE_URL=${THEHIVE_URL}
THEHIVE_API_KEY=${api_key}
THEHIVE_ORG=${THEHIVE_ORG}
VERIFY_SSL=false
GRAYLOG_URL=http://172.17.33.153:9000
LOG_LEVEL=INFO
EOF_ENV
  chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}/graylog-alert-consumer/.env"
  chmod 0640 "${INSTALL_DIR}/graylog-alert-consumer/.env"
}

bootstrap_cortex() {
  echo "Inicializando integración de Cortex..."

  curl -fsS -X POST "${CORTEX_URL}/api/maintenance/migrate" >/dev/null 2>&1 || true

  local admin_status
  admin_status="$(curl -fsS -o /dev/null -w '%{http_code}' \
    -u "${CORTEX_ADMIN_USER}:${CORTEX_ADMIN_PASSWORD}" \
    "${CORTEX_URL}/api/user/current" || true)"

  if [[ "${admin_status}" != "200" ]]; then
    curl -fsS -X POST "${CORTEX_URL}/api/user" \
      -H "Content-Type: application/json" \
      -d "$(jq -nc \
        --arg login "${CORTEX_ADMIN_USER}" \
        --arg password "${CORTEX_ADMIN_PASSWORD}" \
        --arg org "${CORTEX_ORG}" \
        '{login:$login,name:"Administrator",roles:["superadmin"],preferences:"{}",password:$password,organization:$org}')" \
      >/dev/null || true
  fi

  local user_status
  user_status="$(curl -fsS -o /dev/null -w '%{http_code}' \
    -u "${CORTEX_ADMIN_USER}:${CORTEX_ADMIN_PASSWORD}" \
    "${CORTEX_URL}/api/user/${CORTEX_THEHIVE_USER}" || true)"

  if [[ "${user_status}" != "200" ]]; then
    curl -fsS -X POST "${CORTEX_URL}/api/user" \
      -u "${CORTEX_ADMIN_USER}:${CORTEX_ADMIN_PASSWORD}" \
      -H "Content-Type: application/json" \
      -d "$(jq -nc \
        --arg login "${CORTEX_THEHIVE_USER}" \
        --arg password "${CORTEX_THEHIVE_PASSWORD}" \
        --arg org "${CORTEX_ORG}" \
        '{login:$login,name:"TheHive integration",roles:["read","analyze","orgadmin"],preferences:"{}",password:$password,organization:$org}')" \
      >/dev/null
  fi

  local cortex_key="${CORTEX_API_KEY}"
  if [[ -z "${cortex_key}" && -f "${INSTALL_DIR}/.env" ]]; then
    cortex_key="$(sed -n 's/^CORTEX_API_KEY=//p' "${INSTALL_DIR}/.env" | head -n 1)"
  fi

  if [[ -n "${cortex_key}" ]]; then
    local key_status
    key_status="$(curl -fsS -o /dev/null -w '%{http_code}' \
      -H "Authorization: Bearer ${cortex_key}" \
      "${CORTEX_URL}/api/user/current" || true)"
    if [[ "${key_status}" != "200" ]]; then
      echo "La CORTEX_API_KEY existente no valida contra Cortex; se generará una nueva."
      cortex_key=""
    else
      echo "La CORTEX_API_KEY existente sigue siendo válida para ${CORTEX_THEHIVE_USER}; no se rota."
    fi
  fi

  if [[ -z "${cortex_key}" ]]; then
    echo "Renovando CORTEX_API_KEY para ${CORTEX_THEHIVE_USER}..."
    cortex_key="$(extract_api_key "$(curl -fsS -X POST "${CORTEX_URL}/api/user/${CORTEX_THEHIVE_USER}/key/renew" \
      -u "${CORTEX_ADMIN_USER}:${CORTEX_ADMIN_PASSWORD}")")"
    if [[ -z "${cortex_key}" ]]; then
      echo "No pude generar la API key de Cortex para ${CORTEX_THEHIVE_USER}."
      exit 1
    fi
  fi
  set_env_var "CORTEX_API_KEY" "${cortex_key}"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}/.env"
  chmod 0640 "${INSTALL_DIR}/.env"

  configure_thehive_cortex "${cortex_key}"
  configure_cortex_analyzers "${cortex_key}"
}

configure_cortex_analyzers() {
  local cortex_key="$1"
  echo "Escaneando y habilitando analizadores Cortex..."

  CORTEX_URL="${CORTEX_URL}" \
  CORTEX_API_KEY="${cortex_key}" \
  CORTEX_ENABLE_ANALYZERS="${CORTEX_ENABLE_ANALYZERS}" \
  CORTEX_ANALYZER_CONFIGS_FILE="${CORTEX_ANALYZER_CONFIGS_FILE}" \
  "${INSTALL_DIR}/consumer/venv/bin/python" <<'PY'
import json
import os
import sys
import time

import requests


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


base = os.environ["CORTEX_URL"].rstrip("/")
session = requests.Session()
session.headers.update({"Authorization": f"Bearer {os.environ['CORTEX_API_KEY']}"})

scan = session.post(f"{base}/api/analyzerdefinition/scan", timeout=60)
if scan.status_code not in {200, 201, 202, 204}:
    fail(f"No se pudo escanear definiciones Cortex: HTTP {scan.status_code} {scan.text[:500]}")

definitions = []
for _ in range(20):
    response = session.get(f"{base}/api/analyzerdefinition", timeout=60)
    if response.status_code == 200:
        definitions = response.json()
        if definitions:
            break
    time.sleep(2)
if not definitions:
    print("Cortex no devolvió definiciones de analizadores; se deja la integración configurada.")
    sys.exit(0)

configs_file = os.environ.get("CORTEX_ANALYZER_CONFIGS_FILE", "").strip()
if configs_file:
    if not os.path.exists(configs_file):
        fail(f"CORTEX_ANALYZER_CONFIGS_FILE no existe: {configs_file}")
    with open(configs_file, "r", encoding="utf-8") as handle:
        analyzer_configs = json.load(handle)
    for item in analyzer_configs:
        name = item.get("name")
        if not name:
            continue
        patched = session.patch(f"{base}/api/analyzerconfig/{name}", json=item, timeout=60)
        if patched.status_code not in {200, 204}:
            fail(f"No se pudo importar configuración Cortex {name}: HTTP {patched.status_code} {patched.text[:500]}")
    print(f"Configuraciones Cortex importadas desde {configs_file}.")

config_response = session.get(f"{base}/api/analyzerconfig", timeout=60)
if config_response.status_code != 200:
    fail(f"No se pudo leer analyzerconfig Cortex: HTTP {config_response.status_code} {config_response.text[:500]}")
analyzer_configs = config_response.json()

enabled_response = session.get(f"{base}/api/organization/analyzer", timeout=60)
if enabled_response.status_code != 200:
    fail(f"No se pudo listar analizadores Cortex habilitados: HTTP {enabled_response.status_code} {enabled_response.text[:500]}")
enabled = {item.get("name") for item in enabled_response.json()}

definitions_by_id = {item.get("id"): item for item in definitions}
configs_by_worker = {}
for item in analyzer_configs:
    for worker in item.get("workers") or []:
        configs_by_worker[worker] = item.get("config") or {}

requested = [item.strip() for item in os.environ.get("CORTEX_ENABLE_ANALYZERS", "").split(",") if item.strip()]
for analyzer_id in requested:
    if analyzer_id in enabled:
        continue
    definition = definitions_by_id.get(analyzer_id)
    if not definition:
        print(f"Analizador Cortex no disponible y se omite: {analyzer_id}")
        continue

    payload = {"name": analyzer_id}
    worker_name = definition.get("name")
    config = configs_by_worker.get(worker_name, {})
    allowed = {item.get("name") for item in definition.get("configurationItems") or [] if item.get("name")}
    filtered = {key: value for key, value in config.items() if not allowed or key in allowed}
    if filtered:
        payload["configuration"] = filtered

    created = session.post(f"{base}/api/organization/analyzer/{analyzer_id}", json=payload, timeout=60)
    if created.status_code not in {200, 201, 204, 409}:
        fail(f"No se pudo habilitar analizador {analyzer_id}: HTTP {created.status_code} {created.text[:500]}")
    print(f"Analizador Cortex habilitado: {analyzer_id}")

final = session.get(f"{base}/api/organization/analyzer", timeout=60)
if final.status_code == 200:
    names = sorted(item.get("name", "unknown") for item in final.json())
    print("Analizadores Cortex disponibles: " + ", ".join(names))
PY
}

configure_thehive_cortex() {
  local cortex_key="$1"
  echo "Registrando Cortex en TheHive..."

  local payload
  payload="$(jq -nc \
    --arg url "${CORTEX_INTERNAL_URL}" \
    --arg key "${cortex_key}" \
    '{
      statusCheckInterval: "1 minute",
      refreshDelay: "5 seconds",
      maxRetryOnError: 3,
      jobTimeout: "3 hours",
      servers: [{
        name: "Cortex",
        url: $url,
        includedTheHiveOrganisations: ["*"],
        excludedTheHiveOrganisations: [],
        auth: {type: "bearer", key: $key},
        default: true
      }]
    }')"

  local code
  code="$(curl -fsS -o /tmp/socia-thehive-cortex-config.out -w '%{http_code}' \
    -X PUT "${THEHIVE_URL}/api/v1/admin/config/cortex" \
    -u "${THEHIVE_ADMIN_EMAIL}:${THEHIVE_ADMIN_PASSWORD}" \
    -H "X-Organisation: admin" \
    -H "Content-Type: application/json" \
    -d "${payload}" || true)"

  if [[ "${code}" != "204" ]]; then
    echo "No pude registrar Cortex en TheHive. HTTP ${code}"
    cat /tmp/socia-thehive-cortex-config.out
    exit 1
  fi

  local saved_key
  saved_key="$(
    curl -fsS \
      -u "${THEHIVE_ADMIN_EMAIL}:${THEHIVE_ADMIN_PASSWORD}" \
      -H "X-Organisation: admin" \
      "${THEHIVE_URL}/api/v1/admin/config/cortex" | jq -er '.servers[0].auth.key // empty' 2>/dev/null || true
  )"
  if [[ "${saved_key}" != "${cortex_key}" ]]; then
    echo "TheHive no guardó la CORTEX_API_KEY esperada para el principal."
    exit 1
  fi

  local analyzer_code
  analyzer_code="$(
    curl -fsS -o /dev/null -w '%{http_code}' \
      -u "${THEHIVE_ADMIN_EMAIL}:${THEHIVE_ADMIN_PASSWORD}" \
      -H "X-Organisation: admin" \
      "${THEHIVE_URL}/api/connector/cortex/analyzer?range=all" || true
  )"
  if [[ "${analyzer_code}" != "200" ]]; then
    echo "TheHive guardó la config de Cortex, pero el endpoint de analyzers respondió HTTP ${analyzer_code}."
    exit 1
  fi
}

install_service() {
  cp "${INSTALL_DIR}/graylog-alert-consumer/graylog-alert-consumer.service" /etc/systemd/system/graylog-alert-consumer.service
  "${INSTALL_DIR}/graylog-alert-consumer/venv/bin/python" -m py_compile "${INSTALL_DIR}/graylog-alert-consumer/graylog-alert-consumer.py"
  systemctl daemon-reload
  systemctl enable graylog-alert-consumer.service
  systemctl restart graylog-alert-consumer.service
}

configure_misp() {
  if [[ -z "${MISP_API_KEY}" ]]; then
    echo "MISP_API_KEY no definido; se omite la configuración MISP."
    return 0
  fi

  echo "Configurando conexión MISP en TheHive..."
  THEHIVE_URL="${THEHIVE_URL}" \
  THEHIVE_ADMIN_EMAIL="${THEHIVE_ADMIN_EMAIL}" \
  THEHIVE_ADMIN_PASSWORD="${THEHIVE_ADMIN_PASSWORD}" \
  MISP_URL="${MISP_URL}" \
  MISP_API_KEY="${MISP_API_KEY}" \
  MISP_NAME="${MISP_NAME}" \
  MISP_PURPOSE="${MISP_PURPOSE}" \
  MISP_INTERVAL="${MISP_INTERVAL}" \
  MISP_ACCEPT_ANY_CERT="${MISP_ACCEPT_ANY_CERT}" \
  "${INSTALL_DIR}/consumer/venv/bin/python" <<'PY'
import os
import sys

import requests

base = os.environ["THEHIVE_URL"].rstrip("/")
session = requests.Session()
login = session.post(
    f"{base}/api/v1/login",
    json={"user": os.environ["THEHIVE_ADMIN_EMAIL"], "password": os.environ["THEHIVE_ADMIN_PASSWORD"]},
    timeout=20,
)
if login.status_code != 200:
    print(f"No se pudo iniciar sesión en TheHive para configurar MISP: HTTP {login.status_code}", file=sys.stderr)
    sys.exit(1)

accept_any_cert = os.environ.get("MISP_ACCEPT_ANY_CERT", "true").lower() in {"1", "true", "yes"}
server = {
    "name": os.environ.get("MISP_NAME", "MISP local"),
    "url": os.environ["MISP_URL"].rstrip("/"),
    "auth": {"type": "key", "key": os.environ["MISP_API_KEY"]},
    "purpose": os.environ.get("MISP_PURPOSE", "ImportAndExport"),
    "wsConfig": {
        "proxy": {"protocol": "http"},
        "ssl": {
            "loose": {
                "acceptAnyCertificate": accept_any_cert,
                "checkCertificateAuthority": not accept_any_cert,
            }
        },
    },
    "includedTheHiveOrganisations": ["*"],
    "excludedTheHiveOrganisations": [],
    "tags": ["misp"],
    "maxAge": None,
    "max-attributes": None,
    "whitelist": {"organisations": [], "tags": []},
    "exclusion": {"organisations": [], "tags": []},
    "exportCaseTags": False,
    "exportObservableTags": False,
    "exportTheHiveUrl": False,
}

test = session.post(f"{base}/api/v1/admin/config/misp/test", json=server, timeout=30)
if test.status_code != 200:
    print(f"Test MISP falló: HTTP {test.status_code} {test.text[:500]}", file=sys.stderr)
    sys.exit(1)

config = {"interval": os.environ.get("MISP_INTERVAL", "10 minutes"), "servers": [server]}
update = session.put(f"{base}/api/v1/admin/config/misp", json=config, timeout=30)
if update.status_code != 204:
    print(f"No se pudo guardar MISP: HTTP {update.status_code} {update.text[:500]}", file=sys.stderr)
    sys.exit(1)

print("Conexión MISP configurada correctamente.")
PY
}

install_docker
prepare_files
start_thehive
wait_for_thehive
wait_for_cortex
bootstrap_cortex
bootstrap_api_key
install_service
configure_misp

echo "Instalación terminada."
echo "TheHive: ${THEHIVE_URL}"
echo "Servicio consumidor: systemctl status graylog-alert-consumer"
