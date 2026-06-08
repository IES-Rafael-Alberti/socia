#!/usr/bin/env bash
set -euo pipefail

echo "Este modo legacy esta retirado porque dependia de thehive-consumer." >&2
echo "Usa /home/debian/socia-thehive/multiinstance-shared-backend o revisa /home/debian/old-scripts/thehive-consumer." >&2
exit 1

BASE_DIR="${BASE_DIR:-/opt/socia-students}"
SOURCE_DIR="${SOURCE_DIR:-/home/debian/socia-thehive}"
KAFKA_BOOTSTRAP_SERVERS="${KAFKA_BOOTSTRAP_SERVERS:-172.17.33.153:9092}"
KAFKA_TOPIC="${KAFKA_TOPIC:-ioc-events}"
GRAYLOG_ALERT_KAFKA_TOPIC="${GRAYLOG_ALERT_KAFKA_TOPIC:-graylog-alerts}"
ADMIN_USER="${ADMIN_USER:-admin@thehive.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-secret}"
ORG_NAME_DEFAULT="IES Rafael Alberti"
ADMIN_API_KEY="${ADMIN_API_KEY:-}"
MISP_URL="${MISP_URL:-https://172.17.33.145}"
MISP_API_KEY="${MISP_API_KEY:-}"
MISP_NAME="${MISP_NAME:-MISP local}"
MISP_PURPOSE="${MISP_PURPOSE:-ImportAndExport}"
MISP_INTERVAL="${MISP_INTERVAL:-10 minutes}"
MISP_ACCEPT_ANY_CERT="${MISP_ACCEPT_ANY_CERT:-true}"

CASSANDRA_HEAP="${CASSANDRA_HEAP:-768M}"
CASSANDRA_NEW_HEAP="${CASSANDRA_NEW_HEAP:-192M}"
ELASTIC_HEAP="${ELASTIC_HEAP:-768m}"
THEHIVE_HEAP="${THEHIVE_HEAP:-768m}"

usage() {
  cat <<'EOF_USAGE'
Uso:
  sudo ./create-instance.sh contenedor1 9101
  sudo ./create-instance.sh contenedor2 9102 --no-consumer

Variables opcionales:
  BASE_DIR=/opt/socia-students
  KAFKA_BOOTSTRAP_SERVERS=172.17.33.153:9092
  KAFKA_TOPIC=ioc-events
  ADMIN_USER=admin@thehive.local
  ADMIN_PASSWORD=secret
  ADMIN_API_KEY=<api-key-admin-existente>
  MISP_API_KEY=<api-key-misp>
  MISP_URL=https://172.17.33.145
  CASSANDRA_HEAP=768M
  ELASTIC_HEAP=768m
  THEHIVE_HEAP=768m

Cada instancia queda aislada con sus propios contenedores, red y volumenes.
EOF_USAGE
}

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Ejecuta como root: sudo $0 ..."
    exit 1
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Falta el comando requerido: $1"
    exit 1
  fi
}

