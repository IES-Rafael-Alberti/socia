import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../icons';
import { api, type ClassRow, type LaunchRow, type ProgressRow, type WorkflowRow } from '../api';

interface Props {
  classes: ClassRow[];
  workflows: WorkflowRow[];
  onChange: () => void;
}

export function PageLive({ classes, workflows, onChange }: Props) {
  const [launches, setLaunches] = useState<LaunchRow[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [showLaunch, setShowLaunch] = useState(false);
  const [pickClass, setPickClass] = useState<string>('');
  const [pickWorkflow, setPickWorkflow] = useState<string>('');
  const [pickGuided, setPickGuided] = useState<boolean>(true);

  async function reload() {
    const [l, p] = await Promise.all([
      api.get<{ launches: LaunchRow[] }>('/api/live/launches'),
      api.get<{ progress: ProgressRow[] }>('/api/live/progress'),
    ]);
    setLaunches(l.launches);
    setProgress(p.progress);
  }

  useEffect(() => {
    reload();
    const ws = new WebSocket(
      (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/admin',
    );
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'progress' || msg.type === 'launches_changed' || msg.type === 'students_changed' || msg.type === 'eval_added') {
          reload();
          onChange();
        }
      } catch {}
    };
    const t = setInterval(reload, 5000);
    return () => {
      ws.close();
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const launchedClass = launches[0];
  const live = useMemo(() => progress, [progress]);

  const total = live.length;
  const finished = live.filter((s) => s.status === 'finished').length;
  const stuck = live.filter((s) => s.status === 'stuck').length;
  const running = live.filter((s) => s.status === 'running').length;
  const totalHints = live.reduce((a, s) => a + s.hints, 0);

  async function launchCase() {
    if (!pickWorkflow || !pickClass) return;
    await api.post('/api/live/launch', {
      workflowId: pickWorkflow,
      classId: pickClass,
      guided: pickGuided,
    });
    setShowLaunch(false);
    reload();
  }

  async function closeLaunch(id: string) {
    if (!confirm('¿Detener este caso para toda la clase?')) return;
    await api.post(`/api/live/launches/${id}/close`);
    reload();
  }

  async function resetStudent(launchId: string, studentId: string, studentName: string) {
    if (
      !confirm(
        `¿Volver a lanzar el caso para ${studentName}? Empezará desde cero. Las evaluaciones previas se conservan.`,
      )
    )
      return;
    await api.post(`/api/live/launches/${launchId}/reset-student`, { studentId });
    reload();
  }

  return (
    <div className="content">
      <div className="page-hero">
        <div>
          <h1>Seguimiento</h1>
        </div>
        <button className="button button--primary" onClick={() => setShowLaunch(true)}>
          <Icon name="play" size={14} /> Lanzar caso
        </button>
      </div>

      {launches.length === 0 ? (
        <div className="empty">
          <h4>No hay casos activos</h4>
          <p>Pulsa “Lanzar caso” para activar un workflow asignado a una clase.</p>
        </div>
      ) : (
        <>
          <div className="live-hero">
            <div className="live-hero__inner">
              <div style={{ width: '100%' }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>{launchedClass.className}</span>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: launchedClass.guided ? 'rgba(94,234,152,0.18)' : 'rgba(243,167,106,0.18)',
                      color: launchedClass.guided ? '#5eea98' : '#f3a76a',
                      letterSpacing: '0.05em',
                      fontSize: 11,
                    }}
                  >
                    {launchedClass.guided ? 'Guiado' : 'No guiado'}
                  </span>
                </div>
                <h2 className="live-hero__title">{launchedClass.workflowTitle}</h2>
              </div>
              <div className="live-hero__stats">
                <div>
                  <div className="live-stat__value">{running}<em>/{total}</em></div>
                  <div className="live-stat__label">Resolviendo</div>
                </div>
                <div>
                  <div className="live-stat__value" style={{ color: '#5eea98' }}>{finished}</div>
                  <div className="live-stat__label">Cerrados</div>
                </div>
                <div>
                  <div className="live-stat__value" style={{ color: '#f3a76a' }}>{stuck}</div>
                  <div className="live-stat__label">Atascados</div>
                </div>
                <div>
                  <div className="live-stat__value">{totalHints}</div>
                  <div className="live-stat__label">Pistas pedidas</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
                <button className="live-hero__launch" onClick={() => closeLaunch(launchedClass.id)}>
                  <Icon name="x" size={18} />
                  Detener caso
                </button>
              </div>
            </div>
          </div>

          <div className="section-head">
            <div>
              <h3 className="section-head__title">Progreso por estudiante</h3>
            </div>
          </div>

          {live.length === 0 ? (
            <div className="cases-empty">Ningún estudiante conectado todavía.</div>
          ) : (
            <div className="live-grid">
              {live.map((s) => {
                const segs = Array.from({ length: 5 }).map((_, i) => {
                  const seg = s.total ? (s.step / s.total) * 5 : 0;
                  if (i + 1 <= seg) return 'is-done';
                  if (i < seg && i + 1 > seg) return 'is-current';
                  return '';
                });
                return (
                  <div
                    key={s.studentId}
                    className={`live-row ${s.status === 'stuck' ? 'is-stuck' : ''} ${s.status === 'finished' ? 'is-finished' : ''}`}
                  >
                    <div style={{ minWidth: 0 }}>
                      <h4 className="live-row__name">{s.studentName}</h4>
                      <div className="progress-track">
                        {segs.map((c, i) => <div key={i} className={`progress-step ${c}`} />)}
                      </div>
                    </div>
                    <div className="live-row__meta">
                      {s.status === 'finished' && (
                        <>
                          <span className="badge badge--success"><Icon name="check" size={11} /> Cerrado</span>
                          <button
                            className="button button--ghost"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            onClick={() => resetStudent(s.launchId, s.studentId, s.studentName)}
                            title="Volver a lanzar el caso para este alumno"
                          >
                            <Icon name="play" size={11} /> Volver a lanzar
                          </button>
                        </>
                      )}
                      {s.status === 'stuck' && <span className="badge badge--warn">Atascado</span>}
                      {s.status === 'waiting' && <span className="badge">Sin empezar</span>}
                      {s.status === 'running' && (
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-muted)' }}>
                          {s.step}/{s.total}
                        </span>
                      )}
                      <span className="live-row__hints">
                        <Icon name="lightbulb" size={11} /> {s.hints} {s.hints === 1 ? 'pista' : 'pistas'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {showLaunch && (
        <div className="eval-confirm-overlay" onClick={() => setShowLaunch(false)}>
          <div className="eval-confirm" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, margin: '0 0 14px' }}>
              Lanzar caso
            </h3>
            <label className="label">Clase</label>
            <select className="select" value={pickClass} onChange={(e) => setPickClass(e.target.value)}>
              <option value="">— elige una clase —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div style={{ height: 12 }} />
            <label className="label">Caso</label>
            <select className="select" value={pickWorkflow} onChange={(e) => setPickWorkflow(e.target.value)}>
              <option value="">— elige un caso —</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>{w.title}</option>
              ))}
            </select>
            <div style={{ height: 12 }} />
            <label className="label">Modo</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="launch-mode"
                  checked={pickGuided}
                  onChange={() => setPickGuided(true)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>Guiado</strong>
                  <span style={{ color: 'var(--fg-muted)' }}> — el alumno ve los hitos pendientes y la barra de progreso.</span>
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="launch-mode"
                  checked={!pickGuided}
                  onChange={() => setPickGuided(false)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>No guiado</strong>
                  <span style={{ color: 'var(--fg-muted)' }}> — el alumno solo ve el cronómetro; sus acciones se registran igualmente para evaluar. Puede pedir pistas en ambos modos.</span>
                </span>
              </label>
            </div>
            <div className="help-text">El caso se activará al instante para todo el alumnado conectado a esa clase.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="button button--ghost" onClick={() => setShowLaunch(false)}>Cancelar</button>
              <button className="button button--primary" onClick={launchCase} disabled={!pickClass || !pickWorkflow}>
                Lanzar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
