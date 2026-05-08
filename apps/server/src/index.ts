import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { adminToken } from './db.js';
import { adminRouter } from './routes/admin.js';
import { classesRouter } from './routes/classes.js';
import { workflowsRouter } from './routes/workflows.js';
import { liveRouter } from './routes/live.js';
import { evalsRouter } from './routes/evals.js';
import { studentRouter } from './routes/student.js';
import { llmRouter } from './routes/llm.js';
import { joinRouter } from './routes/join.js';
import { attachWS } from './ws.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/admin', adminRouter);
app.use('/api/classes', classesRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/live', liveRouter);
app.use('/api/evals', evalsRouter);
app.use('/api/student', studentRouter);
app.use('/api/llm', llmRouter);

// Public student landing — must come BEFORE the SPA fallback below so /join/<code>
// is not swallowed by the panel.
app.use('/join', joinRouter);

// Serve panel SPA
const panelDist = path.resolve(__dirname, '../panel/dist');
const panelDev = path.resolve(__dirname, '../panel/public');
const panelDir = fs.existsSync(panelDist) ? panelDist : panelDev;
app.use(express.static(panelDir));
app.get(/^\/(?!api\/|ws\/|join\/).*/, (_req, res) => {
  const idx = path.join(panelDir, 'index.html');
  if (fs.existsSync(idx)) res.sendFile(idx);
  else res.status(404).send('Panel not built. Run: npm run build:panel');
});

const server = http.createServer(app);
attachWS(server);

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`\nSOCIA Server listening on http://localhost:${config.port}`);
  // Never print full credentials to stdout. In production this stream is
  // captured by docker / journald / kubernetes; anyone with read access
  // to those logs would be able to authenticate. We surface enough hints
  // for the operator to identify the deployment without leaking secrets.
  // Full admin token: visible from the Panel's Inicio screen once
  // logged in, or directly via the SQLite at $DATA_DIR/socia.db.
  const tokenPreview = adminToken.slice(0, 10) + '…';
  console.log(`Admin token (preview):      ${tokenPreview} — full token in the panel`);
  console.log(`Panel login user:           ${config.adminUser}`);
  console.log(`Panel login password:       (see ADMIN_PASS in .env)\n`);
});
