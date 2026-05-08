import crypto from 'node:crypto';

export function uid(prefix = ''): string {
  return prefix + crypto.randomBytes(8).toString('hex');
}

export function classCode(): string {
  // 4 unambiguous chars (no I/L/O/0/1).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}

export function studentToken(): string {
  return 'st_' + crypto.randomBytes(20).toString('hex');
}
