import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { api } from '../api';

interface BrandInfo {
  brandId: string;
  available: { id: string; name: string }[];
}

export function PageWelcome({ onGoToClasses }: { onGoToClasses: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [brand, setBrand] = useState<BrandInfo | null>(null);
  const [brandSaved, setBrandSaved] = useState(false);

  useEffect(() => {
    api.get<{ token: string }>('/api/admin/token').then((r) => setToken(r.token)).catch(() => {});
    api.get<BrandInfo>('/api/admin/brand').then(setBrand).catch(() => {});
  }, []);

  async function changeBrand(brandId: string) {
    if (!brand || brandId === brand.brandId) return;
    await api.post('/api/admin/brand', { brandId });
    setBrand({ ...brand, brandId });
    setBrandSaved(true);
    setTimeout(() => setBrandSaved(false), 1800);
  }

  async function copy() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function regenerate() {
    if (!confirm('¿Regenerar el token? El antiguo dejará de funcionar en MENTORA.')) return;
    const r = await api.post<{ token: string }>('/api/admin/token/regenerate');
    setToken(r.token);
  }

  return (
    <div className="content">
      <div className="welcome">
        <div className="welcome__container">
          <div>
            <h1 style={{ fontSize: 50, lineHeight: 1.05 }}>
              Te damos la bienvenida al panel de <em>SOCIA</em>.
            </h1>
            <p>
              Para empezar, copia el token de admin y pégalo en MENTORA si quieres publicar casos
              directamente desde tu navegador. Si no, puedes subirlos a mano desde la pestaña Casos.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button className="button button--primary button--big" onClick={onGoToClasses}>
                CREAR CLASE
              </button>
            </div>
          </div>
          <div className="token-card">
            <div className="token-card__label">🔑  Token de administrador</div>
            <div className="token-card__value">{token ?? '…'}</div>
            <div className="token-card__row">
              <button className="button button--primary" onClick={copy} disabled={!token}>
                <Icon name="copy" size={14} /> {copied ? 'Copiado' : 'Copiar token'}
              </button>
              <button
                className="button button--ghost"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'white', borderColor: 'rgba(255,255,255,0.12)' }}
                onClick={regenerate}
              >
                <Icon name="refresh" size={14} /> Regenerar
              </button>
            </div>
            <div className="token-card__warn">
              Este token sustituye al anterior si lo regeneras. Guárdalo en un lugar seguro.
            </div>
          </div>
        </div>

        <div className="welcome__steps">
          <div className="step">
            <div className="step__num">PASO 01</div>
            <h4>Crea una clase</h4>
            <p>Da nombre a tu grupo y, si quieres, restringe el dominio de correo del alumnado.</p>
          </div>
          <div className="step">
            <div className="step__num">PASO 02</div>
            <h4>Proyecta el QR</h4>
            <p>Cada clase genera un QR + código corto. El alumnado escanea y entra.</p>
          </div>
          <div className="step">
            <div className="step__num">PASO 03</div>
            <h4>Lanza un caso</h4>
            <p>
              Sube un workflow desde MENTORA o desde disco, asígnalo y pulsa <em>Lanzar caso</em>.
            </p>
          </div>
        </div>

        {brand && (
          <div className="step" style={{ marginTop: 32, maxWidth: 640 }}>
            <div className="step__num">AJUSTES DEL SERVIDOR</div>
            <h4>Identidad visual de las evaluaciones</h4>
            <p style={{ marginBottom: 12 }}>
              El logo, los colores y la firma del PDF de evaluación. Aplica a todas las
              evaluaciones que genere este servidor.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <select
                className="select"
                value={brand.brandId}
                onChange={(e) => changeBrand(e.target.value)}
                style={{ maxWidth: 320 }}
              >
                {brand.available.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {brandSaved && (
                <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
                  <Icon name="check" size={11} /> Guardado
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
