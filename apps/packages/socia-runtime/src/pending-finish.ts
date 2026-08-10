import type { TraceExport } from '@socia/eval';


const PENDING_FINISH_KEY = 'SOCIA_pendingFinish.v1';

export interface PendingFinish {
  submissionId: string;
  traceExport: TraceExport;
  error: string;
}

export async function loadPendingFinish(): Promise<PendingFinish | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(PENDING_FINISH_KEY, (data) => {
      resolve((data[PENDING_FINISH_KEY] as PendingFinish | undefined) ?? null);
    });
  });
}

export async function savePendingFinish(value: PendingFinish): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PENDING_FINISH_KEY]: value }, resolve);
  });
}

export async function clearPendingFinish(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(PENDING_FINISH_KEY, resolve);
  });
}
