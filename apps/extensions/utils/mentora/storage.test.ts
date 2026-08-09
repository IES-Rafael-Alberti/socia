import assert from 'node:assert/strict';
import test from 'node:test';
import { getRecordingState, stopRecording } from './storage';

test('keeps the recording ID after stopping', async () => {
  let stored: Record<string, unknown> = {
    recordingState: {
      state: 'recording',
      recordingId: 'recording-test',
      startTime: 123,
      pausedTime: null,
      totalPausedDuration: 0,
    },
  };

  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        local: {
          get: async () => stored,
          set: async (value: Record<string, unknown>) => {
            stored = { ...stored, ...value };
          },
        },
      },
    },
  });

  await stopRecording('recording-test');
  const state = await getRecordingState();

  assert.equal(state.state, 'idle');
  assert.equal(state.recordingId, 'recording-test');
  assert.equal(state.startTime, null);
});

test('can clear a stale recording ID after a failed start', async () => {
  let stored: Record<string, unknown> = {
    recordingState: {
      state: 'idle',
      recordingId: 'stale-recording',
      startTime: null,
      pausedTime: null,
      totalPausedDuration: 0,
    },
  };

  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        local: {
          get: async () => stored,
          set: async (value: Record<string, unknown>) => {
            stored = { ...stored, ...value };
          },
        },
      },
    },
  });

  await stopRecording(null);
  assert.equal((await getRecordingState()).recordingId, null);
});
