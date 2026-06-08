/**
 * Hint event recorder for SOCIA.
 * Persists the list of hints received by the student during the session,
 * so they can be interleaved with the action trace in the export timeline.
 */

import type { HintEvent } from '@socia/eval';

const HINTS_KEY = 'SOCIA_hint_events';
const MAX_HINTS = 500;

export async function loadHintEvents(): Promise<HintEvent[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(HINTS_KEY, (data) => {
      resolve(data[HINTS_KEY] ?? []);
    });
  });
}

export async function saveHintEvents(events: HintEvent[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [HINTS_KEY]: events }, resolve);
  });
}

export function appendHintEvent(events: HintEvent[], event: HintEvent): HintEvent[] {
  events.push(event);
  if (events.length > MAX_HINTS) {
    events.splice(0, events.length - MAX_HINTS);
  }
  // Always persist hint events immediately — they are few and high-value
  saveHintEvents(events);
  return events;
}

export async function clearHintEvents(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(HINTS_KEY, resolve);
  });
}
