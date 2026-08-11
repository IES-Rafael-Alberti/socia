import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { getEventElement } from './event-target';

const originalElement = Object.getOwnPropertyDescriptor(globalThis, 'Element');

class MockElement {}

beforeEach(() => {
  Object.defineProperty(globalThis, 'Element', {
    configurable: true,
    value: MockElement,
  });
});

afterEach(() => {
  if (originalElement) {
    Object.defineProperty(globalThis, 'Element', originalElement);
  } else {
    Reflect.deleteProperty(globalThis, 'Element');
  }
});

test('returns an element used as the direct event target', () => {
  const target = new MockElement();
  const event = { target, composedPath: () => [] } as unknown as Event;

  assert.equal(getEventElement(event), target);
});

test('finds an element in the event path when the direct target is not an element', () => {
  const parent = new MockElement();
  const event = {
    target: { nodeType: 3 },
    composedPath: () => [{ nodeType: 3 }, parent, globalThis],
  } as unknown as Event;

  assert.equal(getEventElement(event), parent);
});

test('returns null when the event has no element', () => {
  const event = {
    target: globalThis,
    composedPath: () => [globalThis],
  } as unknown as Event;

  assert.equal(getEventElement(event), null);
});
