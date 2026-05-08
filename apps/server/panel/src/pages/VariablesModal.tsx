import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { api, type WorkflowVariables } from '../api';

interface Props {
  workflowId: string;
  workflowTitle: string;
  onClose: (changed: boolean) => void;
}

/**
 * Modal to view and edit a workflow's `variables` block. Saving rewrites
 * the file in /data/workflows/<id>.json on the server and refreshes the
 * cached title (since case.title can interpolate variables).
 */
export function VariablesModal({ workflowId, workflowTitle, onClose }: Props) {
  const [vars, setVars] = useState<WorkflowVariables | null>(null);
  const [draft, setDraft] = useState<WorkflowVariables>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ variables: WorkflowVariables }>(`/api/workflows/${workflowId}/variables`)
      .then((r) => {
        setVars(r.variables);
        setDraft({ ...r.variables });
      })
      .catch(() => setError('No se pudieron leer las variables del caso.'));
  }, [workflowId]);

  const dirty =
    !!vars &&
    Object.keys(vars).length === Object.keys(draft).length &&
    Object.keys(vars).some((k) => vars[k] !== draft[k]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/workflows/${workflowId}/variables`, { variables: draft });
      onClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const keys = vars ? Object.keys(vars) : [];

  return (
    <div className="eval-confirm-overlay" onClick={() => onClose(false)}>
      <div
        className="eval-confirm"
        style={{ width: 560, maxHeight: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>
          Variables del caso
        </h3>
        <p style={{ margin: '0 0 18px', fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          Estos valores se inyectan en el caso en tiempo de ejecución
          (<span className="mono">{'{{nombre}}'}</span> en títulos, descripciones y firmas de
          hitos). Al guardar, el JSON del caso en el servidor se sobrescribe.
        </p>

        {error && <div className="login-err" style={{ marginBottom: 12 }}>{error}</div>}

        {!vars ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>Cargando…</div>
        ) : keys.length === 0 ? (
          <div className="cases-empty">Este caso no define variables.</div>
        ) : (
          <div style={{ overflowY: 'auto', flex: '1 1 auto', paddingRight: 4 }}>
            {keys.map((k) => (
              <div key={k} style={{ marginBottom: 12 }}>
                <label className="label" style={{ marginBottom: 4 }}>
                  {k}
                </label>
                <input
                  className="input input--mono"
                  value={draft[k] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="button button--ghost" onClick={() => onClose(false)} disabled={busy}>
            Cancelar
          </button>
          <button
            className="button button--primary"
            onClick={save}
            disabled={busy || !dirty || !vars}
          >
            <Icon name="check" size={13} /> {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 14, lineHeight: 1.4 }}>
          Caso: <strong style={{ color: 'var(--fg)' }}>{workflowTitle}</strong>
        </div>
      </div>
    </div>
  );
}
