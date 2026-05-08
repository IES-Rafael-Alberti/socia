import { useState, useEffect, useCallback, useRef } from 'react';
import type { StateResponse, RecordingState } from '../../../utils/mentora/messages';

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
  const timerRef = useRef<number | null>(null);
  const baseTimeRef = useRef<number>(0);

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

      // Set elapsed time from background
      if (response.elapsedTime !== undefined) {
        setElapsedTime(response.elapsedTime);
        // Store base time for local timer
        baseTimeRef.current = Date.now() - response.elapsedTime;
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

  // Poll for action/screenshot counts
  useEffect(() => {
    if (state === 'recording' || state === 'paused') {
      const pollInterval = setInterval(async () => {
        try {
          const response: StateResponse = await sendMessage<StateResponse>({
            type: 'GET_STATE',
          });
          setActionCount(response.actionCount || 0);
          setScreenshotCount(response.screenshotCount || 0);

          // If paused, also sync the elapsed time
          if (state === 'paused' && response.elapsedTime !== undefined) {
            setElapsedTime(response.elapsedTime);
          }
        } catch (err) {
          console.error('[Popup] Failed to poll state:', err);
        }
      }, 2000);

      return () => clearInterval(pollInterval);
    }
  }, [state]);

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
      }
    } catch (err) {
      console.error('[Popup] Stop error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
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
        setHasRecording(false);
        setActionCount(0);
        setScreenshotCount(0);
        setElapsedTime(0);
      }
    } catch (err) {
      console.error('[Popup] Download error:', err);
      setError('Failed to download recording');
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
            <h2>{hasRecording ? 'Tu grabación está lista' : 'Lista para grabar'}</h2>
            <p>
              {hasRecording
                ? 'Descárgala como ZIP o empieza una nueva grabación.'
                : 'MENTORA captura pantalla, micro y todas las acciones del navegador.'}
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
                  disabled={isLoading}
                >
                  {isLoading ? 'Preparando…' : 'Descargar ZIP'}
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
