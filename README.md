# SOCIA

**Infraestructura educativa abierta para entrenar la gestión de incidentes en un SOC, con herramientas profesionales, casos prácticos y acompañamiento basado en IA.**

SOCIA es un proyecto de formación práctica en ciberseguridad para FP. Incluye una infraestructura de SOC (Security Operations Center) desplegable, casos de investigación, documentación docente y aplicaciones para crear, lanzar, seguir y evaluar ejercicios con alumnado.

Para una visión general del proyecto, consulta la [web oficial](https://socia.fpciberseguridad.com/). La documentación técnica y didáctica está en [socia.fpciberseguridad.com/docs](https://socia.fpciberseguridad.com/docs/).

## Componentes

| Componente | Qué contiene |
|---|---|
| **[Infraestructura SOC](infra)** | Despliegues, configuraciones y material para montar el entorno de prácticas con herramientas open source propias de un SOC. |
| **[Casos prácticos](exercises)** | Workflows y ejercicios que puede resolver el alumnado con la extensión SOCIA. |
| **[Aplicaciones SOCIA](apps)** | La capa de Inteligencia Artificial del proyecto. Extensiones de navegador, panel web, librerías internas y skills para agentes. |
| **[Web pública y documentación](web)** | Landing del proyecto y documentación web construida con Astro y Starlight. |

## Arquitectura

```
socia/
├── apps/                # workspace pnpm de aplicaciones y librerías internas
│   ├── extensions/      # MENTORA + SOCIA (proyecto wxt)
│   ├── server/          # Express + panel admin
│   ├── packages/        # librerías internas compartidas por extensions/server
│   └── skills/          # skills de agente para el flujo MENTORA
├── exercises/           # workflows/casos prácticos para SOCIA
├── infra/               # despliegues, laboratorios y material
└── web/                 # webs públicas
    ├── landing/         # Astro
    └── docs/            # Astro Starlight
```

> `web/` está deliberadamente fuera del workspace pnpm de `apps/`. Quien clona el repo para usar las apps no instala Astro / Starlight / sharp. Si vas a tocar la web, ver [`web/README.md`](web/README.md).

## Desarrollo de aplicaciones

Requiere [pnpm](https://pnpm.io/) ≥ 9 y Node ≥ 20.

```bash
cd apps
pnpm install                    # solo extensions/ + server/ + packages/
pnpm build                      # construye extensiones + server
pnpm dev:server:all             # API en :4317 + panel Vite (HMR) en :5173
pnpm dev:extensions:socia       # arranca la extensión SOCIA en modo dev
```

Para trabajar en la web (landing / docs):

```bash
cd web/landing && pnpm install && pnpm dev    # http://localhost:4321
cd web/docs    && pnpm install && pnpm dev    # http://localhost:4321
```

## Contribuir

- Cómo participar: [CONTRIBUTING.md](CONTRIBUTING.md).
- Trato y comportamiento esperados en la comunidad: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Reportar una vulnerabilidad: ver [SECURITY.md](SECURITY.md) — **no abras un issue público** para vulnerabilidades.

## Licencia

El **código** se distribuye bajo [MIT](LICENSE).

Los **logos y marcas** del IES Rafael Alberti, CIFP N.º 1 Cuenca, Aktios, las herramientas SOC integradas (Wazuh, OPNsense, Velociraptor, Malcolm) y los emblemas de la financiación pública (Ministerio, PRTR, UE) **no** están bajo MIT — pertenecen a sus respectivos titulares. Detalles y procedimiento para sustituirlos al hacer fork en [NOTICE.md](NOTICE.md).
