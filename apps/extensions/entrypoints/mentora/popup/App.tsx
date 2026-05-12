import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import type { StateResponse, RecordingState } from '../../../utils/mentora/messages';
import { useSessionState } from '../../../utils/shared/popup-session';

function sendMessage<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response as T);
    });
  });
}

export default function App() {
  const [state, setState] = useState<RecordingState>('idle');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [actionCount, setActionCount] = useState(0);
  const [screenshotCount, setScreenshotCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasRecording, setHasRecording] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [timerCache, setTimerCache] = useSessionState('mentora.timerCache', {
    elapsedTime: 0,
    lastPolledAt: 0,
    state: 'idle' as RecordingState,
  });
  const timerRef = useRef<number | null>(null);
  const baseTimeRef = useRef<number>(0);

  // Rehydrate timer from session cache so the popup shows ~the right elapsed
  // value immediately on remount, instead of restarting from 0 and jumping
  // to the real value when the first GET_STATE response arrives.
  useLayoutEffect(() => {
    if (timerCache.lastPolledAt === 0) return;
    if (timerCache.state === 'recording') {
      const since = Date.now() - timerCache.lastPolledAt;
      const projected = timerCache.elapsedTime + since;
      setElapsedTime(projected);
      baseTimeRef.current = Date.now() - projected;
      setState('recording');
    } else if (timerCache.state === 'paused') {
      setElapsedTime(timerCache.elapsedTime);
      baseTimeRef.current = Date.now() - timerCache.elapsedTime;
      setState('paused');
    }
    // 'idle' → ignore, normal fetchState path will fill in.
    // We deliberately don't `setIsLoading(false)` here; the loading splash
    // is short-lived and the real state lands within ~50ms.
  }, []); // mount only — `timerCache` mutates on every poll write

  const fetchState = useCallback(async () => {
    try {
      const response: StateResponse | undefined = await sendMessage<StateResponse>({
        type: 'GET_STATE',
      });
      console.log('[Popup] State received:', response);

      if (!response) {
        throw new Error('No response from background');
      }

      setState(response.state);
      setActionCount(response.actionCount || 0);
      setScreenshotCount(response.screenshotCount || 0);
      setIsExporting(response.isExporting ?? false);

      // Set elapsed time from background
      if (response.elapsedTime !== undefined) {
        setElapsedTime(response.elapsedTime);
        // Store base time for local timer
        baseTimeRef.current = Date.now() - response.elapsedTime;
        setTimerCache({
          elapsedTime: response.elapsedTime,
          lastPolledAt: Date.now(),
          state: response.state,
        });
      }

      // Check if there's a recording ready to download
      if (response.state === 'idle') {
        if (response.hasRecordingData !== undefined) {
          setHasRecording(response.hasRecordingData);
        } else {
          setHasRecording((response.actionCount || 0) > 0 || (response.screenshotCount || 0) > 0);
        }
      } else {
        setHasRecording(true);
      }

      setIsLoading(false);
    } catch (err) {
      console.error('[Popup] Failed to fetch state:', err);
      chrome.storage.local.get('recordingState', (data) => {
        console.log('[Popup] recordingState from storage:', data?.recordingState);
      });
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Sync state updates from storage changes
  useEffect(() => {
    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local' && changes.recordingState) {
        fetchState();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [fetchState]);

  // Local timer that runs when recording
  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (state === 'recording') {
      console.log('[Popup] Starting local timer');
      // Update every 100ms for smooth display
      timerRef.current = window.setInterval(() => {
        const newElapsed = Date.now() - baseTimeRef.current;
        setElapsedTime(newElapsed);
      }, 100);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state]);

  // Poll for action/screenshot counts (or export progress when idle).
  useEffect(() => {
    if (state !== 'recording' && state !== 'paused' && !isExporting) return;
    const pollInterval = setInterval(async () => {
      try {
        const response: StateResponse = await sendMessage<StateResponse>({
          type: 'GET_STATE',
        });
        setActionCount(response.actionCount || 0);
        setScreenshotCount(response.screenshotCount || 0);
        setIsExporting(response.isExporting ?? false);

        // If paused, also sync the elapsed time
        if (state === 'paused' && response.elapsedTime !== undefined) {
          setElapsedTime(response.elapsedTime);
        }

        // After export finishes, reflect the cleared recording.
        if (response.state === 'idle' && response.hasRecordingData === false) {
          setHasRecording(false);
        }
      } catch (err) {
        console.error('[Popup] Failed to poll state:', err);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [state, isExporting]);

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleStart = async () => {
    setIsLoading(true);
    setError(null);
    try {
      console.log('[Popup] Starting recording...');
      const response = await sendMessage<{ success: boolean; error?: string }>({
        type: 'START_RECORDING',
      });
      console.log('[Popup] Start response:', response);

      if (!response || !response.success) {
        setError(response?.error || 'Failed to start recording. Make sure to allow screen sharing.');
        setIsLoading(false);
        await fetchState();
      } else {
        // Recording started successfully
        setState('recording');
        setElapsedTime(0);
        baseTimeRef.current = Date.now();
        setHasRecording(true);
        setHasDownloaded(false);
        setIsLoading(false);
      }
    } catch (err) {
      console.error('[Popup] Start error:', err);
      setError('Failed to start recording');
      setIsLoading(false);
      await fetchState();
    }
  };

  const handlePause = async () => {
    setIsLoading(true);
    try {
      console.log('[Popup] Pausing...');
      const response = await sendMessage<{ success: boolean; error?: string }>({
        type: 'PAUSE_RECORDING',
      });
      console.log('[Popup] Pause response:', response);

      if (response?.success) {
        setState('paused');
      }
    } catch (err) {
      console.error('[Popup] Pause error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResume = async () => {
    setIsLoading(true);
    try {
      console.log('[Popup] Resuming...');
      const response = await sendMessage<{ success: boolean; error?: string }>({
        type: 'RESUME_RECORDING',
      });
      console.log('[Popup] Resume response:', response);

      if (response?.success) {
        setState('recording');
        // Reset base time for timer
        baseTimeRef.current = Date.now() - elapsedTime;
      }
    } catch (err) {
      console.error('[Popup] Resume error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      console.log('[Popup] Downloading...');
      const response = await sendMessage<{ success: boolean; error?: string }>({
        type: 'DOWNLOAD_RECORDING',
      });
      console.log('[Popup] Download response:', response);

      if (!response?.success) {
        setError(response?.error || 'Failed to download recording');
      } else {
        // Recording data is kept in IndexedDB so the user can re-download
        // until they start a new recording.
        setHasDownloaded(true);
      }
    } catch (err) {
      console.error('[Popup] Download error:', err);
      setError('Failed to download recording');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleStop = async () => {
    setIsLoading(true);
    try {
      console.log('[Popup] Stopping...');
      const response = await sendMessage<{ success: boolean; error?: string }>({
        type: 'STOP_RECORDING',
      });
      console.log('[Popup] Stop response:', response);

      if (response?.success) {
        setState('idle');
        setHasRecording(true);
        setHasDownloaded(false);
        // Auto-export the ZIP so the user doesn't need an extra click. The
        // save dialog will appear once the background finishes packaging.
        await handleDownload();
      }
    } catch (err) {
      console.error('[Popup] Stop error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading && state === 'idle' && !hasRecording) {
    return (
      <div className="popup">
        <header className="header">
          <h1>MENTORA</h1>
        </header>
        <div className="loading">Cargando…</div>
      </div>
    );
  }

  const isRecording = state === 'recording';
  const isPaused = state === 'paused';
  const isIdle = state === 'idle';

  return (
    <div className="popup">
      <header className="header">
        <h1>MENTORA</h1>
        {isRecording && <span className="rec-dot" aria-label="Grabando" />}
      </header>

      <div className="body">
        {error && <div className="error">{error}</div>}

        {/* Active state: dark live card with timer + stats */}
        {(isRecording || isPaused) && (
          <>
            <div className={`live-card ${isPaused ? 'live-card--paused' : ''}`}>
              <div className="live-card__timer">{formatTime(elapsedTime)}</div>
              <div className="live-card__stats">
                <div>
                  <span className="live-card__stat-value">{actionCount}</span>
                  <span className="live-card__stat-label">Acciones</span>
                </div>
                <div>
                  <span className="live-card__stat-value">{screenshotCount}</span>
                  <span className="live-card__stat-label">Capturas</span>
                </div>
              </div>
            </div>

            <div>
              <div className="eyebrow">{isRecording ? 'Grabando' : 'En pausa'}</div>
              <h2 className="title">
                {isRecording
                  ? 'La sesión se está capturando.'
                  : 'Continúa cuando quieras.'}
              </h2>
            </div>
          </>
        )}

        {/* Idle state: clean hero, primary action */}
        {isIdle && (
          <div className="idle-hero">
            <div className="idle-pulse" />
            <h2>
              {!hasRecording
                ? 'Lista para grabar'
                : hasDownloaded
                  ? 'ZIP descargado'
                  : 'Tu grabación está lista'}
            </h2>
            <p>
              {!hasRecording
                ? 'MENTORA captura pantalla, micro y todas las acciones del navegador.'
                : hasDownloaded
                  ? 'Empieza una grabación nueva o vuelve a descargar el ZIP.'
                  : 'Preparando el ZIP…'}
            </p>
          </div>
        )}

        <div className={`controls ${isRecording || isPaused ? 'controls--row' : ''}`}>
          {isIdle && (
            <>
              <button
                className="btn btn-primary btn-big btn-block"
                onClick={handleStart}
                disabled={isLoading}
              >
                {isLoading ? 'Iniciando…' : 'Empezar'}
              </button>
              {hasRecording && (
                <button
                  className="btn btn-secondary btn-block"
                  onClick={handleDownload}
                  disabled={isLoading || isExporting}
                >
                  {isExporting
                    ? 'Exportando…'
                    : isLoading
                      ? 'Preparando…'
                      : hasDownloaded
                        ? 'Volver a descargar'
                        : 'Descargar ZIP'}
                </button>
              )}
            </>
          )}

          {isRecording && (
            <>
              <button
                className="btn btn-secondary"
                onClick={handlePause}
                disabled={isLoading}
              >
                {isLoading ? '…' : 'Pausar'}
              </button>
              <button
                className="btn btn-danger"
                onClick={handleStop}
                disabled={isLoading}
              >
                {isLoading ? '…' : 'Detener'}
              </button>
            </>
          )}

          {isPaused && (
            <>
              <button
                className="btn btn-primary"
                onClick={handleResume}
                disabled={isLoading}
              >
                {isLoading ? '…' : 'Reanudar'}
              </button>
              <button
                className="btn btn-danger"
                onClick={handleStop}
                disabled={isLoading}
              >
                {isLoading ? '…' : 'Detener'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
