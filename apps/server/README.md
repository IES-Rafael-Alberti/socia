# SOCIA Server

Backend + panel docente para SOCIA. Sirve:

- Una API REST + WebSocket para que la extensión SOCIA hable con el server.
- Un panel web (`/`) con login para que el docente gestione clases, casos,
  seguimiento en directo y evaluaciones.
- Un proxy a OpenRouter para que el alumnado no necesite API key propia.

## Arranque rápido (Docker)

Desde **`apps/server/`** (el `docker-compose.yml` referencia `apps/` como
contexto de build, así que es importante ejecutarlo desde aquí):

```bash
cd apps/server
cp .env.example .env
# edita .env: ADMIN_USER, ADMIN_PASS, SESSION_SECRET, OPENROUTER_API_KEY, BRAND_ID

docker compose up -d
```

El panel queda en `http://<ip-del-host>:4318`. La primera vez que arranca, la
consola muestra el **token de admin** (también accesible en el panel desde
Inicio) que debes pegar en MENTORA si quieres publicar casos directamente.

Datos persistentes (SQLite + workflows + PDFs) viven en el volumen
`socia-data` (ruta interna `/data`). Sobreviven a reinicios y caídas del
contenedor.

## Desarrollo local (sin Docker)

El server vive dentro del workspace pnpm de `apps/`, así que primero
`pnpm install` desde `apps/`. Luego, desde `apps/`:

```bash
cp server/.env.example server/.env
pnpm --filter @socia/server build:panel      # genera panel/dist
pnpm dev:server                              # backend en :4317
# en otra terminal, si quieres el panel con hot-reload:
pnpm dev:server:panel                        # :5173 con proxy a :4317
```

O directamente desde `apps/server/`:

```bash
cd apps/server
pnpm dev                  # backend
pnpm dev:panel            # panel con HMR
pnpm build                # bundle + panel/dist (idéntico al que produce Docker)
```

## Endpoints

### Panel (require admin session o admin token)
- `POST /api/admin/login` — body `{user, pass}` → cookie de sesión
- `POST /api/admin/logout`
- `GET  /api/admin/token` — token para MENTORA
- `POST /api/admin/token/regenerate`
- `GET/POST/DELETE /api/classes` — CRUD clases
- `GET  /api/classes/:id/qr` — QR (SVG) con IP + código
- `GET/DELETE /api/classes/:id/students[/:sid]`
- `GET/POST/DELETE /api/workflows[/:id]`
- `PUT  /api/workflows/:id/assignments` — body `{classIds: string[]}`
- `GET  /api/live/launches`
- `POST /api/live/launch` — body `{workflowId, classId}`
- `POST /api/live/launches/:id/close`
- `GET  /api/live/progress`
- `GET  /api/evals?case=…`
- `GET  /api/evals/:id/pdf`
- `GET  /api/evals/export.zip`
- `WS   /ws/admin` — broadcasts: progress / launches_changed / students_changed

### Estudiante (require Bearer token de estudiante)
- `POST /api/student/connect` — body `{code}` → datos de la clase
- `POST /api/student/identify` — body `{code, name|email}` → bearer token
- `GET  /api/student/me`
- `GET  /api/student/workflows/:id`
- `POST /api/student/progress`
- `POST /api/llm/hint`
- `POST /api/llm/evaluation` → genera PDF en el server
- `GET  /api/llm/evaluation/:id/pdf` (gated por la clase)
- `WS   /ws/student?token=…` — eventos `launch` y `close`

## Variables de entorno

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `PORT` | 4317 | Puerto del server |
| `ADMIN_USER` | admin | Usuario del panel |
| `ADMIN_PASS` | changeme | Contraseña del panel |
| `SESSION_SECRET` | dev-secret-change-me | HMAC de la cookie de sesión |
| `OPENROUTER_API_KEY` | (vacío) | Habilita pistas/eval automáticas |
| `OPENROUTER_MODEL_HINTS` | xiaomi/mimo-v2-flash | Modelo para pistas |
| `OPENROUTER_MODEL_EVAL` | xiaomi/mimo-v2-flash | Modelo para evaluación |
| `DATA_DIR` | ./data (en Docker, /data) | Carpeta del SQLite + ficheros |
| `BRAND_ID` | socia | Logo, colores y firma del PDF de evaluación. IDs en `apps/packages/socia-branding/src/brands/` |
