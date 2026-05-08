/**
 * Public landing page for students joining a class.
 *
 * Two render modes:
 *   /join/:code         → "phone-friendly" page (the URL students reach by
 *                         scanning the QR with their phone or by typing it).
 *   /join/:code?big=1   → fullscreen "projector" mode used by the teacher to
 *                         project the code from the front of the classroom.
 *                         Bigger type, no chrome, no scrolling.
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import QRCode from 'qrcode';
import { db } from '../db.js';

export const joinRouter = Router();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function publicOrigin(req: Request): string {
  const host =
    (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost';
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  return `${proto}://${host}`;
}

joinRouter.get('/:code', async (req: Request, res: Response) => {
  const code = String(req.params.code || '').toUpperCase().trim();
  const cls = db
    .prepare('SELECT name, code FROM classes WHERE code = ?')
    .get(code) as { name: string; code: string } | undefined;

  const big = req.query.big !== undefined;
  const origin = publicOrigin(req);
  const joinUrl = `${origin}/join/${encodeURIComponent(code)}`;

  if (!cls) {
    res
      .status(404)
      .type('html')
      .send(notFoundPage(code, big));
    return;
  }

  // QR encodes the same join URL — the page is its own destination, so the
  // student can scan from a projection and land back here on their phone.
  const qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1 });
  res.type('html').send(landingPage({
    code: cls.code,
    className: cls.name,
    serverUrl: origin,
    joinUrl,
    qrSvg,
    big,
  }));
});

interface LandingProps {
  code: string;
  className: string;
  serverUrl: string;
  joinUrl: string;
  qrSvg: string;
  big: boolean;
}

function landingPage(p: LandingProps): string {
  const cls = escapeHtml(p.className);
  const code = escapeHtml(p.code);
  const server = escapeHtml(p.serverUrl);
  const big = p.big;
  // The same HTML adapts to "projector" vs "phone" with a body class.
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#0f1116" />
<title>Únete a la clase · ${cls}</title>
<link rel="icon" href="/assets/socia-logo-eye.png" />
${pageStyles()}
</head>
<body class="${big ? 'is-big' : 'is-phone'}">
<main class="join">
  <header class="join__brand">
    <img class="join__logo" src="/assets/socia-logo-eye.png" alt="" />
    <div class="join__brand-text">
      <div class="join__brand-name">SOCIA</div>
      <div class="join__brand-sub">Únete a la clase</div>
    </div>
    ${big ? '' : '<a class="join__project" href="?big=1" target="_blank" rel="noopener">Proyectar ↗</a>'}
  </header>

  <h1 class="join__class">${cls}</h1>

  <section class="join__grid">
    <div class="join__data">
      <div class="join__field">
        <div class="join__label">Servidor</div>
        <div class="join__value join__value--mono">${server}</div>
      </div>
      <div class="join__field">
        <div class="join__label">Código de clase</div>
        <div class="join__code">${code}</div>
      </div>
    </div>
    <div class="join__qr">
      ${p.qrSvg}
      <div class="join__qr-caption">Escanea con el móvil para tener esto a mano</div>
    </div>
  </section>

  <section class="join__steps">
    <ol>
      <li>Instala la extensión <strong>SOCIA</strong> en tu navegador.</li>
      <li>Abre los ajustes de SOCIA (icono ⚙ en la esquina del popup).</li>
      <li>Pega la URL del servidor y el código de clase. Identifícate y listo.</li>
    </ol>
  </section>

  ${big ? '' : '<footer class="join__foot">IES Rafael Alberti · CIFP Cuenca Nº1 · Atkios</footer>'}
</main>
</body>
</html>`;
}

function notFoundPage(code: string, big: boolean): string {
  const c = escapeHtml(code);
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clase no encontrada</title>
${pageStyles()}
</head><body class="${big ? 'is-big' : 'is-phone'}"><main class="join">
  <h1 class="join__class">No encontramos la clase «${c}»</h1>
  <p class="join__nomatch">Comprueba el código con tu profesor.</p>
</main></body></html>`;
}

function pageStyles(): string {
  return `<style>
:root {
  --accent: #e93456;
  --accent-tint: #fff1f4;
  --ink: #14161b;
  --ink-soft: #525866;
  --line: #e6e8ec;
  --bg: #ffffff;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Montserrat', system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--ink);
  line-height: 1.5;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
.join { max-width: 960px; margin: 0 auto; padding: 28px 24px 56px; }

/* Brand bar */
.join__brand {
  display: flex; align-items: center; gap: 12px; margin-bottom: 28px;
}
.join__logo { width: 36px; height: 36px; object-fit: contain; border-radius: 8px; }
.join__brand-name { font-weight: 800; letter-spacing: 0.06em; font-size: 16px; line-height: 1; }
.join__brand-sub { font-size: 10px; letter-spacing: 0.16em; color: var(--ink-soft); text-transform: uppercase; font-weight: 700; margin-top: 4px; }
.join__brand-text { display: flex; flex-direction: column; }
.join__project {
  margin-left: auto;
  font-size: 12px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--accent);
  text-decoration: none;
  border: 1px solid var(--line);
  padding: 7px 12px; border-radius: 999px;
}
.join__project:hover { background: var(--accent-tint); border-color: var(--accent); }

