import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { config } from '../config.js';

export const evalsRouter = Router();

evalsRouter.use(requireAdmin);

evalsRouter.get('/', (req, res) => {
  const filter = typeof req.query.case === 'string' ? req.query.case : null;
  const rows = db
    .prepare(
      `SELECT e.id, e.workflow_title AS workflowTitle, e.case_name AS caseName,
              e.steps_done AS stepsDone, e.steps_total AS stepsTotal,
              e.hints, e.duration_seconds AS durationSeconds, e.grade,
              e.closed_at AS closedAt,
              s.name AS studentName, s.email AS studentEmail,
              c.name AS className
       FROM evaluations e
       JOIN students s ON s.id = e.student_id
       JOIN classes c ON c.id = s.class_id
       ${filter ? 'WHERE e.case_name = ?' : ''}
       ORDER BY e.closed_at DESC`,
    )
    .all(...(filter ? [filter] : []));
  res.json({ evaluations: rows });
});

evalsRouter.get('/:id/pdf', (req, res) => {
  const e = db.prepare('SELECT pdf_path AS pdfPath FROM evaluations WHERE id = ?').get(
    req.params.id,
  ) as { pdfPath: string | null } | undefined;
  if (!e?.pdfPath) {
    res.status(404).end();
    return;
  }
  const fp = path.isAbsolute(e.pdfPath) ? e.pdfPath : path.join(config.dataDir, e.pdfPath);
  if (!fs.existsSync(fp)) {
    res.status(404).end();
    return;
  }
  res.type('application/pdf').sendFile(fp);
});

evalsRouter.delete('/:id', (req, res) => {
  const e = db.prepare('SELECT pdf_path AS pdfPath FROM evaluations WHERE id = ?').get(
    req.params.id,
  ) as { pdfPath: string | null } | undefined;
  if (e?.pdfPath) {
    const fp = path.isAbsolute(e.pdfPath) ? e.pdfPath : path.join(config.dataDir, e.pdfPath);
    try {
      fs.unlinkSync(fp);
    } catch {}
  }
  db.prepare('DELETE FROM evaluations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

evalsRouter.delete('/', (req, res) => {
  const filter = typeof req.query.case === 'string' ? req.query.case : null;
  const rows = db
    .prepare(
      `SELECT id, pdf_path AS pdfPath FROM evaluations ${filter ? 'WHERE case_name = ?' : ''}`,
    )
    .all(...(filter ? [filter] : [])) as { id: string; pdfPath: string | null }[];
  for (const r of rows) {
    if (r.pdfPath) {
      const fp = path.isAbsolute(r.pdfPath) ? r.pdfPath : path.join(config.dataDir, r.pdfPath);
      try {
        fs.unlinkSync(fp);
      } catch {}
    }
  }
  db.prepare(`DELETE FROM evaluations ${filter ? 'WHERE case_name = ?' : ''}`).run(
    ...(filter ? [filter] : []),
  );
  res.json({ ok: true, deleted: rows.length });
});

evalsRouter.get('/export.zip', (req, res) => {
  const filter = typeof req.query.case === 'string' ? req.query.case : null;
  const rows = db
    .prepare(
      `SELECT e.id, e.case_name AS caseName, e.grade, e.steps_done AS stepsDone,
              e.steps_total AS stepsTotal, e.hints, e.duration_seconds AS durationSeconds,
              e.closed_at AS closedAt, e.pdf_path AS pdfPath,
              s.name AS studentName, s.email AS studentEmail
       FROM evaluations e
       JOIN students s ON s.id = e.student_id
       ${filter ? 'WHERE e.case_name = ?' : ''}
       ORDER BY e.closed_at DESC`,
    )
    .all(...(filter ? [filter] : [])) as any[];

  res.attachment('evaluaciones.zip').type('application/zip');
  const archive = archiver('zip');
  archive.on('error', (err) => res.status(500).send(err.message));
  archive.pipe(res);

  const csv = [
    ['estudiante', 'correo', 'caso', 'cerrado', 'pasos', 'total', 'pistas', 'duracion_s', 'nota'].join(
      ',',
    ),
    ...rows.map((r) =>
      [
        JSON.stringify(r.studentName ?? ''),
        JSON.stringify(r.studentEmail ?? ''),
        JSON.stringify(r.caseName ?? ''),
        new Date(r.closedAt).toISOString(),
        r.stepsDone,
        r.stepsTotal,
        r.hints,
        r.durationSeconds,
        r.grade,
      ].join(','),
    ),
  ].join('\n');
  archive.append(csv, { name: 'evaluaciones.csv' });

  for (const r of rows) {
    if (!r.pdfPath) continue;
    const fp = path.isAbsolute(r.pdfPath) ? r.pdfPath : path.join(config.dataDir, r.pdfPath);
    if (fs.existsSync(fp)) {
      const safe = `${r.studentName.replace(/[^a-z0-9 ._-]/gi, '_')} — ${r.caseName.replace(/[^a-z0-9 ._-]/gi, '_')}.pdf`;
      archive.file(fp, { name: safe });
    }
  }
  archive.finalize();
});
