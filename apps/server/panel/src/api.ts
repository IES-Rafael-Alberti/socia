async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    throw new ApiAuthError();
  }
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`${r.status}: ${txt}`);
  }
  if (r.headers.get('content-type')?.includes('application/json')) {
    return (await r.json()) as T;
  }
  return undefined as T;
}

export class ApiAuthError extends Error {
  constructor() {
    super('unauthorized');
  }
}

export const api = {
  get: <T>(url: string) => req<T>('GET', url),
  post: <T>(url: string, body?: unknown) => req<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => req<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => req<T>('PATCH', url, body),
  del: <T>(url: string) => req<T>('DELETE', url),
  upload: async (url: string, file: File): Promise<unknown> => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(url, { method: 'POST', credentials: 'include', body: fd });
    if (r.status === 401) throw new ApiAuthError();
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    return r.json();
  },
};

export interface ClassRow {
  id: string;
  name: string;
  code: string;
  domain: string | null;
  allowPdfDownload: number;
  students: number;
}

export interface StudentRow {
  id: string;
  name: string;
  email: string | null;
  joinedAt: number;
  lastSeenAt: number | null;
}

export interface WorkflowRow {
  id: string;
  title: string;
  size: number;
  minutes: number | null;
  steps: number | null;
  phases: number | null;
  difficulty: string | null;
  tools: string[];
  uploadedAt: number;
  assigned: number;
}

export interface ProgressRow {
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  launchId: string;
  workflowId: string;
  workflowTitle: string;
  step: number;
  total: number;
  status: 'waiting' | 'running' | 'stuck' | 'finished';
  hints: number;
  startedAt: number | null;
  updatedAt: number | null;
}

export interface EvalRow {
  id: string;
  workflowTitle: string;
  caseName: string;
  stepsDone: number;
  stepsTotal: number;
  hints: number;
  durationSeconds: number;
  grade: number;
  closedAt: number;
  studentName: string;
  studentEmail: string | null;
  className: string;
}

export interface WorkflowVariables {
  [key: string]: string;
}

export interface LaunchRow {
  id: string;
  workflowId: string;
  classId: string;
  workflowTitle: string;
  className: string;
  launchedAt: number;
  closedAt: number | null;
  guided: boolean;
}
