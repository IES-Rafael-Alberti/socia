import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  sendRuntimeMessage,
  sendRuntimeMessageSilently,
} from '../../../packages/socia-runtime/src/runtime-messaging';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
  if (originalChrome) {
    Object.defineProperty(globalThis, 'chrome', originalChrome);
  } else {
    Reflect.deleteProperty(globalThis, 'chrome');
  }
});

function setChrome(runtime: Partial<typeof chrome.runtime>) {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime },
  });
}

test('resolves with the runtime response', async () => {
  setChrome({
    sendMessage: ((_message: unknown, callback: (response: unknown) => void) => {
      callback({ success: true });
    }) as typeof chrome.runtime.sendMessage,
  });

  const response = await sendRuntimeMessage<{ success: boolean }>({ type: 'TEST' });

  assert.deepEqual(response, { success: true });
});

test('turns a synchronous invalidated-context error into a rejection', async () => {
  setChrome({
    sendMessage: (() => {
      throw new Error('Extension context invalidated.');
    }) as typeof chrome.runtime.sendMessage,
  });

  await assert.rejects(
    sendRuntimeMessage({ type: 'TEST' }),
    /Extension context invalidated/
  );
});

test('does not throw when a fire-and-forget message uses an invalid context', async () => {
  setChrome({
    sendMessage: (() => {
      throw new Error('Extension context invalidated.');
    }) as typeof chrome.runtime.sendMessage,
  });

  assert.doesNotThrow(() => sendRuntimeMessageSilently({ type: 'TEST' }));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
});

test('rejects when Chrome reports runtime.lastError', async () => {
  setChrome({
    lastError: { message: 'Could not establish connection.' },
    sendMessage: ((_message: unknown, callback: (response: unknown) => void) => {
      callback(undefined);
    }) as typeof chrome.runtime.sendMessage,
  });

  await assert.rejects(
    sendRuntimeMessage({ type: 'TEST' }),
    /Could not establish connection/
  );
});
