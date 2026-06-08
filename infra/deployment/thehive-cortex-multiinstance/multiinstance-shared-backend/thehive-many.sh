#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${BASE_DIR:-/opt/socia-students}"
PREFIX="${PREFIX:-contenedor}"
START_INDEX="${START_INDEX:-1}"

usage() {
  cat <<'EOF_USAGE'
Uso:
  sudo ./thehive-many.sh start --all
  sudo ./thehive-many.sh stop --all
  sudo ./thehive-many.sh restart --all
  sudo ./thehive-many.sh status --all
  sudo PREFIX=alumno START_INDEX=21 ./thehive-many.sh stop 5

Variables opcionales:
  BASE_DIR=/opt/socia-students
  PREFIX=contenedor
  START_INDEX=1

Acciones:
  start    Arranca los contenedores TheHive de las instancias seleccionadas
  stop     Para los contenedores TheHive de las instancias seleccionadas
  restart  Reinicia los contenedores TheHive de las instancias seleccionadas
  status   Muestra el estado de los contenedores TheHive de las instancias seleccionadas

Selección:
  --all    Todas las instancias existentes con el prefijo indicado
  N        N instancias consecutivas desde START_INDEX
EOF_USAGE
}

die() {
  echo "Error: $*" >&2
  exit 1
}

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "ejecuta como root: sudo $0 <start|stop|restart|status> <--all|cantidad>"
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "falta el comando requerido: $1"
}

validate_number() {
  local name="$1"
  local value="$2"
  [[ "${value}" =~ ^[0-9]+$ ]] || die "${name} debe ser numerico: ${value}"
}

validate_instance() {
  local instance="$1"
  [[ "${instance}" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "nombre de instancia invalido: ${instance}"
}

discover_instances() {
  [[ -d "${BASE_DIR}" ]] || return 0

  find "${BASE_DIR}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    grep -E "^${PREFIX}[0-9]+$" |
    sort -V
}

container_name() {
  printf 'socia-%s-thehive' "$1"
}

consumer_service_name() {
  printf 'graylog-alert-consumer-%s.service' "$1"
}

container_status() {
  local instance="$1"
  local name
  name="$(container_name "${instance}")"
  docker inspect -f '{{.State.Status}}' "${name}" 2>/dev/null || true
}

consumer_status() {
  local instance="$1"
  local service
  service="$(consumer_service_name "${instance}")"
  systemctl is-active "${service}" 2>/dev/null || true
}

apply_action() {
  local action="$1"
  local instance="$2"
  local instance_dir="${BASE_DIR}/${instance}"
  local compose_file="${instance_dir}/docker-compose.yml"
  local name current_status consumer_service current_consumer_status

  name="$(container_name "${instance}")"
  current_status="$(container_status "${instance}")"
  consumer_service="$(consumer_service_name "${instance}")"
  current_consumer_status="$(consumer_status "${instance}")"

  if [[ ! -f "${compose_file}" ]]; then
    echo "  ${instance}: sin docker-compose.yml en ${instance_dir}"
    return 1
  fi

  case "${action}" in
    start)
      if [[ "${current_status}" == "running" ]]; then
        if systemctl list-unit-files "${consumer_service}" --no-legend 2>/dev/null | grep -q . && [[ "${current_consumer_status}" != "active" ]]; then
          systemctl start "${consumer_service}"
          echo "  ${instance}: contenedor ya arrancado, consumer arrancado"
          return 0
        fi
        echo "  ${instance}: ya estaba arrancado"
        return 0
      fi
      docker compose -f "${compose_file}" start thehive >/dev/null
      if systemctl list-unit-files "${consumer_service}" --no-legend 2>/dev/null | grep -q .; then
        systemctl start "${consumer_service}"
        echo "  ${instance}: arrancado + consumer arrancado"
      else
        echo "  ${instance}: arrancado"
      fi
      ;;
    stop)
      if [[ "${current_status}" != "running" ]]; then
        if systemctl list-unit-files "${consumer_service}" --no-legend 2>/dev/null | grep -q . && [[ "${current_consumer_status}" == "active" ]]; then
          systemctl stop "${consumer_service}"
          echo "  ${instance}: contenedor ya parado, consumer parado"
          return 0
        fi
        echo "  ${instance}: ya estaba parado"
        return 0
      fi
      docker compose -f "${compose_file}" stop thehive >/dev/null
      if systemctl list-unit-files "${consumer_service}" --no-legend 2>/dev/null | grep -q .; then
        systemctl stop "${consumer_service}"
        echo "  ${instance}: parado + consumer parado"
      else
        echo "  ${instance}: parado"
      fi
      ;;
    restart)
      if [[ -z "${current_status}" ]]; then
        docker compose -f "${compose_file}" up -d thehive >/dev/null
      else
        docker compose -f "${compose_file}" restart thehive >/dev/null
      fi
      if systemctl list-unit-files "${consumer_service}" --no-legend 2>/dev/null | grep -q .; then
        systemctl restart "${consumer_service}"
        echo "  ${instance}: reiniciado + consumer reiniciado"
      else
        echo "  ${instance}: reiniciado"
      fi
      ;;
    status)
      if [[ -z "${current_status}" ]]; then
        echo "  ${instance}: no existe el contenedor ${name}; consumer=${current_consumer_status:-unknown}"
      else
        echo "  ${instance}: contenedor=${current_status} consumer=${current_consumer_status:-unknown}"
      fi
      ;;
    *)
      die "accion no soportada: ${action}"
      ;;
  esac
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -ne 2 ]]; then
    usage
    exit 0
  fi

  local action="$1"
  local target="$2"

  case "${action}" in
    start|stop|restart|status) ;;
    *) die "accion invalida: ${action}" ;;
  esac

  need_root
  require_cmd docker
  validate_number "START_INDEX" "${START_INDEX}"

  local planned=()
  local i count instance
  if [[ "${target}" == "--all" ]]; then
    mapfile -t planned < <(discover_instances)
  else
    validate_number "cantidad" "${target}"
    count="${target}"
    (( count > 0 )) || die "cantidad debe ser mayor que 0"
    for ((i = 0; i < count; i++)); do
      instance="${PREFIX}$((START_INDEX + i))"
      validate_instance "${instance}"
      planned+=("${instance}")
    done
  fi

  if [[ "${#planned[@]}" -eq 0 ]]; then
    echo "No hay instancias para PREFIX=${PREFIX} en ${BASE_DIR}."
    exit 0
  fi

  echo "Accion: ${action}"
  echo "Instancias seleccionadas:"
  for instance in "${planned[@]}"; do
    printf '  %s\n' "${instance}"
  done

  echo
  for instance in "${planned[@]}"; do
    apply_action "${action}" "${instance}"
  done
}

main "$@"