.join__class {
  font-weight: 800;
  letter-spacing: -0.02em;
  font-size: 32px;
  line-height: 1.1;
  margin: 0 0 24px;
  color: var(--ink);
}

.join__grid {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 32px;
  align-items: start;
  margin-bottom: 32px;
}
.join__data { display: flex; flex-direction: column; gap: 22px; }
.join__field {
  background: white;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px 22px;
}
.join__label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--ink-soft);
  margin-bottom: 8px;
}
.join__value {
  font-size: 22px; font-weight: 700; word-break: break-all;
}
.join__value--mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 18px;
}
.join__code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 64px;
  letter-spacing: 0.18em;
  font-weight: 800;
  color: var(--accent);
  line-height: 1;
}

.join__qr {
  background: white;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px;
  text-align: center;
}
.join__qr svg { width: 100%; height: auto; display: block; }
.join__qr-caption {
  margin-top: 10px;
  font-size: 11px;
  color: var(--ink-soft);
}

.join__steps ol {
  padding-left: 24px;
  font-size: 14px;
  color: var(--ink);
  line-height: 1.7;
  margin: 0;
}
.join__steps strong { color: var(--accent); }

.join__foot {
  margin-top: 56px;
  font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-soft);
  text-align: center;
}
.join__nomatch { color: var(--ink-soft); }

/* Phone */
@media (max-width: 720px) {
  .join { padding: 20px 16px 40px; }
  .join__class { font-size: 24px; }
  .join__grid { grid-template-columns: 1fr; gap: 18px; }
  .join__qr { max-width: 280px; margin: 0 auto; }
  .join__code { font-size: 48px; }
}

/* ── Projector mode ───────────────────────────────────────────────────── */
body.is-big {
  background: #0f1116;
  color: white;
}
.is-big .join {
  max-width: 1280px;
  padding: 56px 64px;
  min-height: 100vh;
  display: flex; flex-direction: column;
  justify-content: center;
}
.is-big .join__brand-name { color: white; font-size: 18px; }
.is-big .join__brand-sub { color: rgba(255,255,255,0.5); }
.is-big .join__class {
  font-size: 64px;
  margin: 24px 0 48px;
  color: white;
}
.is-big .join__field {
  background: rgba(255,255,255,0.04);
  border-color: rgba(255,255,255,0.08);
}
.is-big .join__label { color: rgba(255,255,255,0.5); }
.is-big .join__value { color: white; }
.is-big .join__value--mono { font-size: 36px; }
.is-big .join__code {
  font-size: 160px;
  letter-spacing: 0.12em;
  color: var(--accent);
}
.is-big .join__qr {
  background: white;
  padding: 24px;
}
.is-big .join__qr-caption { font-size: 14px; }
.is-big .join__grid {
  grid-template-columns: 1fr 380px;
  gap: 56px;
  margin-bottom: 0;
}
.is-big .join__steps { display: none; }
</style>`;
}
