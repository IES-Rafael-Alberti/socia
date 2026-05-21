# SOCIA

**Entrenamiento práctico de ciberseguridad SOC con verificación y calificación automática y retroalimentación personalizada usando un LLM.**

SOCIA es una suite educativa para formación profesional en ciberseguridad. Es una infraestructura de SOC (Security Operations Center) real en la que el alumnado puede resolver casos prácticos de forma guiada.

## Componentes

| App | Qué hace |
|---|---|
| **[Extensión MENTORA](apps/extensions)** | Creación de casos por parte del docente. |
| **[Extensión SOCIA](apps/extensions)** | Registra las acciones del estudiante, ofrece pistas progresivas y genera evaluación al terminar. |
| **[SOCIA Server](apps/server)** | Backend Express + panel React para el docente. Gestiona clases, lanza casos, monitoriza progreso en vivo y centraliza evaluaciones. |
| **[Web pública](web)** | Landing y docs (Astro) del proyecto. |

## Arquitectura

```
socia/
├── apps/                # productos finales (workspace pnpm)
│   ├── extensions/      # MENTORA + SOCIA (proyecto wxt)
│   └── server/          # Express + panel admin
├── packages/            # librerías compartidas (workspace pnpm)
│   ├── socia-eval/      # Tipos de workflow, grading, eval-prompt, PDF
│   └── socia-runtime/   # Cliente, settings, hint-overlay, matcher, engine
├── tools/
│   ├── skills/          # Skills de agentes para generar workflows y guías
│   └── examples/        # workflow.json de referencia
└── web/                 # SITES públicos — fuera del workspace
    ├── landing/         # Astro
    └── docs/            # Astro Starlight
```

> `web/` está deliberadamente fuera del workspace pnpm. Quien clona el repo para usar las apps no instala Astro / Starlight / sharp. Si vas a tocar la web, ver [`web/README.md`](web/README.md).

## Quick start

Requiere [pnpm](https://pnpm.io/) ≥ 9 y Node ≥ 20.

```bash
pnpm install                    # solo apps/ + packages/  (la web no entra)
pnpm build                      # construye extensiones + server
pnpm dev:server:all             # API en :4317 + panel Vite (HMR) en :5173
pnpm dev:extensions:socia       # arranca la extensión SOCIA en modo dev
```

Para trabajar en la web (landing / docs):

```bash
cd web/landing && pnpm install && pnpm dev    # http://localhost:4321
cd web/docs    && pnpm install && pnpm dev    # http://localhost:4321
```

## Modos de uso

- **Standalone**: el alumno carga un workflow.json y trabaja sin servidor. La evaluación se genera localmente con su API key de OpenRouter (opcional).
- **Gestionado**: el docente despliega SOCIA Server, crea clases y asigna casos. El alumnado se conecta con un código y todo el progreso queda centralizado.

Ambos modos soportan **modo guiado** (con checklist visible de hitos) y **no guiado** (solo cronómetro). Las pistas funcionan en ambos.

## Contribuir

- Cómo participar: [CONTRIBUTING.md](CONTRIBUTING.md).
- Trato y comportamiento esperados en la comunidad: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Reportar una vulnerabilidad: ver [SECURITY.md](SECURITY.md) — **no abras un issue público** para vulnerabilidades.

## Licencia

El **código** se distribuye bajo [MIT](LICENSE).

Los **logos y marcas** del IES Rafael Alberti, CIFP N.º 1 Cuenca, Aktios, las herramientas SOC integradas (Wazuh, OPNsense, Velociraptor, Malcolm) y los emblemas de la financiación pública (Ministerio, PRTR, UE) **no** están bajo MIT — pertenecen a sus respectivos titulares. Detalles y procedimiento para sustituirlos al hacer fork en [NOTICE.md](NOTICE.md).
