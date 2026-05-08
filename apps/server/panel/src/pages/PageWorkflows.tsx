import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons';
import { api, type ClassRow, type WorkflowRow } from '../api';
import { VariablesModal } from './VariablesModal';

export function PageWorkflows({
  classes,
  onChange,
}: {
  classes: ClassRow[];
  onChange: () => void;
}) {
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [assignments, setAssignments] = useState<Record<string, Record<string, boolean>>>({});
  const [dirty, setDirty] = useState(false);
  const [showVars, setShowVars] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function reload() {
    const r = await api.get<{ workflows: WorkflowRow[] }>('/api/workflows');
    setWorkflows(r.workflows);
    if (!sel && r.workflows.length) setSel(r.workflows[0].id);
    onChange();
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sel) return;
    api
      .get<{ assigned: string[] }>(`/api/workflows/${sel}`)
      .then((r) => {
        setAssignments((prev) => ({
          ...prev,
          [sel]: Object.fromEntries(r.assigned.map((c) => [c, true])),
        }));
        setDirty(false);
      })
      .catch(() => {});
  }, [sel]);

  const filtered = useMemo(
    () => workflows.filter((w) => w.title.toLowerCase().includes(query.toLowerCase())),
    [workflows, query],
  );
  const wf = workflows.find((w) => w.id === sel) ?? null;
  const wfChecks = (sel && assignments[sel]) || {};
  const wfAssignedCount = Object.values(wfChecks).filter(Boolean).length;

  function toggleClass(cid: string) {
    if (!sel) return;
    setAssignments({ ...assignments, [sel]: { ...wfChecks, [cid]: !wfChecks[cid] } });
    setDirty(true);
  }

  async function saveAssignments() {
    if (!sel) return;
    const ids = Object.entries(wfChecks).filter(([, v]) => v).map(([k]) => k);
    await api.put(`/api/workflows/${sel}/assignments`, { classIds: ids });
    setDirty(false);
    reload();
  }

  async function deleteWorkflow() {
    if (!sel) return;
    if (!confirm('¿Borrar este caso? No se puede deshacer.')) return;
    await api.del(`/api/workflows/${sel}`);
    setSel(null);
    reload();
  }

  async function uploadFile(f: File) {
    await api.upload('/api/workflows', f);
    reload();
  }

  return (
    <div className="content">
      <div className="page-hero">
        <div>
          <h1>Casos</h1>
        </div>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
              e.target.value = '';
            }}
          />
          <button className="button button--primary" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={14} /> Subir caso
          </button>
        </div>
      </div>

      {workflows.length === 0 ? (
        <div className="empty">
          <h4>Aún no hay casos</h4>
          <p>Sube un workflow.json desde MENTORA o desde disco.</p>
        </div>
      ) : (
        <div className="cases-layout">
          <div className="cases-list-wrap">
            <div className="cases-search">
              <Icon name="search" size={14} />
              <input placeholder="Buscar caso…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <span className="cases-search__count">{filtered.length}</span>
            </div>

            <div className="cases-list">
              {filtered.map((w) => (
                <button
                  key={w.id}
                  className={`case-row ${sel === w.id ? 'is-active' : ''}`}
                  onClick={() => setSel(w.id)}
                >
                  <h4 className="case-row__title">{w.title}</h4>
                  <div className="case-row__meta">
                    {w.minutes && (
                      <span className="case-row__time">
                        <Icon name="clock" size={11} /> {w.minutes} min
                      </span>
                    )}
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="cases-empty">No hay casos que coincidan con «{query}».</div>
              )}
            </div>
          </div>

          {wf && (
            <div className="case-detail">
              <div className="case-detail__header">
                <div className="case-detail__header-main">
                  <h2 className="case-detail__title">{wf.title}</h2>
                  <div className="case-detail__meta">
                    {wf.minutes && (
                      <span>
                        <Icon name="clock" size={13} /> {wf.minutes} min
                      </span>
                    )}
                  </div>
                </div>
                <div className="case-detail__actions">
                  <a
                    className="icon-button"
                    href={`/api/workflows/${wf.id}/file?download=1`}
                    title="Descargar JSON del caso"
                    aria-label="Descargar JSON"
                  >
                    <Icon name="download" size={16} />
                  </a>
                  <button
                    className="icon-button"
                    onClick={() => setShowVars(true)}
                    title="Configurar variables del caso"
                    aria-label="Configurar variables"
                  >
                    <Icon name="settings" size={16} />
                  </button>
                </div>
              </div>

              {wf.tools.length > 0 && (
                <div className="case-detail__section">
                  <div className="case-detail__section-title">Herramientas</div>
                  <div className="case-tools">
                    {wf.tools.map((t) => (
                      <span key={t} className="case-tool">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="case-detail__section">
                <div className="case-detail__section-title">
                  Asignar a clases
                  {wfAssignedCount > 0 && (
                    <span className="case-detail__count">
                      {wfAssignedCount} de {classes.length}
                    </span>
                  )}
                </div>
                {classes.length === 0 ? (
                  <div className="cases-empty">Crea una clase primero.</div>
                ) : (
                  <div className="case-classes">
                    {classes.map((c) => (
                      <label key={c.id} className={`case-class ${wfChecks[c.id] ? 'is-on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={!!wfChecks[c.id]}
                          onChange={() => toggleClass(c.id)}
                        />
                        <div className="case-class__body">
                          <div className="case-class__name">{c.name}</div>
                          <div className="case-class__sub">{c.students} estudiantes</div>
                        </div>
                        <span className="case-class__check">
                          <Icon name="check" size={14} />
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="case-detail__footer">
                <button className="button button--danger-ghost" onClick={deleteWorkflow}>
                  <Icon name="trash" size={14} /> Borrar caso
                </button>
                <button className="button button--primary" onClick={saveAssignments} disabled={!dirty}>
                  Guardar asignación
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showVars && wf && (
        <VariablesModal
          workflowId={wf.id}
          workflowTitle={wf.title}
          onClose={(changed) => {
            setShowVars(false);
            if (changed) reload();
          }}
        />
      )}
    </div>
  );
}
