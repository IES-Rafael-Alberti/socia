import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { db, getAdminToken } from './db.js';

const SESSION_COOKIE = 'socia_admin_session';

function sign(value: string): string {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('hex');
}

export function makeSessionToken(): string {
  const payload = `admin.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [scope, ts, sig] = parts;
  if (scope !== 'admin') return false;
  if (sign(`${scope}.${ts}`) !== sig) return false;
  // sessions valid 30 days
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age > 30 * 24 * 3600 * 1000) return false;
  return true;
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE);
}

/** Require panel session OR admin bearer token (MENTORA). */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (verifySession(cookieToken)) return next();

  const auth = req.header('authorization');
  if (auth?.startsWith('Bearer ')) {
    const bearer = auth.slice(7).trim();
    if (bearer === getAdminToken()) return next();
  }

  res.status(401).json({ error: 'unauthorized' });
}

/** Require a student bearer token. Attaches student to req. */
export interface StudentReq extends Request {
  student?: { id: string; name: string; email: string | null; class_id: string };
}

export function requireStudent(req: StudentReq, res: Response, next: NextFunction) {
  const auth = req.header('authorization');
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const token = auth.slice(7).trim();
  const row = db
    .prepare('SELECT id, name, email, class_id FROM students WHERE token = ?')
    .get(token) as StudentReq['student'];
  if (!row) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }
  db.prepare('UPDATE students SET last_seen_at = ? WHERE id = ?').run(Date.now(), row.id);
  req.student = row;
  next();
}

export function checkLogin(user: string, pass: string): boolean {
  // constant-time-ish compare
  return (
    user.length === config.adminUser.length &&
    pass.length === config.adminPass.length &&
    crypto.timingSafeEqual(Buffer.from(user), Buffer.from(config.adminUser)) &&
    crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(config.adminPass))
  );
}
