# tools/

Artefactos de desarrollo que **no son runtime** del producto pero acompañan al repo.

## `skills/`

[Claude skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) que guían al modelo cuando un docente le pide:

- **`workflow-generator`** — produce un `workflow.json` a partir de una grabación MENTORA (network log + activity log).
- **`guide-generator`** — produce una guía didáctica en PDF a partir de la misma grabación.

Para usarlas con Claude Code o la app de Claude, copia la carpeta de la skill (`SKILL.md` + `references/` + `assets/`) al directorio de skills correspondiente. Ver la documentación oficial de Claude para detalles de instalación.

## `examples/`

- **`workflow-bruteforce-demo.json`** — caso de referencia (ataque de fuerza bruta SSH contra `debianvuln01`). Sirve de plantilla mínima al construir nuevos workflows: dos fases, hitos con dependencias y `network_signature` reales contra TheHive y Graylog.

Este workflow se carga en la extensión SOCIA (modo standalone) o se sube al servidor desde el panel docente.
