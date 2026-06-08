/**
 * Trace recorder.
 * Manages the student's action trace in chrome.storage.local.
 * The trace is the source of truth for post-hoc evaluation.
 */

import type { StudentAction } from '@socia/eval';

const TRACE_KEY = 'SOCIA_trace';
const MAX_ACTIONS = 5000;

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
 * Append an action to the trace. Saves periodically (every 10 actions)
 * to avoid excessive storage writes.
 */
export function appendAction(
  trace: StudentAction[],
  action: StudentAction,
  forceSave: boolean = false
): StudentAction[] {
  trace.push(action);

  // Cap the trace to avoid unbounded growth
  if (trace.length > MAX_ACTIONS) {
    trace.splice(0, trace.length - MAX_ACTIONS);
  }

  // Save periodically or when forced
  if (forceSave || trace.length % 10 === 0) {
    saveTrace(trace);
  }

  return trace;
}

/**
 * Clear the trace from storage.
 */
export async function clearTrace(): Promise<void> {
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
