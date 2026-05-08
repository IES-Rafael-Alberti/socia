import { Router } from 'express';
import QRCode from 'qrcode';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { classCode, uid } from '../util.js';

export const classesRouter = Router();

classesRouter.use(requireAdmin);

classesRouter.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.code, c.domain, c.allow_pdf_download AS allowPdfDownload,
              (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS students
       FROM classes c
       ORDER BY c.created_at DESC`,
    )
    .all();
  res.json({ classes: rows });
});

classesRouter.post('/', (req, res) => {
  const { name, domain } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name_required' });
    return;
  }
  let code = classCode();
  while (db.prepare('SELECT 1 FROM classes WHERE code = ?').get(code)) code = classCode();
  const id = uid('cl_');
  db.prepare(
    `INSERT INTO classes (id, name, code, domain, allow_pdf_download, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`,
  ).run(id, name.trim(), code, domain?.trim() || null, Date.now());
  res.json({ id, code });
});

classesRouter.get('/:id', (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  if (!cls) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ class: cls });
});

classesRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM classes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

classesRouter.post('/:id/regenerate-code', (req, res) => {
  const exists = db.prepare('SELECT 1 FROM classes WHERE id = ?').get(req.params.id);
  if (!exists) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  let code = classCode();
  while (db.prepare('SELECT 1 FROM classes WHERE code = ?').get(code)) code = classCode();
  db.prepare('UPDATE classes SET code = ? WHERE id = ?').run(code, req.params.id);
  res.json({ code });
});

classesRouter.patch('/:id', (req, res) => {
  const { name, domain, allowPdfDownload } = req.body ?? {};
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof name === 'string') {
    sets.push('name = ?');
    vals.push(name);
  }
  if (typeof domain === 'string' || domain === null) {
    sets.push('domain = ?');
    vals.push(domain);
  }
  if (typeof allowPdfDownload === 'boolean') {
    sets.push('allow_pdf_download = ?');
    vals.push(allowPdfDownload ? 1 : 0);
  }
  if (sets.length === 0) {
    res.json({ ok: true });
    return;
  }
  vals.push(req.params.id);
  db.prepare(`UPDATE classes SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

classesRouter.get('/:id/students', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, email, joined_at AS joinedAt, last_seen_at AS lastSeenAt
       FROM students WHERE class_id = ?
       ORDER BY joined_at DESC`,
    )
    .all(req.params.id);
  res.json({ students: rows });
});

classesRouter.delete('/:id/students/:sid', (req, res) => {
  db.prepare('DELETE FROM students WHERE id = ? AND class_id = ?').run(
    req.params.sid,
    req.params.id,
  );
  res.json({ ok: true });
});

classesRouter.get('/:id/qr', async (req, res) => {
  const cls = db.prepare('SELECT code FROM classes WHERE id = ?').get(req.params.id) as
    | { code: string }
    | undefined;
  if (!cls) {
    res.status(404).end();
    return;
  }
  const host =
    (req.headers['x-forwarded-host'] as string) || req.headers.host || `localhost`;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  // QR encodes the public landing URL — opens a normal browser page that
  // shows the code and short instructions.
  const url = `${proto}://${host}/join/${encodeURIComponent(cls.code)}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1 });
  res.type('image/svg+xml').send(svg);
});
