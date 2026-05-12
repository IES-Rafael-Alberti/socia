import { useEffect, useState } from 'react';
import {
  loadServerSettings,
  patchServerSettings,
  saveServerSettings,
  type ServerSettings,
} from '@socia/runtime';
import {
  pingServer,
  connectClass,
  identifyStudent,
} from '@socia/runtime';
import { listBrands } from '@socia/branding';
import { useSessionState } from '../../../utils/shared/popup-session';

type ConnState = 'unknown' | 'checking' | 'ok' | 'error';

interface Props {
  onClose: () => void;
}

export default function SettingsScreen({ onClose }: Props) {
  const [s, setS] = useState<ServerSettings | null>(null);
  const [connStatus, setConnStatus] = useState<ConnState>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useSessionState('socia.showApiKey', false);
  const [classFound, setClassFound] = useState(false);

  useEffect(() => {
    loadServerSettings().then(setS);
  }, []);

  if (!s) return null;

  const isManaged = !!(s.serverUrl && s.studentToken);

  async function checkConnection() {
    if (!s?.serverUrl) return;
    setConnStatus('checking');
    const ok = await pingServer(s.serverUrl);
    setConnStatus(ok ? 'ok' : 'error');
  }

  async function handleConnect() {
    if (!s?.serverUrl || !s.classCode) {
      setError('Indica IP/dominio y código de clase.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cls = await connectClass(s.serverUrl, s.classCode);
      const next = await patchServerSettings({
        classDomain: cls.domain,
        domainRequired: cls.domainRequired,
      });
      setS(next);
      setClassFound(true);
      setInfo(`Clase «${cls.className}» encontrada. Identifícate.`);
    } catch (err) {
      setError(parseErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleIdentify() {
    if (!s?.serverUrl || !s.classCode) return;
    setBusy(true);
    setError(null);
    try {
      const r = await identifyStudent(s.serverUrl, s.classCode, {
        name: s.studentName ?? undefined,
        email: s.studentEmail ?? undefined,
      });
      const next = await patchServerSettings({
        studentToken: r.token,
        studentId: r.studentId,
      });
      setS(next);
      setInfo('Conectado correctamente.');
      chrome.runtime.sendMessage({ type: 'SOCIA_SETTINGS_CHANGED' });
    } catch (err) {
      setError(parseErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('¿Desconectarte del servidor? Tu identificación local se borrará.')) return;
    const next: ServerSettings = {
      ...s!,
      studentToken: null,
      studentId: null,
      classDomain: null,
      domainRequired: false,
    };
    await saveServerSettings(next);
    setS(next);
    setClassFound(false);
    setInfo('Desconectado.');
    chrome.runtime.sendMessage({ type: 'SOCIA_SETTINGS_CHANGED' });
  }

  async function handleClearServer() {
    if (!confirm('¿Quitar la configuración del servidor? Volverás al modo standalone.')) return;
    const next: ServerSettings = {
      ...s!,
      serverUrl: null,
      classCode: null,
      studentToken: null,
      studentId: null,
      classDomain: null,
      domainRequired: false,
    };
    await saveServerSettings(next);
    setS(next);
    setClassFound(false);
    setInfo('Modo standalone activado.');
    chrome.runtime.sendMessage({ type: 'SOCIA_SETTINGS_CHANGED' });
  }

  async function update<K extends keyof ServerSettings>(k: K, v: ServerSettings[K]) {
    const next = { ...s!, [k]: v };
    setS(next);
    await saveServerSettings(next);
  }

  return (
    <div className="socia-popup">
      <header className="socia-header socia-header--light">
        <h1>Ajustes</h1>
        <button className="icon-btn" onClick={onClose} title="Volver" aria-label="Volver">←</button>
      </header>

      <div className="settings">
        {error && <div className="socia-error">{error}</div>}
        {info && <div className="socia-info">{info}</div>}

        <section className="settings-section">
        <h3>Modo gestionado (servidor SOCIA)</h3>
        <p className="settings-help">
          Conéctate al servidor del profesor para recibir casos y guardar tus
          evaluaciones. Déjalo vacío para usar SOCIA en modo standalone.
        </p>

        <label className="settings-label">IP / dominio del servidor</label>
        <input
          className="settings-input"
          placeholder="http://192.168.1.50:4317"
          value={s.serverUrl ?? ''}
          onChange={(e) => update('serverUrl', e.target.value || null)}
          onBlur={checkConnection}
        />
        {s.serverUrl && (
          <div className={`conn-pill conn-${connStatus}`}>
            {connStatus === 'checking'
              ? 'Comprobando…'
              : connStatus === 'ok'
                ? 'Servidor accesible'
                : connStatus === 'error'
                  ? 'No se llega al servidor'
                  : '—'}
          </div>
        )}

        {s.serverUrl && (
          <>
            <label className="settings-label" style={{ marginTop: 12 }}>
              Código de clase
            </label>
            <input
              className="settings-input"
              placeholder="XXXX"
              value={s.classCode ?? ''}
              onChange={(e) => update('classCode', e.target.value.toUpperCase() || null)}
              disabled={isManaged}
            />

            {!isManaged && (
              <button
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={busy || !s.serverUrl || !s.classCode}
                style={{ marginTop: 8 }}
              >
                {busy ? 'Buscando…' : 'Buscar clase'}
              </button>
            )}

            {!isManaged && classFound && (
              <div className="settings-card">
                {s.domainRequired && s.classDomain ? (
                  <>
                    <label className="settings-label">
                      Tu correo (debe terminar en {s.classDomain})
                    </label>
                    <input
                      className="settings-input"
                      placeholder={`tu_correo${s.classDomain.startsWith('@') ? s.classDomain : '@' + s.classDomain}`}
                      value={s.studentEmail ?? ''}
                      onChange={(e) => update('studentEmail', e.target.value || null)}
                    />
                  </>
                ) : (
                  <>
                    <label className="settings-label">Tu nombre</label>
                    <input
                      className="settings-input"
                      placeholder="Nombre y apellidos"
                      value={s.studentName ?? ''}
                      onChange={(e) => update('studentName', e.target.value || null)}
                    />
                  </>
                )}
                <button
                  className="btn btn-primary"
                  onClick={handleIdentify}
                  disabled={busy}
                  style={{ marginTop: 8 }}
                >
                  {busy ? 'Conectando…' : 'Conectarme'}
                </button>
              </div>
            )}

            {isManaged && (
              <div className="settings-card">
                <div className="settings-row">
                  <span>Identificado como</span>
                  <strong>{s.studentEmail || s.studentName || '—'}</strong>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={handleDisconnect}
                  style={{ marginTop: 8 }}
                >
                  Desconectarme
                </button>
              </div>
            )}

            <button
              className="btn btn-ghost"
              onClick={handleClearServer}
              style={{ marginTop: 12 }}
            >
              Quitar configuración del servidor
            </button>
          </>
        )}
      </section>

      {!isManaged && (
        <section className="settings-section">
          <h3>Modo standalone (sin servidor)</h3>
          <p className="settings-help">
            Sin servidor cargas los casos a mano y la evaluación se genera
            localmente. Las pistas funcionan en ambos modos.
          </p>

          <h4 className="settings-subheading">Modo guiado</h4>
          <p className="settings-help">
            Activado: ves la lista de hitos pendientes y la barra de progreso.
            Desactivado: solo cronómetro y botón de Terminar; tus acciones se
            graban igualmente para evaluar.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 6 }}>
            <input
              type="checkbox"
              checked={s.standaloneGuidedMode}
              onChange={(e) => update('standaloneGuidedMode', e.target.checked)}
            />
            Modo guiado
          </label>

          <h4 className="settings-subheading">Identidad visual</h4>
          <p className="settings-help">
            Logo, colores y firma del PDF de evaluación al terminar el caso.
          </p>
          <select
            className="settings-input"
            value={s.standaloneBrandId}
            onChange={(e) => update('standaloneBrandId', e.target.value)}
          >
            {listBrands().map((b) => (
              <option key={b.id} value={b.id}>
                {b.name.short}
              </option>
            ))}
          </select>

          <h4 className="settings-subheading">API key de OpenRouter (opcional)</h4>
          <p className="settings-help">
            Habilita las pistas y la evaluación PDF en local. Sin ella, SOCIA
            sigue funcionando pero sin asistencia de IA.
          </p>
          <label className="settings-label">API key</label>
          <input
            className="settings-input"
            type={showApiKey ? 'text' : 'password'}
            placeholder="sk-or-v1-…"
            value={s.standaloneApiKey ?? ''}
            onChange={(e) => update('standaloneApiKey', e.target.value || null)}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={showApiKey}
              onChange={(e) => setShowApiKey(e.target.checked)}
            />
            Mostrar
          </label>
        </section>
      )}
      </div>
    </div>
  );
}

function parseErr(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  switch (m) {
    case 'class_not_found':
      return 'Esa clase no existe en el servidor.';
    case 'email_required':
      return 'Esa clase exige correo.';
    case 'name_required':
      return 'Indica tu nombre.';
    case 'domain_not_allowed':
      return 'Tu correo no está en el dominio permitido.';
    case 'connect_failed':
    case 'identify_failed':
      return 'No se pudo contactar con el servidor.';
    default:
      return m;
  }
}
