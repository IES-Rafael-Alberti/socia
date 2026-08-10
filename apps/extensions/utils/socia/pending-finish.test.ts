import assert from 'node:assert/strict';
import test from 'node:test';
import type { PendingFinish } from '../../../packages/socia-runtime/src/pending-finish';
import {
  clearPendingFinish,
  loadPendingFinish,
  savePendingFinish,
} from '../../../packages/socia-runtime/src/pending-finish';


function installStorage() {
  const stored: Record<string, unknown> = {};
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        local: {
          get: (key: string, callback: (value: Record<string, unknown>) => void) => {
            callback({ [key]: stored[key] });
          },
          set: (value: Record<string, unknown>, callback: () => void) => {
            Object.assign(stored, value);
            callback();
          },
          remove: (key: string, callback: () => void) => {
            delete stored[key];
            callback();
          },
        },
      },
    },
  });
}


const pending: PendingFinish = {
  submissionId: 'submission-1',
  error: 'Servidor no disponible',
  traceExport: {
    exported_at: '2026-08-09T12:00:00.000Z',
    case_id: 'case-1',
    session: {
      started_at: '2026-08-09T11:50:00.000Z',
      finished_at: '2026-08-09T12:00:00.000Z',
      duration: '10:00',
      duration_seconds: 600,
      mode: 'guided',
    },
    outcome: {
      milestones_completed: ['one'],
      milestones_total: 1,
      completion_rate: 1,
      by_phase: [],
      milestones: [{ id: 'one', completed_at: '05:00' }],
    },
    timeline: [],
  },
};


test('keeps the same submission and trace for a retry', async () => {
  installStorage();
  await savePendingFinish(pending);

  assert.deepEqual(await loadPendingFinish(), pending);
});

test('clears a pending finish only after completion or cancellation', async () => {
  installStorage();
  await savePendingFinish(pending);
  await clearPendingFinish();

  assert.equal(await loadPendingFinish(), null);
});
