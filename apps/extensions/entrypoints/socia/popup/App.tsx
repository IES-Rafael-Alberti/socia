import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { WorkflowData, WorkflowPhase, SociaState } from '@socia/eval';
import {
  loadServerSettings,
  isManaged as isManagedSettings,
  type ServerSettings,
} from '@socia/runtime';
import SettingsScreen from './SettingsScreen';
import './style.css';

/** Replace {{key}} placeholders with values from workflow.variables */
function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, key) => vars[key] ?? match);
}

interface StateResponse {
  success: boolean;
  workflow?: WorkflowData;
  state?: SociaState;
  currentPhase?: WorkflowPhase | null;
  currentPhaseIndex?: number;
  totalPhases?: number;
  elapsedSeconds?: number;
  traceLength?: number;
  networkEventCount?: number;
  mode?: 'guided' | 'unguided';
  completedMilestones?: string[];
  milestoneStatus?: Record<string, boolean>;
  error?: string;
}

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
  const [stateResp, setStateResp] = useState<StateResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [serverSettings, setServerSettings] = useState<ServerSettings | null>(null);
  const [finishedSummary, setFinishedSummary] = useState<{
    grade?: number;
    pdfAvailable?: boolean;
    evalId?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);

  const refreshSettings = useCallback(async () => {
    setServerSettings(await loadServerSettings());
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  const managed = serverSettings ? isManagedSettings(serverSettings) : false;

  const workflow = stateResp?.workflow ?? null;
  const state = stateResp?.state ?? null;
  const isGuided = stateResp?.mode === 'guided';
  const vars = useMemo(() => workflow?.variables ?? {}, [workflow]);
  const milestoneStatus = stateResp?.milestoneStatus ?? {};

  const fetchState = useCallback(async () => {
    try {
      const resp = await sendMessage<StateResponse>({ type: 'SOCIA_GET_STATE' });
      setStateResp(resp);
      if (resp.elapsedSeconds !== undefined) {
        setElapsedSeconds(resp.elapsedSeconds);
      }
    } catch {
      // Background not ready yet
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Poll for state updates every 2 seconds
  useEffect(() => {
    const interval = setInterval(fetchState, 2000);
    return () => clearInterval(interval);
  }, [fetchState]);

  // Local timer tick
  useEffect(() => {
    if (workflow && state?.isActive) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [workflow, state?.isActive]);

  // ──────────────── Handlers ────────────────

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    setError(null);
    try {
      const text = await file.text();
      const workflowData: WorkflowData = JSON.parse(text);
      if (!workflowData.phases || !workflowData.case) {
        throw new Error('Formato de workflow no válido');
      }
      const resp = await sendMessage<{ success: boolean; error?: string }>({
        type: 'SOCIA_LOAD_WORKFLOW',
        workflow: workflowData,
      });
      if (resp.success) {
        setElapsedSeconds(0);
        await fetchState();
      } else {
        setError(resp.error || 'Error cargando workflow');
      }
    } catch (err) {
      setError(`Archivo no válido: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const [isFinishing, setIsFinishing] = useState(false);

  const [showFinishModal, setShowFinishModal] = useState(false);

  /** managed: confirm() simple. standalone: abre el modal con 3 opciones. */
  const handleFinishClick = () => {
    if (managed) {
      if (!confirm('¿Terminar el caso? Se generará la evaluación automática (puede tardar hasta un minuto).')) {
        return;
      }
      void runFinish(true);
    } else {
      setShowFinishModal(true);
    }
  };

  /** Runs the actual finish, with or without LLM evaluation. */
  const runFinish = async (evaluate: boolean) => {
    setShowFinishModal(false);
    setIsFinishing(true);
    setIsLoading(true);
    setError(null);
    try {
      const resp = await sendMessage<{
        success: boolean;
        evaluationSucceeded?: boolean;
        managed?: boolean;
        evalId?: string;
        grade?: number;
        pdfAvailable?: boolean;
        error?: string;
      }>({ type: 'SOCIA_FINISH_CASE', evaluate });
      if (!resp.success) {
        setError(resp.error || 'Error terminando el caso');
      } else if (resp.evaluationSucceeded === false && evaluate) {
        setError(
          resp.managed
            ? 'La evaluación se enviará en cuanto el servidor esté disponible.'
            : 'La evaluación automática falló, pero se ha descargado la traza. ' +
                (resp.error || ''),
        );
      } else if (resp.managed) {
        setFinishedSummary({
          grade: resp.grade,
          pdfAvailable: resp.pdfAvailable,
          evalId: resp.evalId,
        });
      }
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setStateResp(null);
    setElapsedSeconds(0);
    setIsFinishing(false);
    setIsLoading(false);
  };

  const downloadServerPdf = async () => {
    if (!finishedSummary?.evalId) return;
    await sendMessage({ type: 'SOCIA_DOWNLOAD_SERVER_PDF', evalId: finishedSummary.evalId });
  };

  const formatTime = (secs: number): string => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0)
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // ──────────────── Settings screen ────────────────

  if (showSettings) {
    return (
      <SettingsScreen
        onClose={async () => {
          await refreshSettings();
          setShowSettings(false);
        }}
      />
    );
  }

  // ──────────────── Post-finish summary (managed) ────────────────

  if (finishedSummary) {
    return (
      <div className="socia-popup">
        <header className="socia-header">
          <h1>SOCIA</h1>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="Ajustes" aria-label="Ajustes">⚙</button>
        </header>
        <div className="socia-body">
          <div className="case-eyebrow">Caso terminado</div>
          {finishedSummary.grade !== undefined && (
            <div className="finished-summary">
              <div className="finished-grade">{finishedSummary.grade.toFixed(1).replace('.', ',')}</div>
              <div className="finished-grade-label">Tu nota</div>
            </div>
          )}
          <p className="socia-hint-text">
            Tu evaluación se ha enviado al servidor. El profesor podrá revisarla.
          </p>
          {finishedSummary.pdfAvailable && (
            <button className="btn btn-primary btn-block" onClick={downloadServerPdf}>
              Descargar mi PDF
            </button>
          )}
          <button className="btn btn-secondary btn-block" onClick={() => setFinishedSummary(null)}>
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  // ──────────────── No workflow loaded ────────────────

  if (!workflow || !state) {
    if (managed) {
      return (
        <div className="socia-popup">
          <header className="socia-header">
            <h1>SOCIA</h1>
            <button className="icon-btn" onClick={() => setShowSettings(true)} title="Ajustes" aria-label="Ajustes">⚙</button>
          </header>
          <div className="socia-body">
            {error && <div className="socia-error">{error}</div>}
            <div className="waiting-card">
              <div className="waiting-pulse" />
              <div className="waiting-card__eyebrow">En espera</div>
              <h2>Esperando al profesor</h2>
              <p>
                Estás conectado como{' '}
                <strong>{serverSettings?.studentEmail || serverSettings?.studentName}</strong>.
                En cuanto se lance un caso, aparecerá aquí.
              </p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="socia-popup">
        <header className="socia-header">
          <h1>SOCIA</h1>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="Ajustes" aria-label="Ajustes">⚙</button>
        </header>
        <div className="socia-body">
          {error && <div className="socia-error">{error}</div>}
          <input
            type="file"
            ref={fileInputRef}
            accept=".json"
            onChange={handleFileSelect}
            disabled={isLoading}
            style={{ display: 'none' }}
          />
          <div className="file-upload">
            <button
              className="btn btn-primary btn-big btn-block"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
            >
              {isLoading ? 'Cargando…' : 'Cargar caso'}
            </button>
          </div>
          <p className="socia-hint-text">
            Selecciona un archivo json válido para comenzar
          </p>
        </div>
      </div>
    );
  }

  // ──────────────── Workflow active ────────────────

  const currentPhaseIndex = stateResp?.currentPhaseIndex ?? 0;
  const totalCompleted = stateResp?.completedMilestones?.length ?? 0;
  const totalMilestones = workflow.phases.reduce(
    (sum, p) => sum + p.milestones.length,
    0
  );

  // Build a 5-segment progress track for the global hits bar.
  const SEGMENTS = 5;
  const segmentClasses = Array.from({ length: SEGMENTS }).map((_, i) => {
    if (totalMilestones === 0) return '';
    const seg = (totalCompleted / totalMilestones) * SEGMENTS;
    if (i + 1 <= seg) return 'is-done';
    if (i < seg && i + 1 > seg) return 'is-current';
    return '';
  });

  return (
    <div className="socia-popup">
      <header className="socia-header">
        <h1>SOCIA</h1>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Ajustes" aria-label="Ajustes">⚙</button>
      </header>

      <div className="socia-body">
        {error && <div className="socia-error">{error}</div>}

        {/* Live card: timer + stats */}
        <div className="live-card">
          <div className="live-card__timer">{formatTime(elapsedSeconds)}</div>
          <div className="live-card__stats">
            <div className="live-card__stat">
              <span className="live-card__stat-value">{stateResp?.traceLength ?? 0}</span>
              <span className="live-card__stat-label">Acciones</span>
            </div>
            <div className="live-card__stat">
              <span className="live-card__stat-value">{stateResp?.networkEventCount ?? 0}</span>
              <span className="live-card__stat-label">Red</span>
            </div>
            {isGuided && (
              <div className="live-card__stat">
                <span className="live-card__stat-value">{totalCompleted}/{totalMilestones}</span>
                <span className="live-card__stat-label">Hitos</span>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="case-eyebrow">Caso en curso</div>
          <h2 className="case-title">{interpolate(workflow.case.title, vars)}</h2>
        </div>

        {/* Segmented progress — only in guided mode */}
        {isGuided && (
          <div className="progress">
            <div className="progress__track">
              {segmentClasses.map((c, i) => (
                <div key={i} className={`progress__step ${c}`} />
              ))}
            </div>
            <div className="progress__label">
              <span>Hitos</span>
              <strong>{totalCompleted}/{totalMilestones}</strong>
            </div>
          </div>
        )}

        {!isGuided && (
          <p className="mode-label">
            Modo no guiado — tus acciones se están grabando.
          </p>
        )}

        {/* Phase list with milestones — only in guided mode */}
        {isGuided && (
          <div className="phases">
            {workflow.phases.map((phase, idx) => {
              const isCurrent = idx === currentPhaseIndex;
              const phaseCompleted = phase.milestones.every(
                (m) => milestoneStatus[m.id]
              );
              const isPast = phaseCompleted;
              const isFuture = !isCurrent && !isPast;

              const completedInPhase = phase.milestones.filter(
                (m) => milestoneStatus[m.id]
              ).length;

              return (
                <div
                  key={phase.id}
                  className={`phase ${isCurrent ? 'active' : ''} ${isPast ? 'past' : ''} ${isFuture ? 'future' : ''}`}
                >
                  <div className="phase-header">
                    <span className="phase-icon" aria-hidden="true" />
                    <span className="phase-name">
                      {interpolate(phase.title, vars)}
                    </span>
                    <span className="phase-progress">
                      {completedInPhase}/{phase.milestones.length}
                    </span>
                    {phase.role && (
                      <span className="phase-role">{phase.role}</span>
                    )}
                  </div>
                  {isCurrent && (
                    <>
                      <p className="phase-description">
                        {interpolate(phase.description, vars)}
                      </p>
                      <div className="milestone-list">
                        {phase.milestones.map((m) => (
                          <div
                            key={m.id}
                            className={`milestone ${milestoneStatus[m.id] ? 'completed' : 'pending'}`}
                          >
                            <span className="milestone-icon" aria-hidden="true" />
                            <span className="milestone-label">
                              {interpolate(m.label, vars)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button
          className="btn btn-danger btn-block"
          onClick={handleFinishClick}
          disabled={isLoading}
        >
          {isFinishing ? 'Evaluando…' : 'Terminar'}
        </button>
      </div>

      {showFinishModal && (
        <div className="modal-overlay" onClick={() => setShowFinishModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">Terminar el caso</h3>
            <p className="modal__body">
              Puedes cerrar el caso con evaluación automática (puede tardar hasta
              un minuto y generará tu PDF), o cerrarlo descargando solo la traza
              sin pedir evaluación.
            </p>
            <div className="modal__actions">
              <button className="btn btn-secondary" onClick={() => setShowFinishModal(false)}>
                Cancelar
              </button>
              <button className="btn btn-secondary" onClick={() => runFinish(false)}>
                Sin evaluar
              </button>
              <button className="btn btn-danger" onClick={() => runFinish(true)}>
                Evaluar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
