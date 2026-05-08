import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { api, type ClassRow, type StudentRow } from '../api';

export function PageClasses({
  classes,
  onChange,
}: {
  classes: ClassRow[];
  onChange: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(classes[0]?.id ?? null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');

  useEffect(() => {
    if (!selected) {
      setStudents([]);
      return;
    }
    api
      .get<{ students: StudentRow[] }>(`/api/classes/${selected}/students`)
      .then((r) => setStudents(r.students))
      .catch(() => setStudents([]));
  }, [selected, classes]);

  // keep selection valid when classes change
  useEffect(() => {
    if (classes.length && !classes.find((c) => c.id === selected)) {
      setSelected(classes[0].id);
    }
    if (!classes.length) setSelected(null);
  }, [classes, selected]);

  async function createClass() {
    if (!newName.trim()) return;
    await api.post('/api/classes', { name: newName.trim(), domain: newDomain.trim() || undefined });
    setNewName('');
    setNewDomain('');
    setCreating(false);
    onChange();
  }

  async function expel(sid: string) {
    if (!selected) return;
    if (!confirm('¿Expulsar a este estudiante?')) return;
    await api.del(`/api/classes/${selected}/students/${sid}`);
    setStudents((s) => s.filter((x) => x.id !== sid));
    onChange();
  }

  async function regenerateCode() {
    if (!selected) return;
    if (!confirm('¿Regenerar el código de la clase? El alumnado tendrá que volver a entrar con el nuevo.')) return;
    await api.post(`/api/classes/${selected}/regenerate-code`);
    onChange();
  }

  async function deleteClass() {
    if (!selected) return;
    if (!confirm('¿Borrar esta clase y todos sus datos? No se puede deshacer.')) return;
    await api.del(`/api/classes/${selected}`);
    setSelected(null);
    onChange();
  }

  const cls = classes.find((c) => c.id === selected) ?? null;

  return (
    <div className="content">
      <div className="page-hero">
        <div>
          <h1>Clases</h1>
        </div>
        <button className="button button--primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} /> Nueva clase
        </button>
      </div>

      {classes.length === 0 ? (
        <div className="empty">
          <h4>Aún no hay clases</h4>
          <p>Crea la primera para que tu alumnado pueda conectarse con un código + QR.</p>
        </div>
      ) : (
        <div className="classes-grid">
          {classes.map((c) => (
            <div
              key={c.id}
              className={`class-card ${selected === c.id ? 'is-active' : ''}`}
              onClick={() => setSelected(c.id)}
            >
              <div className="class-card__top">
                <span className="class-card__code">{c.code}</span>
              </div>
              <h3 className="class-card__title">{c.name}</h3>
              <div className="class-card__stats">
                <div>
                  <div className="class-card__stat-num">{c.students}</div>
                  <div className="class-card__stat-label">Estudiantes</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {cls && (
        <>
          <div className="section-head">
            <div>
              <h3 className="section-head__title">{cls.name}</h3>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="button button--ghost" onClick={regenerateCode}>
                <Icon name="refresh" size={14} /> Regenerar código
              </button>
              <button className="button button--danger-ghost" onClick={deleteClass}>
                <Icon name="trash" size={14} /> Borrar clase
              </button>
            </div>
          </div>

          <div className="class-detail">
            <div className="card card--flush">
              <div className="card__header">
                <div>
                  <h4 className="card__title">Alumnado</h4>
                </div>
              </div>
              {students.length === 0 ? (
                <div style={{ padding: 28, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
                  Aún no se ha conectado nadie. Comparte el QR o el código.
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Identificación</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.id}>
                        <td><strong style={{ fontWeight: 600 }}>{s.name}</strong></td>
                        <td><span className="mono" style={{ color: 'var(--fg-muted)' }}>{s.email ?? '—'}</span></td>
                        <td>
                          <button className="button button--danger-ghost" title="Expulsar" onClick={() => expel(s.id)}>
                            <Icon name="trash" size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <div className="qr-card">
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em', margin: '0 0 18px' }}>
                  Únete a la clase
                </h3>
                <div className="qr-code">
                  <img src={`/api/classes/${cls.id}/qr`} alt="QR de la clase" style={{ width: '100%', display: 'block' }} />
                </div>
                <div className="class-code-display">
                  <em>{cls.code}</em>
                </div>
                <a
                  className="button button--primary"
                  href={`/join/${encodeURIComponent(cls.code)}?big=1`}
                  target="_blank"
                  rel="noopener"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
                >
                  <Icon name="eye" size={14} /> Proyectar
                </a>
                <a
                  className="button button--ghost"
                  href={`/join/${encodeURIComponent(cls.code)}`}
                  target="_blank"
                  rel="noopener"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                >
                  <Icon name="qr" size={14} /> Vista previa
                </a>
              </div>

              {cls.domain && (
                <div className="card" style={{ marginTop: 16 }}>
                  <h4 style={{ margin: '0 0 12px', fontFamily: 'var(--font-display)', fontSize: 15 }}>
                    Dominio permitido
                  </h4>
                  <div className="code-pill">{cls.domain}</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {creating && (
        <div className="eval-confirm-overlay" onClick={() => setCreating(false)}>
          <div className="eval-confirm" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, margin: '0 0 14px' }}>
              Nueva clase
            </h3>
            <label className="label">Nombre</label>
            <input className="input" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="CFGS Ciberseguridad · 2º A" />
            <div style={{ height: 12 }} />
            <label className="label">Dominio permitido (opcional)</label>
            <input className="input" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="@g.educaand.es" />
            <div className="help-text">Si lo dejas vacío, basta con un nombre para que entren.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="button button--ghost" onClick={() => setCreating(false)}>Cancelar</button>
              <button className="button button--primary" onClick={createClass} disabled={!newName.trim()}>
                Crear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
