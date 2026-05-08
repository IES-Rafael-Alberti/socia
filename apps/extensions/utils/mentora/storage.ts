import type { RecordingState } from './messages';

// Recording state stored in extension storage
export interface StoredRecordingState {
  state: RecordingState;
  recordingId: string | null;
  startTime: number | null;
  pausedTime: number | null;
  totalPausedDuration: number;
}

const defaultState: StoredRecordingState = {
  state: 'idle',
  recordingId: null,
  startTime: null,
  pausedTime: null,
  totalPausedDuration: 0,
};

const STORAGE_KEY = 'recordingState';

// Helper functions
export async function getRecordingState(): Promise<StoredRecordingState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY] as StoredRecordingState | undefined;
  return value ?? defaultState;
}

export async function setRecordingState(
  state: Partial<StoredRecordingState>
): Promise<void> {
  const current = await getRecordingState();
  await chrome.storage.local.set({
    [STORAGE_KEY]: { ...current, ...state },
  });
}

export async function startRecording(recordingId: string): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      state: 'recording',
      recordingId,
      startTime: Date.now(),
      pausedTime: null,
      totalPausedDuration: 0,
    },
  });
}

export async function pauseRecording(): Promise<void> {
  const current = await getRecordingState();
  if (current.state === 'recording') {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        ...current,
        state: 'paused',
        pausedTime: Date.now(),
      },
    });
  }
}

export async function resumeRecording(): Promise<void> {
  const current = await getRecordingState();
  if (current.state === 'paused' && current.pausedTime) {
    const pauseDuration = Date.now() - current.pausedTime;
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        ...current,
        state: 'recording',
        pausedTime: null,
        totalPausedDuration: current.totalPausedDuration + pauseDuration,
      },
    });
  }
}

export async function stopRecording(): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY]: defaultState,
  });
}

export async function getElapsedTime(): Promise<number> {
  const current = await getRecordingState();
  if (!current.startTime) return 0;

  const now = current.state === 'paused' && current.pausedTime
    ? current.pausedTime
    : Date.now();

  return now - current.startTime - current.totalPausedDuration;
}

export async function getRelativeTime(): Promise<number> {
  const elapsed = await getElapsedTime();
  return elapsed / 1000; // Return in seconds
}
