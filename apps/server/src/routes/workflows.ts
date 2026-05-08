import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { config } from '../config.js';
import { uid } from '../util.js';

export const workflowsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function parseAndStore(rawJson: string, originalName: string) {
  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('invalid_json');
  }
  const id = uid('wf_');
  const filename = `${id}.json`;
  const dst = path.join(config.dataDir, 'workflows', filename);

  // If the incoming case.title contains {{vars}}, anchor it as title_template
  // and resolve `case.title` to the interpolated value so the biblioteca is
  // never noisy with raw placeholders.
  const placeholderRe = /\{\{(\w+(?:\.\w+)*)\}\}/g;
  const incomingTitle: string =
    typeof parsed?.case?.title === 'string' ? parsed.case.title : '';
  if (incomingTitle && placeholderRe.test(incomingTitle)) {
    parsed.case.title_template = incomingTitle;
    const vars = (parsed.variables ?? {}) as Record<string, string>;
    parsed.case.title = incomingTitle.replace(
      /\{\{(\w+(?:\.\w+)*)\}\}/g,
      (_m: string, key: string) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : _m,
    );
  }
  fs.writeFileSync(dst, JSON.stringify(parsed, null, 2));

  const title =
    (typeof parsed?.case?.title === 'string' && parsed.case.title) ||
    (typeof parsed.title === 'string' && parsed.title) ||
    (typeof parsed.name === 'string' && parsed.name) ||
    originalName.replace(/\.json$/i, '');
  const minutes =
    typeof parsed.minutes === 'number'
      ? parsed.minutes
      : typeof parsed.estimatedMinutes === 'number'
        ? parsed.estimatedMinutes
        : null;
  const phases = Array.isArray(parsed.phases) ? parsed.phases.length : null;
  const steps = Array.isArray(parsed.phases)
    ? parsed.phases.reduce(
        (acc: number, p: any) => acc + (Array.isArray(p?.milestones) ? p.milestones.length : 0),
        0,
      ) || null
    : Array.isArray(parsed.milestones)
      ? parsed.milestones.length
      : Array.isArray(parsed.steps)
        ? parsed.steps.length
        : null;
  const tools = Array.isArray(parsed.tools) ? parsed.tools.join(',') : null;
  const difficulty = typeof parsed.difficulty === 'string' ? parsed.difficulty : null;
  const finalSize = fs.statSync(dst).size;
  db.prepare(
    `INSERT INTO workflows (id, title, filename, size, minutes, steps, phases, difficulty, tools, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, title, filename, finalSize, minutes, steps, phases, difficulty, tools, Date.now());
  return { id, title };
}

workflowsRouter.use(requireAdmin);

workflowsRouter.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT w.id, w.title, w.size, w.minutes, w.steps, w.phases, w.difficulty, w.tools,
              w.uploaded_at AS uploadedAt,
              (SELECT COUNT(*) FROM assignments a WHERE a.workflow_id = w.id) AS assigned
       FROM workflows w
       ORDER BY w.uploaded_at DESC`,
    )
    .all() as any[];
  res.json({
    workflows: rows.map((r) => ({ ...r, tools: r.tools ? r.tools.split(',') : [] })),
  });
});

