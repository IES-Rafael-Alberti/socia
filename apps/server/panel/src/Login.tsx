import { useState, type FormEvent } from 'react';
import { api } from './api';
import { Icon } from './icons';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/api/admin/login', { user, pass });
      onLogin();
    } catch {
      setErr('Credenciales incorrectas.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="login-brand__logo">
            <img src="/assets/socia-logo-eye.png" alt="SOCIA" />
          </div>
          <div>
            <div className="login-brand__name">SOCIA</div>
            <div className="login-brand__sub">Server</div>
          </div>
        </div>
        <h1 className="login-title">Acceso del docente</h1>
        <label className="label" htmlFor="user">Usuario</label>
        <input id="user" className="input" autoFocus value={user} onChange={(e) => setUser(e.target.value)} />
        <div style={{ height: 12 }} />
        <label className="label" htmlFor="pass">Contraseña</label>
        <input id="pass" className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
        {err && <div className="login-err">{err}</div>}
        <button className="button button--primary button--big" disabled={busy} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
          <Icon name="chevron" size={14} /> {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <div className="login-help">
          Las credenciales se configuran en el Docker (variables <span className="mono">ADMIN_USER</span> y <span className="mono">ADMIN_PASS</span>).
        </div>
      </form>
    </div>
  );
}
