/**
 * Return the first DOM element associated with an event.
 *
 * Some pages dispatch events whose direct target is a Document, Text node, or
 * another EventTarget. Content scripts must not assume it exposes Element APIs.
 */
export function getEventElement(event: Event): Element | null {
  if (isElement(event.target)) return event.target;

  if (typeof event.composedPath !== 'function') return null;
  return event.composedPath().find(isElement) ?? null;
}

function isElement(value: unknown): value is Element {
  return typeof Element !== 'undefined' && value instanceof Element;
}
