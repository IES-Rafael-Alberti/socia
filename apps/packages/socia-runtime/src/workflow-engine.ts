/**
 * Workflow engine for SOCIA.
 * Manages state (current phase, timer, completed milestones) and storage.
 */

import type { SociaState, WorkflowData } from '@socia/eval';

const STORAGE_KEY = 'SOCIA_state';
const WORKFLOW_KEY = 'SOCIA_workflow';

// ──────────────── State Creation ────────────────

export function createInitialState(workflow: WorkflowData): SociaState {
  const now = Date.now();
  // The student enters phase 0 immediately at session start
  const firstPhaseId = workflow.phases[0]?.id;
  return {
    workflowId: workflow.case.id,
    workflowName: workflow.case.title,
    currentPhaseIndex: 0,
    timerStartTime: now,
    isActive: true,
    completedMilestones: [],
    milestoneCompletedAt: {},
    phaseEnteredAt: firstPhaseId ? { [firstPhaseId]: now } : {},
  };
}

// ──────────────── Storage ────────────────

export async function loadStateFromStorage(): Promise<SociaState | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      resolve(data[STORAGE_KEY] ?? null);
    });
  });
}

export async function loadWorkflowFromStorage(): Promise<WorkflowData | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(WORKFLOW_KEY, (data) => {
      resolve(data[WORKFLOW_KEY] ?? null);
    });
  });
}

export async function saveStateToStorage(state: SociaState): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: state }, resolve);
  });
}

export async function saveWorkflowToStorage(workflow: WorkflowData): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [WORKFLOW_KEY]: workflow }, resolve);
  });
}

export async function clearAllFromStorage(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEY, WORKFLOW_KEY], resolve);
  });
}

// ──────────────── Timer ────────────────

export function getElapsedSeconds(state: SociaState): number {
  return Math.floor((Date.now() - state.timerStartTime) / 1000);
}