workflowsRouter.post('/', upload.single('file'), (req, res) => {
  let raw: string | undefined;
  let originalName = 'workflow.json';
  if (req.file) {
    raw = req.file.buffer.toString('utf8');
    originalName = req.file.originalname || originalName;
  } else if (req.body?.json) {
    raw = typeof req.body.json === 'string' ? req.body.json : JSON.stringify(req.body.json);
    if (typeof req.body.filename === 'string') originalName = req.body.filename;
  }
  if (!raw) {
    res.status(400).json({ error: 'no_file' });
    return;
  }
  try {
    const result = parseAndStore(raw, originalName);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

workflowsRouter.get('/:id', (req, res) => {
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id) as any;
  if (!wf) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const assigned = db
    .prepare('SELECT class_id AS classId FROM assignments WHERE workflow_id = ?')
    .all(req.params.id);
  res.json({
    workflow: { ...wf, tools: wf.tools ? wf.tools.split(',') : [] },
    assigned: assigned.map((a: any) => a.classId),
  });
});

workflowsRouter.get('/:id/file', (req, res) => {
  const wf = db
    .prepare('SELECT title, filename FROM workflows WHERE id = ?')
    .get(req.params.id) as { title: string; filename: string } | undefined;
  if (!wf) {
    res.status(404).end();
    return;
  }
  if (req.query.download) {
    // sanitize title → ascii-ish slug; combining marks stripped via NFD pass.
    const safe = wf.title
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'workflow';
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.json"`);
  }
  res.type('application/json').sendFile(path.join(config.dataDir, 'workflows', wf.filename));
});

/** Return only the variables block — small payload for the config modal. */
workflowsRouter.get('/:id/variables', (req, res) => {
  const wf = db.prepare('SELECT filename FROM workflows WHERE id = ?').get(req.params.id) as
    | { filename: string }
    | undefined;
  if (!wf) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  try {
    const raw = fs.readFileSync(path.join(config.dataDir, 'workflows', wf.filename), 'utf8');
    const parsed = JSON.parse(raw) as { variables?: Record<string, string> };
    res.json({ variables: parsed.variables ?? {} });
  } catch (e) {
    res.status(500).json({ error: 'cannot_read_workflow' });
  }
});

/**
 * Overwrite the variables block of a workflow. Validates that every
 * incoming key already existed (you can't add new variables here, only
 * change values) and that values are strings — otherwise we'd silently
 * break interpolation in the case body.
 */
workflowsRouter.put('/:id/variables', (req, res) => {
  const wf = db.prepare('SELECT filename FROM workflows WHERE id = ?').get(req.params.id) as
    | { filename: string }
    | undefined;
  if (!wf) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const incoming = req.body?.variables;
  if (!incoming || typeof incoming !== 'object') {
    res.status(400).json({ error: 'variables_required' });
    return;
  }

  const filePath = path.join(config.dataDir, 'workflows', wf.filename);
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    res.status(500).json({ error: 'cannot_read_workflow' });
    return;
  }
  const existing = (parsed.variables ?? {}) as Record<string, unknown>;
  const knownKeys = new Set(Object.keys(existing));

  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
    if (!knownKeys.has(k)) continue; // ignore unknown keys silently
    if (typeof v !== 'string') {
      res.status(400).json({ error: 'variable_must_be_string', key: k });
      return;
    }
    next[k] = v;
  }
  // Preserve any keys the client didn't send (defensive — partial updates).
  for (const k of knownKeys) {
    if (!(k in next)) next[k] = String(existing[k] ?? '');
  }

  parsed.variables = next;

  // Re-interpolate case.title if it (or a stored template) references vars.
  // First time we see a title with `{{...}}` we keep a copy in case.title_template
  // so future edits can re-interpolate even after the title has been resolved.
  if (parsed.case && typeof parsed.case === 'object') {
    const placeholderRe = /\{\{(\w+(?:\.\w+)*)\}\}/g;
    const currentTitle: string =
      typeof parsed.case.title === 'string' ? parsed.case.title : '';
    const storedTemplate: string | undefined =
      typeof parsed.case.title_template === 'string'
        ? parsed.case.title_template
        : undefined;

    let template: string | null = null;
    if (placeholderRe.test(currentTitle)) {
      template = currentTitle;
      parsed.case.title_template = currentTitle;
    } else if (storedTemplate && placeholderRe.test(storedTemplate)) {
      template = storedTemplate;
    }
    if (template) {
      parsed.case.title = template.replace(
        /\{\{(\w+(?:\.\w+)*)\}\}/g,
        (_m: string, key: string) =>
          Object.prototype.hasOwnProperty.call(next, key) ? next[key] : _m,
      );
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2));

  // Refresh cached title in the DB so the biblioteca shows the new value.
  const newTitle =
    typeof parsed?.case?.title === 'string' ? parsed.case.title : null;
  if (newTitle) {
    db.prepare('UPDATE workflows SET title = ? WHERE id = ?').run(newTitle, req.params.id);
  }

  res.json({ ok: true, variables: next, title: newTitle });
});

workflowsRouter.delete('/:id', (req, res) => {
  const wf = db.prepare('SELECT filename FROM workflows WHERE id = ?').get(req.params.id) as
    | { filename: string }
    | undefined;
  if (wf) {
    try {
      fs.unlinkSync(path.join(config.dataDir, 'workflows', wf.filename));
    } catch {}
  }
  db.prepare('DELETE FROM workflows WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

workflowsRouter.put('/:id/assignments', (req, res) => {
  const { classIds } = req.body ?? {};
  if (!Array.isArray(classIds)) {
    res.status(400).json({ error: 'classIds_required' });
    return;
  }
  const wfId = req.params.id;
  const tx = db.transaction((ids: string[]) => {
    db.prepare('DELETE FROM assignments WHERE workflow_id = ?').run(wfId);
    const ins = db.prepare(
      'INSERT INTO assignments (workflow_id, class_id) VALUES (?, ?)',
    );
    for (const cid of ids) ins.run(wfId, cid);
  });
  tx(classIds);
  res.json({ ok: true });
});