validate_instance() {
  local instance="$1"
  if [[ ! "${instance}" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    echo "Nombre de instancia invalido: ${instance}"
    echo "Usa solo minusculas, numeros y guiones. Ejemplo: contenedor1"
    exit 1
  fi
}

validate_port() {
  local port="$1"
  if [[ ! "${port}" =~ ^[0-9]+$ ]] || (( port < 1024 || port > 65535 )); then
    echo "Puerto invalido: ${port}"
    exit 1
  fi
  if ss -ltn "( sport = :${port} )" | tail -n +2 | grep -q .; then
    echo "El puerto ${port} ya esta en uso."
    exit 1
  fi
}

replace_tokens() {
  local src="$1"
  local dst="$2"
  sed \
    -e "s#__INSTANCE__#${INSTANCE}#g" \
    -e "s#__PORT__#${PORT}#g" \
    -e "s#__INSTANCE_DIR__#${INSTANCE_DIR}#g" \
    -e "s#__KAFKA_BOOTSTRAP_SERVERS__#${KAFKA_BOOTSTRAP_SERVERS}#g" \
    -e "s#__KAFKA_TOPIC__#${KAFKA_TOPIC}#g" \
    -e "s#__GRAYLOG_ALERT_KAFKA_TOPIC__#${GRAYLOG_ALERT_KAFKA_TOPIC}#g" \
    -e "s#__ORG_NAME__#${ORG_NAME}#g" \
    -e "s#__THEHIVE_API_KEY__#${THEHIVE_API_KEY:-change-me}#g" \
    -e "s#__CASSANDRA_HEAP__#${CASSANDRA_HEAP}#g" \
    -e "s#__CASSANDRA_NEW_HEAP__#${CASSANDRA_NEW_HEAP}#g" \
    -e "s#__ELASTIC_HEAP__#${ELASTIC_HEAP}#g" \
    -e "s#__THEHIVE_HEAP__#${THEHIVE_HEAP}#g" \
    "${src}" >"${dst}"
}

wait_for_thehive() {
  echo "Esperando a TheHive (${INSTANCE}) en http://127.0.0.1:${PORT}/api/status ..."
  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/status" >/dev/null 2>&1; then
      echo "TheHive ${INSTANCE} responde."
      return 0
    fi
    sleep 10
  done
  echo "TheHive ${INSTANCE} no respondio a tiempo."
  docker compose -f "${INSTANCE_DIR}/docker-compose.yml" logs --tail=160 thehive
  exit 1
}

fix_thehive_storage_permissions() {
  docker exec -u 0 "socia-${INSTANCE}-thehive" sh -lc \
    'mkdir -p /opt/thp/thehive/files/attachment && chown -R thehive:thehive /opt/thp/thehive/files /var/log/thehive'
}

get_admin_key() {
  if [[ -n "${ADMIN_API_KEY}" ]]; then
    printf '%s' "${ADMIN_API_KEY}"
    return
  fi

  local key
  key="$(curl -fsS -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
    "http://127.0.0.1:9000/api/v1/user/${ADMIN_USER//@/%40}/key" || true)"
  if [[ -z "${key}" ]]; then
    echo "No pude obtener la API key admin desde el TheHive principal." >&2
    echo "Define ADMIN_API_KEY o revisa ADMIN_USER/ADMIN_PASSWORD." >&2
    exit 1
  fi
  printf '%s' "${key}"
}

create_service_user() {
  local admin_key="$1"
  local login="socia-${INSTANCE}@thehive.local"
  local password="${INSTANCE}"
  local user_json

  user_json="$(curl -fsS -X POST "http://127.0.0.1:${PORT}/api/v1/user" \
    -H "Authorization: Bearer ${admin_key}" \
    -H "Content-Type: application/json" \
    -d "{\"login\":\"${login}\",\"name\":\"SOCIA ${INSTANCE}\",\"type\":\"Normal\",\"organisation\":\"${ORG_NAME}\",\"profile\":\"analyst\"}" || true)"

  if printf '%s' "${user_json}" | grep -q '"User already exists"\|"AlreadyExists"\|"already"'; then
    echo "El usuario ${login} ya existe."
  elif ! printf '%s' "${user_json}" | grep -q "\"login\":\"${login}\""; then
    echo "No pude crear usuario ${login}. Respuesta:"
    printf '%s\n' "${user_json}"
    exit 1
  fi

  curl -fsS -X POST "http://127.0.0.1:${PORT}/api/v1/user/${login//@/%40}/password/set" \
    -H "Authorization: Bearer ${admin_key}" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"${password}\"}" >/dev/null

  THEHIVE_API_KEY="$(curl -fsS -X POST "http://127.0.0.1:${PORT}/api/v1/user/${login//@/%40}/key/renew" \
    -H "Authorization: Bearer ${admin_key}")"
  echo "Usuario analista: ${login} / ${password}"
}

install_consumer_service() {
  if ! id socia-thehive >/dev/null 2>&1; then
    useradd --system --home "${BASE_DIR}" --shell /usr/sbin/nologin socia-thehive
  fi

  python3 -m venv "${INSTANCE_DIR}/consumer/venv"
  "${INSTANCE_DIR}/consumer/venv/bin/pip" install --upgrade pip >/dev/null
  "${INSTANCE_DIR}/consumer/venv/bin/pip" install -r "${INSTANCE_DIR}/consumer/requirements.txt" >/dev/null

  python3 -m venv "${INSTANCE_DIR}/graylog-alert-consumer/venv"
  "${INSTANCE_DIR}/graylog-alert-consumer/venv/bin/pip" install --upgrade pip >/dev/null
  "${INSTANCE_DIR}/graylog-alert-consumer/venv/bin/pip" install -r "${INSTANCE_DIR}/graylog-alert-consumer/requirements.txt" >/dev/null

  replace_tokens "${TEMPLATE_DIR}/consumer.env.tpl" "${INSTANCE_DIR}/consumer/.env"
  replace_tokens "${TEMPLATE_DIR}/graylog-alert-consumer.env.tpl" "${INSTANCE_DIR}/graylog-alert-consumer/.env"
  chmod 0640 "${INSTANCE_DIR}/consumer/.env" "${INSTANCE_DIR}/graylog-alert-consumer/.env"
  chown -R socia-thehive:socia-thehive "${INSTANCE_DIR}/consumer" "${INSTANCE_DIR}/graylog-alert-consumer"

  replace_tokens "${TEMPLATE_DIR}/thehive-consumer.service.tpl" "/etc/systemd/system/thehive-consumer-${INSTANCE}.service"
  replace_tokens "${TEMPLATE_DIR}/graylog-alert-consumer.service.tpl" "/etc/systemd/system/graylog-alert-consumer-${INSTANCE}.service"
  "${INSTANCE_DIR}/consumer/venv/bin/python" -m py_compile "${INSTANCE_DIR}/consumer/thehive-consumer.py"
  "${INSTANCE_DIR}/graylog-alert-consumer/venv/bin/python" -m py_compile "${INSTANCE_DIR}/graylog-alert-consumer/graylog-alert-consumer.py"
  systemctl daemon-reload
  systemctl enable --now "thehive-consumer-${INSTANCE}.service" "graylog-alert-consumer-${INSTANCE}.service"
}

