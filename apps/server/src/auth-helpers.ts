import crypto from 'node:crypto';
import { config } from './config.js';

const SESSION_COOKIE = 'socia_admin_session';

function sign(value: string): string {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('hex');
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function verifyAdminCookie(cookieHeader: string): boolean {
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [scope, ts, sig] = parts;
  if (scope !== 'admin') return false;
  if (sign(`${scope}.${ts}`) !== sig) return false;
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age > 30 * 24 * 3600 * 1000) return false;
  return true;
}
