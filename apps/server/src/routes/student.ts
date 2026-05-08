// Student-facing endpoints (called by SOCIA extension in managed mode).
import path from 'node:path';
import { Router } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireStudent, type StudentReq } from '../auth.js';
import { studentToken, uid } from '../util.js';
import { broadcastAdmins } from '../ws.js';

export const studentRouter = Router();

studentRouter.get('/server-info', (_req, res) => {
  res.json({ ok: true, name: 'SOCIA Server', version: 1 });
});

/** Look up class by code; returns whether identification is open + which mode. */
studentRouter.post('/connect', (req, res) => {
  const { code } = req.body ?? {};
  if (typeof code !== 'string' || !code.trim()) {
    res.status(400).json({ error: 'code_required' });
    return;
  }
  const cls = db
    .prepare('SELECT id, name, domain FROM classes WHERE code = ?')
    .get(code.trim().toUpperCase()) as
    | { id: string; name: string; domain: string | null }
    | undefined;
  if (!cls) {
    res.status(404).json({ error: 'class_not_found' });
    return;
  }
  res.json({
    classId: cls.id,
    className: cls.name,
    domainRequired: !!cls.domain,
    domain: cls.domain,
  });
});

/** Identify after `connect`. Returns persistent bearer token. */
studentRouter.post('/identify', (req, res) => {
  const { code, name, email } = req.body ?? {};
  if (typeof code !== 'string') {
    res.status(400).json({ error: 'code_required' });
    return;
  }
  const cls = db
    .prepare('SELECT id, domain FROM classes WHERE code = ?')
    .get(code.trim().toUpperCase()) as { id: string; domain: string | null } | undefined;
  if (!cls) {
    res.status(404).json({ error: 'class_not_found' });
    return;
  }
  const useEmail = !!cls.domain;
  if (useEmail) {
    if (typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'email_required' });
      return;
    }
    const domains = cls.domain!.split(',').map((d) => d.trim().toLowerCase());
    const ok = domains.some((d) =>
      d.startsWith('@') ? email.toLowerCase().endsWith(d) : email.toLowerCase().endsWith('@' + d),
    );
    if (!ok) {
      res.status(400).json({ error: 'domain_not_allowed', allowed: domains });
      return;
    }
  } else {
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name_required' });
      return;
    }
  }
  // existing student?
  if (useEmail) {
    const existing = db
      .prepare('SELECT id, token FROM students WHERE class_id = ? AND email = ?')
      .get(cls.id, email) as { id: string; token: string } | undefined;
    if (existing) {
      res.json({ token: existing.token, studentId: existing.id });
      return;
    }
  }
  const id = uid('st_');
  const token = studentToken();
  const finalName = useEmail ? email.split('@')[0] : name.trim();
  db.prepare(
    `INSERT INTO students (id, class_id, name, email, token, joined_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, cls.id, finalName, useEmail ? email : null, token, Date.now(), Date.now());
  broadcastAdmins({ type: 'students_changed', classId: cls.id });
  res.json({ token, studentId: id });
});

/** Authenticated student endpoints below */
studentRouter.use(requireStudent);

/** Returns current launch for student's class (or null).
 *
 * Excludes launches the student has already finished (progress.status='finished').
 * Once the student presses "Terminar", the case stops being offered to them
 * by `me` until the teacher resets it via /reset-student or launches another.
 *
 * `freshLaunch` is true when no progress row exists for (student, launch) yet:
 * either the student hasn't started, or the teacher just reset them. It lets
 * the extension distinguish "first time" from "already underway" so it can
 * clear its `recentlyFinishedLaunchId` defense flag safely.
 */
studentRouter.get('/me', (req: StudentReq, res) => {
  const s = req.student!;
  const row = db
    .prepare(
      `SELECT l.id AS launchId, l.workflow_id AS workflowId, w.title AS workflowTitle,
              l.launched_at AS launchedAt, l.guided AS guided,
              (SELECT COUNT(1) FROM progress p
                 WHERE p.student_id = ? AND p.launch_id = l.id) AS progressCount
       FROM launches l JOIN workflows w ON w.id = l.workflow_id
       WHERE l.class_id = ? AND l.closed_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM progress pf
           WHERE pf.student_id = ? AND pf.launch_id = l.id AND pf.status = 'finished'
         )
       ORDER BY l.launched_at DESC LIMIT 1`,
    )
    .get(s.id, s.class_id, s.id) as
    | {
        launchId: string;
        workflowId: string;
        workflowTitle: string;
        launchedAt: number;
        guided: number;
        progressCount: number;
      }
    | undefined;
  const launch = row
    ? {
        launchId: row.launchId,
        workflowId: row.workflowId,
        workflowTitle: row.workflowTitle,
        launchedAt: row.launchedAt,
        guided: !!row.guided,
        freshLaunch: row.progressCount === 0,
      }
    : null;
  res.json({ student: { id: s.id, name: s.name, email: s.email }, launch });
});

studentRouter.get('/workflows/:id', (req, res) => {
  const wf = db.prepare('SELECT filename FROM workflows WHERE id = ?').get(req.params.id) as
    | { filename: string }
    | undefined;
  if (!wf) {
    res.status(404).end();
    return;
  }
  res.type('application/json').sendFile(path.join(config.dataDir, 'workflows', wf.filename));
});

/** Push progress update. */
studentRouter.post('/progress', (req: StudentReq, res) => {
  const s = req.student!;
  const { launchId, step, total, status, hints } = req.body ?? {};
  if (typeof launchId !== 'string') {
    res.status(400).json({ error: 'launchId_required' });
    return;
  }
  const launch = db.prepare('SELECT class_id AS classId FROM launches WHERE id = ?').get(
    launchId,
  ) as { classId: string } | undefined;
  if (!launch || launch.classId !== s.class_id) {
    res.status(404).json({ error: 'launch_not_found' });
    return;
  }
  const now = Date.now();
  const existing = db
    .prepare('SELECT student_id FROM progress WHERE student_id = ? AND launch_id = ?')
    .get(s.id, launchId);
  if (existing) {
    db.prepare(
      `UPDATE progress SET step = ?, total = ?, status = ?, hints = ?, updated_at = ?,
                            finished_at = CASE WHEN ? = 'finished' THEN ? ELSE finished_at END
       WHERE student_id = ? AND launch_id = ?`,
    ).run(
      step ?? 0,
      total ?? 0,
      status ?? 'running',
      hints ?? 0,
      now,
      status,
      status === 'finished' ? now : null,
      s.id,
      launchId,
    );
  } else {
    db.prepare(
      `INSERT INTO progress (student_id, launch_id, step, total, status, hints, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(s.id, launchId, step ?? 0, total ?? 0, status ?? 'running', hints ?? 0, now, now);
  }
  broadcastAdmins({
    type: 'progress',
    studentId: s.id,
    classId: s.class_id,
    launchId,
    step,
    total,
    status,
    hints,
  });
  res.json({ ok: true });
});
