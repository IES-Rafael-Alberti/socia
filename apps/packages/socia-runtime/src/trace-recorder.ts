/**
 * Trace recorder.
 * Manages the student's action trace in chrome.storage.local.
 * The trace is the source of truth for post-hoc evaluation.
 */

import type { StudentAction } from '@socia/eval';

const TRACE_KEY = 'SOCIA_trace';

/**
 * Load the full student trace from storage.
 */
export async function loadTrace(): Promise<StudentAction[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(TRACE_KEY, (data) => {
      resolve(data[TRACE_KEY] ?? []);
    });
  });
}

/**
 * Save the full trace to storage.
 */
export async function saveTrace(trace: StudentAction[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [TRACE_KEY]: trace }, resolve);
  });
}

/**
 * Append an action to the trace and persist an immutable snapshot. Writes are
 * serialized so a slower earlier write cannot replace a newer trace.
 */
let traceWriteQueue: Promise<void> = Promise.resolve();

function queueTraceSave(trace: StudentAction[]): Promise<void> {
  const snapshot = trace.map((action) => ({ ...action }));
  const operation = traceWriteQueue
    .catch(() => undefined)
    .then(() => saveTrace(snapshot));
  traceWriteQueue = operation;
  return operation;
}

export async function appendAction(
  trace: StudentAction[],
  action: StudentAction,
): Promise<void> {
  trace.push(action);
  await queueTraceSave(trace);
}

/**
 * Clear the trace from storage.
 */
export async function clearTrace(): Promise<void> {
  await traceWriteQueue.catch(() => undefined);
  return new Promise((resolve) => {
    chrome.storage.local.remove(TRACE_KEY, resolve);
  });
}

/**
 * Get actions from the trace that occurred while on URLs matching a pattern.
 * Used to extract actions for a specific phase.
 */
export function getActionsForPhase(
  trace: StudentAction[],
  urlPattern: string
): StudentAction[] {
  try {
    const regex = new RegExp(urlPattern, 'i');
    return trace.filter((a) => a.url && regex.test(a.url));
  } catch {
    return [];
  }
}
