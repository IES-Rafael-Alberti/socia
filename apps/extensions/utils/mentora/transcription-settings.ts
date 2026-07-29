const STORAGE_KEY = 'mentoraTranscriptionSettings';

export interface TranscriptionSettings {
  openRouterApiKey: string | null;
}

const defaultSettings: TranscriptionSettings = {
  openRouterApiKey: null,
};

export async function loadTranscriptionSettings(): Promise<TranscriptionSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const settings = stored[STORAGE_KEY] as Partial<TranscriptionSettings> | undefined;
  return {
    ...defaultSettings,
    ...settings,
  };
}

export async function saveTranscriptionSettings(
  settings: TranscriptionSettings
): Promise<void> {
  const openRouterApiKey = settings.openRouterApiKey?.trim() || null;
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      openRouterApiKey,
    },
  });
}
