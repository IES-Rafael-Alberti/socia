import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'workflows'), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'evaluations'), { recursive: true });

export const db = new Database(path.join(config.dataDir, 'socia.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  domain TEXT,
  allow_pdf_download INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  token TEXT NOT NULL UNIQUE,
  joined_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  minutes INTEGER,
  steps INTEGER,
  phases INTEGER,
  difficulty TEXT,
  tools TEXT,
  uploaded_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (workflow_id, class_id)
);

CREATE TABLE IF NOT EXISTS launches (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  launched_at INTEGER NOT NULL,
  closed_at INTEGER,
  guided INTEGER NOT NULL DEFAULT 1,
  UNIQUE(workflow_id, class_id, launched_at)
);

CREATE TABLE IF NOT EXISTS progress (
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  launch_id TEXT NOT NULL REFERENCES launches(id) ON DELETE CASCADE,
  step INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | running | stuck | finished
  hints INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY (student_id, launch_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  launch_id TEXT NOT NULL REFERENCES launches(id) ON DELETE CASCADE,
  workflow_title TEXT NOT NULL,
  case_name TEXT NOT NULL,
  steps_done INTEGER NOT NULL,
  steps_total INTEGER NOT NULL,
  hints INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  grade REAL NOT NULL,
  pdf_path TEXT,
  closed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_assignments_class ON assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_progress_launch ON progress(launch_id);
CREATE INDEX IF NOT EXISTS idx_evals_student ON evaluations(student_id);
`);

// Migrations for older DBs that pre-date a column.
try {
  db.exec('ALTER TABLE launches ADD COLUMN guided INTEGER NOT NULL DEFAULT 1');
} catch {
  // Column already exists — ignore.
}

// First-run admin token
function ensureAdminToken(): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_token') as
    | { value: string }
    | undefined;
  if (row) return row.value;
  const token = 'sk-soc-' + crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('admin_token', token);
  return token;
}

export const adminToken = ensureAdminToken();

export function regenerateAdminToken(): string {
  const token = 'sk-soc-' + crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(token, 'admin_token');
  return token;
}

export function getAdminToken(): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_token') as {
    value: string;
  };
  return row.value;
}
