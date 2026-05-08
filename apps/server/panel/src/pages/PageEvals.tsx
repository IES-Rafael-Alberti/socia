import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { api, type ClassRow, type EvalRow } from '../api';

function fmtDuration(s: number): string {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m.toString().padStart(2, '0')} min`;
  return `${m} min`;
}

export function PageEvals({
  classes,
  onChange,
}: {
  classes: ClassRow[];
  onChange: () => void;
}) {
  const [evals, setEvals] = useState<EvalRow[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [confirm, setConfirm] = useState<null | { type: 'all' }>(null);

  async function reload() {
    const r = await api.get<{ evaluations: EvalRow[] }>(
      '/api/evals' + (filter === 'all' ? '' : `?case=${encodeURIComponent(filter)}`),
    );
    setEvals(r.evaluations);
    onChange();
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // The toggle reflects "allowed in EVERY class" — derived directly from the
  // up-to-date `classes` prop, so React keeps it in sync after each PATCH.
  // (Previously this lived in a useState mirror that drifted out of sync.)
  const allowDownload =
    classes.length > 0 && classes.every((c) => c.allowPdfDownload === 1);

  async function toggleAllow() {
    if (classes.length === 0) return;
    const next = !allowDownload;
    await Promise.all(
      classes.map((c) =>
        api.patch(`/api/classes/${c.id}`, { allowPdfDownload: next }),
      ),
    );
    onChange();
  }

  async function removeAll() {
    await api.del(
      '/api/evals' + (filter === 'all' ? '' : `?case=${encodeURIComponent(filter)}`),
    );
    setConfirm(null);
    reload();
  }

  const cases = ['all', ...Array.from(new Set(evals.map((e) => e.caseName)))];

  return (
    <div className="content">
      <div className="page-hero">
        <div>
          <h1>Evaluaciones</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            className="button button--primary"
            href={'/api/evals/export.zip' + (filter === 'all' ? '' : `?case=${encodeURIComponent(filter)}`)}
          >
            <Icon name="download" size={14} /> Descargar todo
          </a>
          <button
            className="button button--danger-ghost"
            disabled={evals.length === 0}
            onClick={() => setConfirm({ type: 'all' })}
          >
            <Icon name="trash" size={14} /> Borrar {filter === 'all' ? 'todo' : 'filtrado'}
          </button>
        </div>
      </div>

      <div className="toggle-row" style={{ marginBottom: 18 }}>
        <div>
          <div className="toggle-row__label">
            Permitir al alumnado descargar su propio PDF
          </div>
        </div>
        <div className={`toggle ${allowDownload ? 'is-on' : ''}`} onClick={toggleAllow} />
      </div>

      <div className="card card--flush">
        <div className="card__header">
          <div>
            <h4 className="card__title">Listado de evaluaciones</h4>
          </div>
          <select className="select" style={{ width: 280 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            {cases.map((c) => (
              <option key={c} value={c}>{c === 'all' ? 'Todos los casos' : c}</option>
            ))}
          </select>
        </div>
        {evals.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
            No hay evaluaciones registradas.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Estudiante</th>
                <th>Caso</th>
                <th>Cerrado</th>
                <th>Duración</th>
                <th>Pasos</th>
                <th>Pistas</th>
                <th>Nota</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {evals.map((e) => {
                const d = new Date(e.closedAt);
                const grade = Number(e.grade) || 0;
                return (
                  <tr key={e.id}>
                    <td><strong style={{ fontWeight: 600 }}>{e.studentName}</strong></td>
                    <td style={{ color: 'var(--fg-muted)' }}>{e.caseName}</td>
                    <td>
                      <div style={{ fontSize: 13 }}>{d.toLocaleDateString('es-ES')}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td><span className="mono" style={{ fontSize: 12 }}>{fmtDuration(e.durationSeconds)}</span></td>
                    <td><span className="mono">{e.stepsDone}/{e.stepsTotal}</span></td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Icon name="lightbulb" size={12} /> {e.hints}
                      </span>
                    </td>
                    <td>
                      <div className="eval-grade">
                        <span style={{ color: grade >= 9 ? '#157a40' : grade >= 7 ? 'var(--fg)' : '#c97500' }}>
                          {grade.toFixed(1).replace('.', ',')}
                        </span>
                        <div className="eval-grade__bar">
                          <div className="eval-grade__fill" style={{ width: `${grade * 10}%`, background: grade >= 9 ? '#34d171' : grade >= 7 ? 'var(--accent)' : '#f3a76a' }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <a className="button button--ghost" href={`/api/evals/${e.id}/pdf`} target="_blank" rel="noreferrer">
                        <Icon name="download" size={13} /> PDF
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {confirm && (
        <div className="eval-confirm-overlay" onClick={() => setConfirm(null)}>
          <div className="eval-confirm" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, margin: '0 0 8px' }}>
              Borrar {evals.length} {evals.length === 1 ? 'evaluación' : 'evaluaciones'}
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              {filter === 'all' ? (
                <>Vas a borrar <strong style={{ color: 'var(--fg)' }}>todas</strong> las evaluaciones registradas. Esta acción no se puede deshacer.</>
              ) : (
                <>Vas a borrar todas las evaluaciones del caso <strong style={{ color: 'var(--fg)' }}>{filter}</strong>. Esta acción no se puede deshacer.</>
              )}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="button button--ghost" onClick={() => setConfirm(null)}>Cancelar</button>
              <button className="button button--danger" onClick={removeAll}>
                <Icon name="trash" size={13} /> Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
