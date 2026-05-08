# Contribuir a SOCIA

¡Gracias por considerar contribuir!

## Setup local

```bash
git clone https://github.com/<usuario>/socia.git
cd socia
pnpm install
```

Comprueba que todo hace build sin errores:

```bash
pnpm build
pnpm typecheck
```

## Variables de entorno

Las extensiones leen unas pocas variables en build-time (Vite las inlinea en el bundle, así que cualquier cambio requiere rebuild). **Todas son opcionales** — las extensiones funcionan sin ellas degradando funcionalidad concreta:

```bash
cp apps/extensions/.env.example apps/extensions/.env
# edita y rellena las claves que necesites
```

Las más relevantes:

- **`EXT_OPENAI_API_KEY`** → MENTORA. Habilita la transcripción Whisper del audio del recording (`transcription.srt`). Sin ella, el recording se exporta sin transcripción.
- **`EXT_OPENROUTER_API_KEY`** → SOCIA. Default compilado para pistas y evaluación en standalone. En la práctica el alumno la mete por Ajustes — solo tiene sentido fijarla aquí si vas a distribuir un build con la clave preconfigurada.

> Todas las variables empiezan por **`EXT_`** (configurado en `apps/extensions/wxt.config.ts`). Cualquier variable sin ese prefijo se ignora — Vite obliga a un prefijo para evitar filtrar secrets server-side al bundle público.

Lista completa y descripción detallada en [`apps/extensions/.env.example`](apps/extensions/.env.example).

El servidor (`apps/server/`) tiene su propio `.env` aparte; ver [`apps/server/.env.example`](apps/server/.env.example) (si existe) o el README del server.

## Estructura

Es un monorepo con dos zonas:

- **Workspace pnpm** (raíz `package.json` + `pnpm-workspace.yaml`):
  - **`apps/extensions/`** — extensiones MENTORA y SOCIA.
  - **`apps/server/`** — backend + panel docente.
  - **`packages/socia-eval/`** y **`packages/socia-runtime/`** — librerías compartidas. Se importan con aliases (`@socia/eval`, `@socia/runtime`).
  - **`tools/`** — utilidades de desarrollo (skills para agentes, ejemplos de workflow).
- **Web pública** (`web/`):
  - **`web/landing/`** y **`web/docs/`** — sites Astro. **Fuera** del workspace pnpm: cada uno tiene su propio install. Si solo tocas las apps, ni los miras.

## Scripts útiles

Desde la raíz (workspace, requiere `pnpm install` previo):

| Comando | Qué hace |
|---|---|
| `pnpm dev:extensions:socia` | Extensión SOCIA en modo desarrollo |
| `pnpm dev:extensions:mentora` | Extensión MENTORA en modo desarrollo |
| `pnpm dev:server` | Backend en `:4317` |
| `pnpm dev:server:panel` | Panel admin en `:5173` (proxy al backend) |
| `pnpm build` | Construye extensiones + server |
| `pnpm typecheck` | TypeScript en todos los workspaces |

Desde `web/landing/` o `web/docs/` (cada uno con su `pnpm install`):

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Arranca el site en `http://localhost:4321` |
| `pnpm build` | Construye el site para producción |

## Pull requests

- Una PR por cambio lógico.
- Descripción clara: qué problema resuelve, cómo probarlo.
- `pnpm build` y `pnpm typecheck` deben pasar (CI lo verifica).
- Si tocas algo del schema de workflow, actualiza también [`tools/skills/workflow-generator`](tools/skills/workflow-generator) y los ejemplos de [`tools/examples/`](tools/examples/).

## Reportar bugs

Issues de GitHub con el siguiente formato:

- **Qué esperabas que pasara**
- **Qué pasó realmente**
- **Pasos para reproducir**
- Versión / SO / navegador
- Logs relevantes (console del navegador, output del server)

## Código de conducta

Sé amable. Asume buena fe. Trata como te gustaría que te tratasen.
