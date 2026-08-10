import assert from 'node:assert/strict';
import test from 'node:test';
import type { StudentAction } from '@socia/eval';
import {
  appendAction,
  clearTrace,
  loadTrace,
} from '../../../packages/socia-runtime/src/trace-recorder';


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
            void Promise.resolve().then(() => {
              Object.assign(stored, value);
              callback();
            });
          },
          remove: (key: string, callback: () => void) => {
            delete stored[key];
            callback();
          },
        },
      },
    },
  });
  return stored;
}


const action = (index: number): StudentAction => ({
  type: 'click',
  timestamp: index,
  url: 'https://tool.test',
  elementText: `Acción ${index}`,
});


test('persists every action in order', async () => {
  installStorage();
  const trace: StudentAction[] = [];

  await Promise.all([
    appendAction(trace, action(1)),
    appendAction(trace, action(2)),
    appendAction(trace, action(3)),
  ]);

  assert.deepEqual(
    (await loadTrace()).map((item) => item.timestamp),
    [1, 2, 3],
  );
});

test('does not discard old actions from a long trace', async () => {
  installStorage();
  const trace = Array.from({ length: 5000 }, (_, index) => action(index));

  await appendAction(trace, action(5000));

  assert.equal(trace.length, 5001);
  assert.equal((await loadTrace()).length, 5001);
});

test('waits for pending writes before clearing the trace', async () => {
  installStorage();
  const trace: StudentAction[] = [];

  const pending = appendAction(trace, action(1));
  await clearTrace();
  await pending;

  assert.deepEqual(await loadTrace(), []);
});
