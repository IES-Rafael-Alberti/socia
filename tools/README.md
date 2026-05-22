# tools/

Artefactos de desarrollo que **no son runtime** del producto pero acompañan al repo.

## `skills/`

[Claude skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) que guían al modelo cuando un docente le pide:

- **`workflow-generator`** — produce un `workflow.json` a partir de una grabación MENTORA (network log + activity log).
- **`guide-generator`** — produce una guía didáctica en PDF a partir de la misma grabación.

En cada release se publican también como artefactos `.skill`: cada archivo es un ZIP con la carpeta de la skill (`SKILL.md` + `references/`, `assets/`, `scripts/` u otros recursos propios). Si el agente no admite el formato `.skill`, cambia la extensión a `.zip`, descomprímelo y sigue las instrucciones de instalación de skills propias de ese agente.

Para usarlas desde el repo, copia la carpeta de la skill (`SKILL.md` + sus recursos) al directorio de skills correspondiente del agente. Ver la documentación oficial del agente para detalles de instalación.

## `examples/`

- **`workflow-bruteforce-demo.json`** — caso de referencia (ataque de fuerza bruta SSH contra `debianvuln01`). Sirve de plantilla mínima al construir nuevos workflows: dos fases, hitos con dependencias y `network_signature` reales contra TheHive y Graylog.

Este workflow se carga en la extensión SOCIA (modo standalone) o se sube al servidor desde el panel docente.
