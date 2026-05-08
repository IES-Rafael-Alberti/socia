import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { uid } from '../util.js';
import { broadcastAdmins, sendToClass, sendToStudent } from '../ws.js';

export const liveRouter = Router();

liveRouter.use(requireAdmin);

/** Currently launched cases (one per class). */
liveRouter.get('/launches', (_req, res) => {
  const rows = (db
    .prepare(
      `SELECT l.id, l.workflow_id AS workflowId, l.class_id AS classId,
              l.launched_at AS launchedAt, l.closed_at AS closedAt,
              l.guided AS guided,
              w.title AS workflowTitle, c.name AS className
       FROM launches l
       JOIN workflows w ON w.id = l.workflow_id
       JOIN classes c ON c.id = l.class_id
       WHERE l.closed_at IS NULL
       ORDER BY l.launched_at DESC`,
    )
    .all() as Array<{ guided: number; [k: string]: unknown }>).map((r) => ({
    ...r,
    guided: !!r.guided,
  }));
  res.json({ launches: rows });
});

/** Launch a workflow for a class (or all classes assigned to it). */
liveRouter.post('/launch', (req, res) => {
  const { workflowId, classId, guided } = req.body ?? {};
  if (typeof workflowId !== 'string') {
    res.status(400).json({ error: 'workflowId_required' });
    return;
  }
  const guidedFlag = guided === false ? 0 : 1; // default: guided
  const wf = db.prepare('SELECT id, title FROM workflows WHERE id = ?').get(workflowId) as
    | { id: string; title: string }
    | undefined;
  if (!wf) {
    res.status(404).json({ error: 'workflow_not_found' });
    return;
  }
  const targets = classId
    ? [classId]
    : (db
        .prepare('SELECT class_id AS classId FROM assignments WHERE workflow_id = ?')
        .all(workflowId) as { classId: string }[]).map((r) => r.classId);
  if (targets.length === 0) {
    res.status(400).json({ error: 'no_assignments' });
    return;
  }
  const launches: { id: string; classId: string; guided: boolean }[] = [];
  for (const cid of targets) {
    // close any active launch in this class
    db.prepare(
      `UPDATE launches SET closed_at = ? WHERE class_id = ? AND closed_at IS NULL`,
    ).run(Date.now(), cid);
    const id = uid('lc_');
    db.prepare(
      `INSERT INTO launches (id, workflow_id, class_id, launched_at, guided) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, workflowId, cid, Date.now(), guidedFlag);
    launches.push({ id, classId: cid, guided: !!guidedFlag });
    sendToClass(cid, {
      type: 'launch',
      launchId: id,
      workflowId,
      title: wf.title,
      guided: !!guidedFlag,
    });
  }
  broadcastAdmins({ type: 'launches_changed' });
  res.json({ launches });
});

liveRouter.post('/launches/:id/close', (req, res) => {
  db.prepare('UPDATE launches SET closed_at = ? WHERE id = ?').run(Date.now(), req.params.id);
  const launch = db
    .prepare('SELECT class_id AS classId FROM launches WHERE id = ?')
    .get(req.params.id) as { classId: string } | undefined;
  if (launch) sendToClass(launch.classId, { type: 'close', launchId: req.params.id });
  broadcastAdmins({ type: 'launches_changed' });
  res.json({ ok: true });
});

/**
 * Re-launch the active case for a single student. Useful when the student
 * pressed "Terminar" by mistake, their machine rebooted, etc.
 *
 * Effect: clears their `progress` row for the launch (so the server stops
 * filtering it out of `/api/student/me`) and notifies them via WS so the
 * extension picks it up immediately. Existing `evaluations` rows are kept
 * as historical records; if the student finishes again, a second eval is
 * appended.
 */
liveRouter.post('/launches/:id/reset-student', (req, res) => {
  const launchId = req.params.id;
  const { studentId } = req.body ?? {};
  if (typeof studentId !== 'string' || !studentId.trim()) {
    res.status(400).json({ error: 'studentId_required' });
    return;
  }
  const launch = db
    .prepare(
      'SELECT id, class_id AS classId, closed_at AS closedAt FROM launches WHERE id = ?',
    )
    .get(launchId) as { id: string; classId: string; closedAt: number | null } | undefined;
  if (!launch) {
    res.status(404).json({ error: 'launch_not_found' });
    return;
  }
  if (launch.closedAt !== null) {
    res.status(400).json({ error: 'launch_closed' });
    return;
  }
  const student = db
    .prepare('SELECT id, class_id AS classId FROM students WHERE id = ?')
    .get(studentId) as { id: string; classId: string } | undefined;
  if (!student || student.classId !== launch.classId) {
    res.status(404).json({ error: 'student_not_in_class' });
    return;
  }
  db.prepare('DELETE FROM progress WHERE student_id = ? AND launch_id = ?').run(
    studentId,
    launchId,
  );
  sendToStudent(studentId, { type: 'launch_reset', launchId });
  broadcastAdmins({ type: 'progress' });
  res.json({ ok: true });
});

/** Snapshot of progress in the current active launches. */
liveRouter.get('/progress', (req, res) => {
  const classId = typeof req.query.classId === 'string' ? req.query.classId : null;
  const rows = db
    .prepare(
      `SELECT s.id AS studentId, s.name AS studentName, s.class_id AS classId,
              c.name AS className,
              l.id AS launchId, l.workflow_id AS workflowId,
              w.title AS workflowTitle,
              COALESCE(p.step, 0) AS step,
              COALESCE(p.total, 0) AS total,
              COALESCE(p.status, 'waiting') AS status,
              COALESCE(p.hints, 0) AS hints,
              p.started_at AS startedAt,
              p.updated_at AS updatedAt
       FROM students s
       JOIN classes c ON c.id = s.class_id
       JOIN launches l ON l.class_id = s.class_id AND l.closed_at IS NULL
       JOIN workflows w ON w.id = l.workflow_id
       LEFT JOIN progress p ON p.student_id = s.id AND p.launch_id = l.id
       ${classId ? 'WHERE s.class_id = ?' : ''}
       ORDER BY c.name, s.name`,
    )
    .all(...(classId ? [classId] : []));
  res.json({ progress: rows });
});
