import 'dotenv/config';
import path from 'node:path';

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v && v.length) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing env ${key}`);
}

export const config = {
  port: Number(env('PORT', '4317')),
  adminUser: env('ADMIN_USER', 'admin'),
  adminPass: env('ADMIN_PASS', 'changeme'),
  sessionSecret: env('SESSION_SECRET', 'dev-secret-change-me'),
  openrouterKey: env('OPENROUTER_API_KEY', ''),
  openrouterHintsModel: env('OPENROUTER_MODEL_HINTS', 'xiaomi/mimo-v2-flash'),
  openrouterEvalModel: env('OPENROUTER_MODEL_EVAL', 'xiaomi/mimo-v2-flash'),
  dataDir: path.resolve(env('DATA_DIR', './data')),
  brandId: env('BRAND_ID', ''),
};
