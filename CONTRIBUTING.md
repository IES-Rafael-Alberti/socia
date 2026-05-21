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

Las extensiones leen unas pocas variables en build-time (Vite las coloca en el bundle, así que cualquier cambio requiere rebuild). **Todas son opcionales** — las extensiones funcionan sin ellas, aunque conlleva cierta pérdida de funcionalidad:

```bash
cp apps/extensions/.env.example apps/extensions/.env
# edita y rellena las claves que necesites
```

Las más relevantes:

- **`EXT_OPENROUTER_API_KEY`** → SOCIA + MENTORA. En SOCIA, la usa para generar pistas y la evaluación en standalone (en la práctica el alumno la mete por Ajustes; solo tiene sentido fijarla aquí si vas a distribuir un build con la clave preconfigurada, no si se usa el panel de control). En MENTORA, habilita la transcripción Whisper del audio del recording (`transcription.srt`); sin ella la grabación se exporta sin la transcripción en el archivo ZIP.

> Todas las variables empiezan por **`EXT_`** (configurado en `apps/extensions/wxt.config.ts`). Cualquier variable sin ese prefijo se ignora.

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

## Añadir un caso nuevo (PR)

Un "caso" en SOCIA es un `workflow.json`: la definición del ejercicio (fases, hitos, firmas de red que prueban que el alumno completó cada paso). Puedes ver un ejemplo completo en [`tools/examples/workflow-bruteforce-demo.json`](tools/examples/workflow-bruteforce-demo.json).

Flujo recomendado para contribuir un caso nuevo:

1. **Créalo con MENTORA.** Instala la extensión MENTORA, ejecuta tú mismo el ejercicio de principio a fin sobre las herramientas reales (TheHive, Graylog, etc.), explicándolo usando tu micrófono y exporta el ZIP. Dentro encontrarás `network-log.json`, `activity-log.json`, `metadata.json` y capturas, así como el vídeo y la transcripción (si pusiste la API KEY).
2. **Genera el `workflow.json`.** Instala el skill [`tools/skills/workflow-generator`](tools/skills/workflow-generator) en el agente que quieras utilizar. Pásale el ZIP de MENTORA como entrada.
3. **Pruébalo con SOCIA.**
   - `pnpm dev:extensions:socia` para arrancar la extensión.
   - Carga el `workflow.json` en SOCIA y completa el caso entero como lo haría un alumno. Verifica que todos los hitos se marcan como completados y que las pistas tienen sentido en orden.
4. **Coloca el archivo.**
   - En [`tools/examples/`](tools/examples/) con nombre `workflow-<slug>.json`.
5. **PR.** Adjunta en la descripción:
   - Resumen pedagógico (1-2 frases): qué se aprende.
   - Herramientas implicadas (TheHive, Graylog, …) y si requieren laboratorio.
   - Captura o nota de la prueba manual en SOCIA (paso 3).

Si el caso requiere extender el schema (un tipo de milestone nuevo, un campo nuevo), hazlo en una PR aparte previa, tocando `tools/skills/workflow-generator/` y los tipos en SOCIA (`packages/socia-eval`, `packages/socia-runtime`). Mantener "cambio de schema" y "caso nuevo" en PRs distintos hace la revisión mucho más fácil.

## Reportar bugs

Issues de GitHub con el siguiente formato:

- **Qué esperabas que pasara**
- **Qué pasó realmente**
- **Pasos para reproducir**
- Versión / SO / navegador
- Logs relevantes (console del navegador, output del server)

## Código de conducta

Sé amable. Asume buena fe. Trata como te gustaría que te tratasen.