configure_misp() {
  if [[ -z "${MISP_API_KEY}" ]]; then
    echo "MISP_API_KEY no definido; se omite la configuración MISP para ${INSTANCE}."
    return 0
  fi
  if [[ ! -x "${INSTANCE_DIR}/consumer/venv/bin/python" ]]; then
    echo "No existe venv del consumer; se omite la configuración MISP para ${INSTANCE}."
    return 0
  fi

  echo "Configurando conexión MISP para ${INSTANCE}..."
  THEHIVE_URL="http://127.0.0.1:${PORT}" \
  THEHIVE_ADMIN_KEY="${ADMIN_KEY}" \
  MISP_URL="${MISP_URL}" \
  MISP_API_KEY="${MISP_API_KEY}" \
  MISP_NAME="${MISP_NAME}" \
  MISP_PURPOSE="${MISP_PURPOSE}" \
  MISP_INTERVAL="${MISP_INTERVAL}" \
  MISP_ACCEPT_ANY_CERT="${MISP_ACCEPT_ANY_CERT}" \
  "${INSTANCE_DIR}/consumer/venv/bin/python" <<'PY'
import os
import sys

import requests

base = os.environ["THEHIVE_URL"].rstrip("/")
session = requests.Session()
session.headers.update({"Authorization": f"Bearer {os.environ['THEHIVE_ADMIN_KEY']}"})

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

NO_CONSUMER=0
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 2 ]]; then
  usage
  exit 0
fi

INSTANCE="$1"
PORT="$2"
shift 2

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-consumer)
      NO_CONSUMER=1
      ;;
    *)
      echo "Opcion desconocida: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

need_root
require_cmd docker
require_cmd curl
require_cmd sed
require_cmd ss
require_cmd python3
validate_instance "${INSTANCE}"
validate_port "${PORT}"

TEMPLATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/templates" && pwd)"
INSTANCE_DIR="${BASE_DIR}/${INSTANCE}"
ORG_NAME="${ORG_NAME_DEFAULT}"
THEHIVE_API_KEY=""

if [[ -e "${INSTANCE_DIR}" ]]; then
  echo "La instancia ya existe: ${INSTANCE_DIR}"
  exit 1
fi

install -d "${INSTANCE_DIR}/thehive/config" "${INSTANCE_DIR}/consumer" "${INSTANCE_DIR}/graylog-alert-consumer"
replace_tokens "${TEMPLATE_DIR}/docker-compose.yml.tpl" "${INSTANCE_DIR}/docker-compose.yml"
replace_tokens "${TEMPLATE_DIR}/application.conf.tpl" "${INSTANCE_DIR}/thehive/config/application.conf"
cp "${SOURCE_DIR}/consumer/thehive-consumer.py" "${INSTANCE_DIR}/consumer/thehive-consumer.py"
cp "${SOURCE_DIR}/consumer/requirements.txt" "${INSTANCE_DIR}/consumer/requirements.txt"
cp "${SOURCE_DIR}/graylog-alert-consumer/graylog-alert-consumer.py" "${INSTANCE_DIR}/graylog-alert-consumer/graylog-alert-consumer.py"
cp "${SOURCE_DIR}/graylog-alert-consumer/requirements.txt" "${INSTANCE_DIR}/graylog-alert-consumer/requirements.txt"

secret="$(openssl rand -hex 32 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom | head -c 64)"
printf 'THEHIVE_SECRET=%s\n' "${secret}" >"${INSTANCE_DIR}/.env"

sysctl -w vm.max_map_count=262144 >/dev/null
printf 'vm.max_map_count=262144\n' >/etc/sysctl.d/99-socia-thehive.conf

docker compose -f "${INSTANCE_DIR}/docker-compose.yml" up -d
fix_thehive_storage_permissions
wait_for_thehive

ADMIN_KEY="$(get_admin_key)"
create_service_user "${ADMIN_KEY}"

if [[ "${NO_CONSUMER}" -eq 0 ]]; then
  install_consumer_service
fi
configure_misp

host_ip="$(hostname -I | awk '{print $1}')"
echo
echo "Instancia creada: ${INSTANCE}"
echo "URL: http://${host_ip}:${PORT}"
echo "Usuario: socia-${INSTANCE}@thehive.local"
echo "Password: ${INSTANCE}"
echo "Kafka group: thehive-socia-${INSTANCE}"
if [[ "${NO_CONSUMER}" -eq 0 ]]; then
  echo "Servicio consumidor: thehive-consumer-${INSTANCE}.service"
  echo "Servicio Graylog alerts: graylog-alert-consumer-${INSTANCE}.service"
fi
