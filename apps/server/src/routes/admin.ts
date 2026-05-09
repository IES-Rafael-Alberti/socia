import { Router } from 'express';
import {
  checkLogin,
  clearSessionCookie,
  makeSessionToken,
  requireAdmin,
  setSessionCookie,
} from '../auth.js';
import { getAdminToken, regenerateAdminToken } from '../db.js';

export const adminRouter = Router();

adminRouter.post('/login', (req, res) => {
  const { user, pass } = req.body ?? {};
  if (typeof user !== 'string' || typeof pass !== 'string' || !checkLogin(user, pass)) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  setSessionCookie(res, makeSessionToken());
  res.json({ ok: true });
});

adminRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

adminRouter.get('/me', requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

adminRouter.get('/token', requireAdmin, (_req, res) => {
  res.json({ token: getAdminToken() });
});

adminRouter.post('/token/regenerate', requireAdmin, (_req, res) => {
  res.json({ token: regenerateAdminToken() });
});
