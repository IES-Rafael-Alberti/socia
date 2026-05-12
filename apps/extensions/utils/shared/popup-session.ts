/**
 * View-state persistence for popups across close/reopen cycles.
 *
 * Chrome MV3 popups are ephemeral: every time they lose focus the DOM is
 * unmounted and React `useState` is lost. `chrome.storage.session` survives
 * the popup close but not the browser restart, which matches the lifetime we
 * want for "is the user in Settings", "is the finish modal open", etc.
 *
 * Source of truth is the in-memory React state; the session storage is a
 * write-through cache rehydrated on mount.
 */

import { useEffect, useLayoutEffect, useState } from 'react';

export type SessionKey =
  | 'socia.showSettings'
  | 'socia.showFinishModal'
  | 'socia.showApiKey'
  | 'mentora.timerCache';

export interface SessionValueMap {
  'socia.showSettings': boolean;
  'socia.showFinishModal': boolean;
  'socia.showApiKey': boolean;
  'mentora.timerCache': { elapsedTime: number; lastPolledAt: number; state: 'idle' | 'recording' | 'paused' };
}

const sessionAvailable =
  typeof chrome !== 'undefined' && !!chrome.storage?.session;

export function useSessionState<K extends SessionKey>(
  key: K,
  defaultValue: SessionValueMap[K],
): [SessionValueMap[K], (v: SessionValueMap[K]) => void] {
  const [value, setValueLocal] = useState<SessionValueMap[K]>(defaultValue);

  // Rehydrate from session storage as early as possible. useLayoutEffect runs
  // before paint, so the user doesn't see a flash of the default value on
  // popups that take more than one frame to render.
  useLayoutEffect(() => {
    if (!sessionAvailable) return;
    chrome.storage.session.get([key], (r) => {
      if (chrome.runtime.lastError) return;
      const stored = r?.[key];
      if (stored !== undefined) setValueLocal(stored as SessionValueMap[K]);
    });
  }, [key]);

  // Cross-popup sync: if a second popup (or the background) writes the same
  // key, reflect it here. Cheap subscription, no-op when disabled.
  useEffect(() => {
    if (!sessionAvailable) return;
    const handler = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'session') return;
      if (key in changes) {
        const next = changes[key].newValue;
        if (next !== undefined) setValueLocal(next as SessionValueMap[K]);
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, [key]);

  const setValue = (v: SessionValueMap[K]) => {
    setValueLocal(v);
    if (sessionAvailable) {
      chrome.storage.session.set({ [key]: v }).catch(() => {
        /* quota / Chrome <102 — memory remains the source of truth */
      });
    }
  };

  return [value, setValue];
}
