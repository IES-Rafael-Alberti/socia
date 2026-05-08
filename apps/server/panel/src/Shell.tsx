import { Icon } from './icons';
import { api } from './api';

export type PageId = 'welcome' | 'classes' | 'workflows' | 'live' | 'evals';

interface Counts {
  classes: number;
  workflows: number;
  evals: number;
}

export function Shell({
  active,
  onNav,
  onLogout,
  counts,
  hasLive,
  children,
}: {
  active: PageId;
  onNav: (p: PageId) => void;
  onLogout: () => void;
  counts: Counts;
  hasLive: boolean;
  children: React.ReactNode;
}) {
  const items: { id: PageId; icon: Parameters<typeof Icon>[0]['name']; label: string; badge?: string; live?: boolean }[] = [
    { id: 'welcome', icon: 'home', label: 'Inicio' },
    { id: 'classes', icon: 'users', label: 'Clases', badge: counts.classes ? String(counts.classes) : undefined },
    { id: 'workflows', icon: 'workflow', label: 'Casos', badge: counts.workflows ? String(counts.workflows) : undefined },
    { id: 'live', icon: 'radio', label: 'Seguimiento', live: hasLive },
    { id: 'evals', icon: 'award', label: 'Evaluaciones', badge: counts.evals ? String(counts.evals) : undefined },
  ];

  async function logout() {
    try {
      await api.post('/api/admin/logout');
    } catch {}
    onLogout();
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__brand-logo">
            <img src="/assets/socia-logo-eye.png" alt="SOCIA" />
          </div>
          <div>
            <div className="sidebar__brand-name">SOCIA</div>
            <div className="sidebar__brand-sub">Server</div>
          </div>
        </div>

        <nav className="sidebar__nav" style={{ marginTop: 14 }}>
          {items.map((it) => (
            <button
              key={it.id}
              className={`nav-item ${active === it.id ? 'is-active' : ''}`}
              onClick={() => onNav(it.id)}
            >
              <span className="nav-item__icon">
                <Icon name={it.icon} size={17} />
              </span>
              <span>{it.label}</span>
              {it.live && <span className="nav-item__pulse" />}
              {it.badge && !it.live && (
                <span className={`nav-item__badge ${it.id !== 'live' ? 'nav-item__badge--neutral' : ''}`}>{it.badge}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar__spacer" />

        <button className="sidebar__logout" onClick={logout} title="Cerrar sesión">
          <Icon name="logout" size={14} /> Cerrar sesión
        </button>

        <div className="sidebar__partners">
          <div className="sidebar__partners-eyebrow">Un proyecto de</div>
          <div>IES Rafael Alberti</div>
          <div>CIFP Cuenca Nº1</div>
          <div>Atkios</div>
        </div>
        <div className="sidebar__partners">
          <div className="sidebar__partners-eyebrow">Financiado por</div>
          <div style={{ lineHeight: 1.4 }}>
            Ministerio de Educación,
            <br />
            Formación Profesional y Deportes
          </div>
        </div>
      </aside>

      <div className="main">{children}</div>
    </div>
  );
}
