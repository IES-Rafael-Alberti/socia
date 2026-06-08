/**
 * Thin client for SOCIA Server endpoints, used by the extension in managed mode.
 */

import { loadServerSettings, normalizeUrl } from './server-settings';

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const s = await loadServerSettings();
  if (!s.serverUrl || !s.studentToken) throw new Error('not_managed');
  const r = await fetch(normalizeUrl(s.serverUrl) + path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${s.studentToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  return r;
}

export async function pingServer(serverUrl: string): Promise<boolean> {
  try {
    const r = await fetch(normalizeUrl(serverUrl) + '/api/student/server-info');
    return r.ok;
  } catch {
    return false;
  }
}

export async function connectClass(serverUrl: string, code: string) {
  const r = await fetch(normalizeUrl(serverUrl) + '/api/student/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: 'unknown' }));
    throw new Error(err.error || 'connect_failed');
  }
  return (await r.json()) as {
    classId: string;
    className: string;
    domainRequired: boolean;
    domain: string | null;
  };
}

export async function identifyStudent(
  serverUrl: string,
  code: string,
  payload: { name?: string; email?: string },
) {
  const r = await fetch(normalizeUrl(serverUrl) + '/api/student/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, ...payload }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: 'unknown' }));
    throw new Error(err.error || 'identify_failed');
  }
  return (await r.json()) as { token: string; studentId: string };
}

export async function fetchMe(): Promise<{
  student: { id: string; name: string; email: string | null };
  launch: {
    launchId: string;
    workflowId: string;
    workflowTitle: string;
    launchedAt: number;
    guided: boolean;
    /** True if no progress row exists yet for this (student, launch). Used by
     *  the extension to detect a teacher-triggered reset and drop its local
     *  "recently finished" defense flag. */
    freshLaunch: boolean;
  } | null;
}> {
  const r = await authedFetch('/api/student/me');
  if (!r.ok) throw new Error('me_failed');
  return r.json();
}

export async function fetchWorkflow(workflowId: string): Promise<unknown> {
  const r = await authedFetch(`/api/student/workflows/${workflowId}`);
  if (!r.ok) throw new Error('workflow_fetch_failed');
  return r.json();
}

export async function postProgress(payload: {
  launchId: string;
  step: number;
  total: number;
  status: 'waiting' | 'running' | 'stuck' | 'finished';
  hints: number;
}): Promise<void> {
  await authedFetch('/api/student/progress', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function requestHintFromServer(payload: {
  caseInstructions: string;
  completed: string[];
  pending: string[];
  previousHints: string[];
}): Promise<string> {
  const r = await authedFetch('/api/llm/hint', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error('hint_failed');
  const json = (await r.json()) as { hint: string };
  return json.hint;
}

export async function postEvaluation(payload: {
  launchId: string;
  workflow: unknown;
  traceExport: unknown;
}): Promise<{ evalId: string; grade: number; pdfAvailable: boolean; error?: string }> {
  const r = await authedFetch('/api/llm/evaluation', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error('evaluation_failed');
  return r.json();
}

export async function downloadEvaluationPdf(evalId: string): Promise<Blob> {
  const r = await authedFetch(`/api/llm/evaluation/${evalId}/pdf`);
  if (!r.ok) throw new Error('pdf_download_failed');
  return r.blob();
}
