import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import type {
  ExportStage,
  RecordingState,
  StartRecordingResponse,
  StateResponse,
  DownloadResponse,
} from '../../../utils/mentora/messages';
import { useSessionState } from '../../../utils/shared/popup-session';
import {
  loadTranscriptionSettings,
  saveTranscriptionSettings,
} from '../../../utils/mentora/transcription-settings';
import {
  isOpenRouterKeyFormatValid,
  type OpenRouterValidationResult,
} from '../../../utils/mentora/openrouter-validation';

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
  const [warning, setWarning] = useState<string | null>(null);
  const [hasRecording, setHasRecording] = useState(false);
  const [exportStage, setExportStage] = useState<ExportStage>('idle');
  const [exportRequest, setExportRequest] = useState<'stop' | 'download' | null>(null);
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState<string | null>(null);
  const [apiKeyStatusIsError, setApiKeyStatusIsError] = useState(false);
  const [isValidatingApiKey, setIsValidatingApiKey] = useState(false);
  const [canStartWithoutTranscription, setCanStartWithoutTranscription] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
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
      setExportStage(response.exportStage ?? (response.isExporting ? 'preparing' : 'idle'));
      setHasDownloaded(response.hasDownloaded ?? false);
      setWarning(response.lastExportWarning || null);

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

  useEffect(() => {
    loadTranscriptionSettings().then((settings) => {
      const apiKey = settings.openRouterApiKey ?? '';
      setOpenRouterApiKey(apiKey);
      if (apiKey && !isOpenRouterKeyFormatValid(apiKey)) {
        setApiKeyStatus('La clave guardada debe empezar por sk-.');
        setApiKeyStatusIsError(true);
      }
    });
  }, []);

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
    if (state !== 'recording' && state !== 'paused' && exportStage === 'idle') return;
    const pollInterval = setInterval(async () => {
      try {
        const response: StateResponse = await sendMessage<StateResponse>({
          type: 'GET_STATE',
        });
        setActionCount(response.actionCount || 0);
        setScreenshotCount(response.screenshotCount || 0);
        setExportStage(response.exportStage ?? (response.isExporting ? 'preparing' : 'idle'));
        setHasDownloaded(response.hasDownloaded ?? false);

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
  }, [state, exportStage]);

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

  const handleStart = async (allowWithoutTranscription = false) => {
    setIsLoading(true);
    setError(null);
    setWarning(null);
    setCanStartWithoutTranscription(false);
    try {
      console.log('[Popup] Starting recording...');
      const response = await sendMessage<StartRecordingResponse>({
        type: 'START_RECORDING',
        allowWithoutTranscription,
      });
      console.log('[Popup] Start response:', response);

      if (!response || !response.success) {
        if (response?.errorCode === 'OPENROUTER_INVALID') {
          setError('La clave de OpenRouter no es válida. Corrígela antes de grabar.');
        } else if (response?.errorCode === 'OPENROUTER_EXHAUSTED') {
          setError('La clave de OpenRouter no tiene saldo disponible.');
        } else if (response?.errorCode === 'OPENROUTER_UNAVAILABLE') {
          setError('No se pudo comprobar OpenRouter. Puedes grabar sin transcripción.');
          setCanStartWithoutTranscription(true);
        } else {
          setError(
            response?.error ||
              'No se pudo empezar. Comprueba el permiso para compartir la pantalla.'
          );
        }
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

  const handleSaveApiKey = async () => {
    const trimmed = openRouterApiKey.trim();
    setApiKeyStatusIsError(false);

    if (trimmed && !isOpenRouterKeyFormatValid(trimmed)) {
      setApiKeyStatus('La clave debe empezar por sk-.');
      setApiKeyStatusIsError(true);
      return;
    }

    setIsValidatingApiKey(true);
    try {
      if (trimmed) {
        const validation = await sendMessage<OpenRouterValidationResult>({
          type: 'VALIDATE_OPENROUTER_KEY',
          apiKey: trimmed,
        });
        if (validation.status !== 'valid') {
          const message =
            validation.status === 'exhausted'
              ? 'La clave no tiene saldo disponible.'
              : validation.status === 'unavailable'
                ? 'No se pudo comprobar OpenRouter.'
                : 'La clave no es válida.';
          setApiKeyStatus(message);
          setApiKeyStatusIsError(true);
          return;
        }
      }

      await saveTranscriptionSettings({
        openRouterApiKey: trimmed || null,
      });
      setOpenRouterApiKey(trimmed);
      setApiKeyStatus(trimmed ? 'Clave comprobada y guardada.' : 'Clave eliminada.');
    } catch {
      setApiKeyStatus('No se pudo comprobar ni guardar la clave.');
      setApiKeyStatusIsError(true);
    } finally {
      setIsValidatingApiKey(false);
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
    setExportRequest('download');
    setError(null);
    try {
      console.log('[Popup] Downloading...');
      const response = await sendMessage<DownloadResponse>({
        type: 'DOWNLOAD_RECORDING',
      });
      console.log('[Popup] Download response:', response);

      if (!response?.success) {
        setError(response?.error || 'Failed to download recording');
      } else {
        // Recording data is kept in IndexedDB so the user can re-download
        // until they start a new recording.
        setHasDownloaded(true);
        setWarning(response.warning || null);
      }
    } catch (err) {
      console.error('[Popup] Download error:', err);
      setError('No se pudo preparar la descarga.');
    } finally {
      setExportRequest(null);
      setExportStage('idle');
    }
  }, []);

  const handleStop = async () => {
    setExportRequest('stop');
    setError(null);
    try {
      console.log('[Popup] Stopping...');
      const response = await sendMessage<DownloadResponse>({
        type: 'STOP_AND_DOWNLOAD',
      });
      console.log('[Popup] Stop response:', response);

      if (response?.success) {
        setState('idle');
        setHasRecording(true);
        setHasDownloaded(true);
        setWarning(response.warning || null);
      } else {
        setError(response?.error || 'No se pudo preparar la descarga.');
        await fetchState();
      }
    } catch (err) {
      console.error('[Popup] Stop error:', err);
      setError('No se pudo detener y preparar la grabación.');
      await fetchState();
    } finally {
      setExportRequest(null);
      setExportStage('idle');
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
  const isPreparingDownload = exportRequest !== null || exportStage !== 'idle';
  const trimmedApiKey = openRouterApiKey.trim();
  const hasInvalidApiKeyFormat =
    trimmedApiKey.length > 0 && !isOpenRouterKeyFormatValid(trimmedApiKey);

  if (isPreparingDownload) {
    const processingText =
      exportStage === 'downloading'
        ? 'Guardando la descarga…'
        : exportStage === 'transcribing'
          ? 'Transcribiendo el audio…'
          : exportStage === 'packaging'
            ? 'Creando el ZIP…'
            : exportStage === 'stopping' || exportRequest === 'stop'
              ? 'Finalizando la grabación y preparando el ZIP…'
              : 'Preparando el ZIP y la transcripción…';

    return (
      <div className="popup">
        <header className="header">
          <h1>MENTORA</h1>
        </header>
        <div className="processing" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <h2>Procesando la grabación</h2>
          <p>{processingText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="popup">
      <header className="header">
        <h1>MENTORA</h1>
        {isRecording && <span className="rec-dot" aria-label="Grabando" />}
      </header>

      <div className="body">
        {error && <div className="error">{error}</div>}
        {warning && <div className="warning" role="status">{warning}</div>}

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
          <>
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
                    : 'El ZIP está listo para descargar.'}
              </p>
            </div>

            <section className="transcription-settings">
              <label htmlFor="openrouter-api-key">Clave de OpenRouter</label>
              <div className="transcription-settings__row">
                <input
                  id="openrouter-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  placeholder="sk-or-v1-…"
                  value={openRouterApiKey}
                  onChange={(event) => {
                    setOpenRouterApiKey(event.target.value);
                    const value = event.target.value.trim();
                    if (value && !isOpenRouterKeyFormatValid(value)) {
                      setApiKeyStatus('La clave debe empezar por sk-.');
                      setApiKeyStatusIsError(true);
                    } else {
                      setApiKeyStatus(null);
                      setApiKeyStatusIsError(false);
                    }
                  }}
                  aria-invalid={hasInvalidApiKeyFormat}
                />
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={handleSaveApiKey}
                  disabled={hasInvalidApiKeyFormat || isValidatingApiKey}
                >
                  {isValidatingApiKey ? 'Comprobando…' : 'Guardar'}
                </button>
              </div>
              <label className="transcription-settings__show">
                <input
                  type="checkbox"
                  checked={showApiKey}
                  onChange={(event) => setShowApiKey(event.target.checked)}
                />
                Mostrar clave
              </label>
              <p>
                Al descargar el ZIP, MENTORA envía el audio a OpenRouter. Sin
                clave no crea la transcripción.
              </p>
              {apiKeyStatus && (
                <span
                  className={
                    apiKeyStatusIsError
                      ? 'transcription-settings__error'
                      : 'transcription-settings__saved'
                  }
                >
                  {apiKeyStatus}
                </span>
              )}
            </section>
          </>
        )}

        <div className={`controls ${isRecording || isPaused ? 'controls--row' : ''}`}>
          {isIdle && (
            <>
              <button
                className="btn btn-primary btn-big btn-block"
                onClick={() => void handleStart()}
                disabled={isLoading}
              >
                {isLoading ? 'Iniciando…' : 'Empezar'}
              </button>
              {canStartWithoutTranscription && (
                <button
                  className="btn btn-secondary btn-block"
                  onClick={() => void handleStart(true)}
                  disabled={isLoading}
                >
                  Grabar sin transcripción
                </button>
              )}
              {hasRecording && (
                <button
                  className="btn btn-secondary btn-block"
                  onClick={handleDownload}
                  disabled={isLoading}
                >
                  {isLoading
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
