#!/usr/bin/env python3
"""
run.py  —  Asistente interactivo VPN · Jornadas Formativas SOCIA
================================================================
Un solo comando para todo:
  1. Conecta a OPNsense, detecta peers existentes
  2. Pregunta cuántos perfiles y si añadir o reemplazar
  3. Gestiona peers WireGuard en OPNsense
  4. Despliega el código en Google Apps Script
  5. Genera la página de proyección con QR

Uso:
  python3 setup/run.py
  python3 setup/run.py --dry-run   # sin tocar OPNsense ni clasp
"""

import base64, csv, os, re, subprocess, sys, time, webbrowser
import urllib3
from io import BytesIO
from pathlib import Path

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── Rutas ──────────────────────────────────────────────────────────────────────
BASE   = Path(__file__).parent
ROOT   = BASE.parent
SCRIPT = ROOT / 'apps-script'
DOCS   = ROOT / 'docs'
CSV    = BASE / 'slots_vpn.csv'
CLASP    = ROOT / '.clasp.json'
INFRA_MD = ROOT / 'instrucciones' / 'infraestructura.md'

# ── Configuración (.env) ───────────────────────────────────────────────────────
def _load_env():
    env = BASE / '.env'
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

_load_env()

def _req(key, default=None):
    v = os.environ.get(key, default)
    if not v:
        print(f'  ❌ Falta {key}. Configúrala en setup/.env')
        sys.exit(1)
    return v

OPNSENSE_URL   = _req('OPNSENSE_URL')
OPNSENSE_USER  = _req('OPNSENSE_USER')
OPNSENSE_PASS  = _req('OPNSENSE_PASS')
SERVER_UUID    = _req('SERVER_UUID')
SERVER_PUBKEY  = _req('SERVER_PUBKEY')
WG_ENDPOINT    = _req('WG_ENDPOINT')
WG_DNS         = '1.1.1.1, 8.8.8.8'
WG_KEEPALIVE   = '15'
WG_ALLOWED_IPS = '10.0.3.0/24, 172.17.33.0/24, 172.17.34.0/24, 172.18.1.0/24, 172.31.0.0/24'
IP_BASE        = '10.0.3.'
IP_START       = 101

# ── UI ─────────────────────────────────────────────────────────────────────────
BOLD = '\033[1m'
DIM  = '\033[2m'
RED  = '\033[91m'
RST  = '\033[0m'

def _hdr(text):
    pad = '─' * max(0, 52 - len(text))
    print(f'\n{BOLD}── {text} {pad}{RST}')

def _ok(t):   print(f'  ✅ {t}')
def _err(t):  print(f'  ❌ {t}')
def _info(t): print(f'  {DIM}{t}{RST}')

def _ask(prompt, default=None):
    hint = f' [{default}]' if default is not None else ''
    val  = input(f'\n{BOLD}{prompt}{hint}:{RST} ').strip()
    return val if val else (str(default) if default is not None else '')

def _choose(prompt, options):
    """options = [(key, label), …] — devuelve la key elegida."""
    print(f'\n{BOLD}{prompt}{RST}')
    for k, label in options:
        print(f'  [{k}] {label}')
    keys = [k for k, _ in options]
    while True:
        val = input(f'{BOLD}→{RST} ').strip().lower()
        if val in keys:
            return val
        print(f'    Escribe {"/".join(keys)}')

# ── Criptografía WireGuard ─────────────────────────────────────────────────────
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

def gen_keypair():
    pk   = X25519PrivateKey.generate()
    priv = base64.b64encode(pk.private_bytes_raw()).decode()
    pub  = base64.b64encode(pk.public_key().public_bytes_raw()).decode()
    return priv, pub

def gen_psk():
    return base64.b64encode(os.urandom(32)).decode()

def gen_conf(privkey, ip, psk):
    return (
        f'[Interface]\nPrivateKey = {privkey}\nAddress = {ip}/32\n'
        f'DNS = {WG_DNS}\n\n[Peer]\nPublicKey = {SERVER_PUBKEY}\n'
        f'PresharedKey = {psk}\nAllowedIPs = {WG_ALLOWED_IPS}\n'
        f'Endpoint = {WG_ENDPOINT}\nPersistentKeepalive = {WG_KEEPALIVE}\n'
    )

# ── OPNsense ───────────────────────────────────────────────────────────────────
import requests

class OPNsenseClient:
    def __init__(self, url, user, password):
        self.url     = url
        self.session = requests.Session()
        self.session.verify = False
        self.csrf    = None
        self._login(user, password)

    def _login(self, user, password):
        resp = self.session.get(f'{self.url}/', headers={'User-Agent': 'Mozilla/5.0'})
        m = re.search(r'name="([^"]+)" value="([^"]+)" autocomplete="new-password"', resp.text)
        if not m:
            raise RuntimeError('No se encontró el formulario de login de OPNsense')
        csrf_field, csrf_value = m.group(1), m.group(2)
        lr = self.session.post(
            f'{self.url}/',
            data={'usernamefld': user, 'passwordfld': password,
                  'login': '1', csrf_field: csrf_value},
            headers={'User-Agent': 'Mozilla/5.0'}, allow_redirects=True
        )
        if '/ui/core/dashboard' not in lr.url:
            raise RuntimeError(f'Login fallido — URL: {lr.url}')
        dash = self.session.get(f'{self.url}/ui/core/dashboard',
                                headers={'User-Agent': 'Mozilla/5.0'})
        h = re.search(r'setRequestHeader\("X-CSRFToken",\s*"([^"]+)"', dash.text)
        if not h:
            raise RuntimeError('No se pudo obtener el CSRF token del dashboard')
        self.csrf = h.group(1)

    def _post(self, path, data=None):
        r = self.session.post(
            f'{self.url}{path}', json=data or {},
            headers={'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json',
                     'X-CSRFToken': self.csrf,
                     'Referer': f'{self.url}/ui/core/dashboard', 'Origin': self.url}
        )
        try:    return r.json()
        except: return {'text': r.text[:200]}

    def _get(self, path, params=None):
        r = self.session.get(
            f'{self.url}{path}', params=params or {},
            headers={'User-Agent': 'Mozilla/5.0', 'X-CSRFToken': self.csrf,
                     'Referer': f'{self.url}/ui/core/dashboard'}
        )
        try:    return r.json()
        except: return {}

    def list_alumnos(self):
        """Devuelve [{name, uuid}] de todos los peers alumnoN, ordenados."""
        data = self._get('/api/wireguard/client/searchClient',
                         {'current': 1, 'rowCount': 500, 'searchPhrase': ''})
        rows = data.get('rows', [])
        alumnos = [
            {'name': r['name'], 'uuid': r.get('uuid', '')}
            for r in rows if re.match(r'^alumno\d+$', r.get('name', ''))
        ]
        return sorted(alumnos, key=lambda x: int(x['name'][6:]))

    def delete(self, uuid, name):
        result = self._post(f'/api/wireguard/client/delClient/{uuid}')
        ok = 'deleted' in str(result)
        print(f'  {"✅" if ok else "⚠️ "} Borrado {name}')
        return ok

    def add(self, name, pubkey, psk, ip):
        result = self._post('/api/wireguard/client/addClient', {'client': {
            'enabled': '1', 'name': name, 'pubkey': pubkey, 'psk': psk,
            'tunneladdress': f'{ip}/32', 'serveraddress': '', 'serverport': '',
            'endpoint': '', 'keepalive': WG_KEEPALIVE, 'servers': SERVER_UUID,
        }})
        uid = result.get('uuid', '')
        print(f'  {"✅" if uid else "⚠️ "} Creado {name} ({ip})')
        return uid

    def reconfigure(self):
        result = self._post('/api/wireguard/service/reconfigure')
        _ok(f'Reconfigure: {result.get("result", result)}')

# ── Deploy Apps Script ─────────────────────────────────────────────────────────
def run_cmd(cmd, cwd=None):
    r = subprocess.run(cmd, shell=True, cwd=str(cwd or ROOT),
                       capture_output=True, text=True)
    return r.stdout.strip(), r.stderr.strip(), r.returncode

def check_clasp():
    if not (Path.home() / '.clasprc.json').exists():
        _err('clasp no autenticado. Ejecuta primero:  clasp login')
        sys.exit(1)
    _ok('clasp autenticado')

def _inject_infra_html():
    """Convierte infraestructura.md a HTML e inyecta en Config.gs → INFRA_HTML."""
    try:
        import markdown as md_lib
    except ImportError:
        _err('Instala markdown:  pip install markdown  — INFRA_HTML no actualizado')
        return

    if not INFRA_MD.exists():
        _info('instrucciones/infraestructura.md no encontrado — INFRA_HTML no actualizado')
        return

    md_content = INFRA_MD.read_text(encoding='utf-8')
    raw_html   = md_lib.markdown(md_content, extensions=['tables'])

    html = raw_html
    html = re.sub(r'<h[12]([^>]*)>', r'<h3 style="color:#1a1a1a;font-size:15px;font-weight:bold;margin:16px 0 8px;">', html)
    html = re.sub(r'</h[12]>', '</h3>', html)
    html = re.sub(r'<h[34]([^>]*)>', r'<h4 style="color:#1a1a1a;font-size:14px;font-weight:bold;margin:12px 0 6px;">', html)
    html = re.sub(r'</h[34]>', '</h4>', html)
    html = re.sub(r'<p>', r'<p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 10px;">', html)
    html = re.sub(r'<ul>', r'<ul style="color:#555;font-size:14px;line-height:1.9;margin:0 0 10px;padding-left:20px;">', html)
    html = re.sub(r'<ol>', r'<ol style="color:#555;font-size:14px;line-height:1.9;margin:0 0 10px;padding-left:20px;">', html)
    html = re.sub(r'<a ', r'<a style="color:#eb114b;" ', html)
    html = re.sub(r'<code>', r'<code style="background:#f5f5f5;padding:2px 5px;border-radius:3px;font-size:12px;font-family:monospace;">', html)
    html = re.sub(r'<hr\s*/?>', r'<hr style="border:none;border-top:1px solid #e8e8e8;margin:16px 0;">', html)
    html = re.sub(r'<blockquote>', r'<blockquote style="margin:12px 0;padding:10px 14px;background:#fff8e1;border-left:4px solid #f59e0b;border-radius:0 4px 4px 0;">', html)

    final_html  = f'<div style="font-family:Arial,sans-serif;">\n{html}\n</div>'
    config_path = SCRIPT / 'Config.gs'
    config      = config_path.read_text(encoding='utf-8')

    new_config = re.sub(
        r'(INFRA_HTML:\s*`).*?(`)',
        lambda m: m.group(1) + '\n    ' + final_html + '\n  ' + m.group(2),
        config,
        flags=re.DOTALL
    )
    config_path.write_text(new_config, encoding='utf-8')
    _ok('INFRA_HTML actualizado desde infraestructura.md')

def deploy_slots(slots):
    bootstrap = SCRIPT / 'Bootstrap.gs'
    js_rows   = []
    for r in slots:
        conf_esc = (r['conf']
                    .replace('\\', '\\\\')
                    .replace('"',  '\\"')
                    .replace('\n', '\\n')
                    .replace('\r', ''))
        js_rows.append(
            f'  ["{r["slot"]}","{r["ip"]}","{r["privkey"]}",'
            f'"{r["pubkey"]}","{r["psk"]}","{conf_esc}","{r["uuid"]}"]'
        )
    slots_js = 'var SLOTS_DATA = [\n' + ',\n'.join(js_rows) + '\n];'
    original = bootstrap.read_text(encoding='utf-8')
    content  = re.sub(r'var SLOTS_DATA = \[.*?\];',
                      lambda m: slots_js, original, flags=re.DOTALL)
    bootstrap.write_text(content, encoding='utf-8')
    _ok(f'{len(slots)} slots inyectados en Bootstrap.gs')

    _inject_infra_html()

    if not CLASP.exists():
        print('  📦 Creando proyecto Apps Script...')
        out, err, rc = run_cmd(
            'clasp create --type sheets --title "VPN Jornadas SOCIA" --rootDir apps-script'
        )
        print(f'  {out or err}')

    out, err, rc = run_cmd('clasp push --force')
    bootstrap.write_text(original, encoding='utf-8')   # restaurar siempre
    if rc != 0:
        _err(f'clasp push falló:\n{err}')
        sys.exit(1)
    _ok('Código subido · Bootstrap.gs restaurado (claves no quedan en disco)')

# ── Página de proyección ───────────────────────────────────────────────────────
def gen_qr_page(form_url: str):
    try:
        import qrcode
        import qrcode.image.svg
    except ImportError:
        _err('Falta el paquete qrcode. Ejecuta:  pip install qrcode[svg]')
        return None

    # QR como SVG inline
    factory = qrcode.image.svg.SvgPathImage
    qr      = qrcode.make(form_url, image_factory=factory,
                          error_correction=qrcode.constants.ERROR_CORRECT_H)
    buf     = BytesIO()
    qr.save(buf)
    qr_svg  = buf.getvalue().decode('utf-8')
    qr_svg  = re.sub(r'<\?xml[^?]*\?>', '', qr_svg)
    qr_svg  = re.sub(r'<!DOCTYPE[^>]*>', '', qr_svg)
    qr_svg  = re.sub(r'\s+width="[^"]*"',  '', qr_svg, count=1)
    qr_svg  = re.sub(r'\s+height="[^"]*"', '', qr_svg, count=1)
    qr_svg  = qr_svg.replace('<svg ', '<svg class="qr-code" ', 1)

    html = f'''<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VPN · Jornadas Formativas SOCIA</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;900&family=Barlow+Condensed:wght@400;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

    body {{
      background: #242d3d;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: 'Nunito', 'Arial Black', sans-serif;
      overflow: hidden;
      position: relative;
    }}

    .wrap {{
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-evenly;
      min-height: 100vh;
      z-index: 1;
      padding: 4vh 2rem;
    }}

    /* ── Cabecera ── */
    .brand {{
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.4rem;
    }}
    .socia {{
      font-family: 'Nunito', sans-serif;
      font-size: clamp(4rem, 12vw, 9rem);
      font-weight: 900;
      color: transparent;
      -webkit-text-stroke: 4px #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      line-height: 1;
    }}
    .tagline {{
      font-family: 'Barlow Condensed', sans-serif;
      font-size: clamp(0.9rem, 2.4vw, 1.4rem);
      font-weight: 700;
      color: #eb114b;
      letter-spacing: 0.28em;
      text-transform: uppercase;
    }}

    /* ── QR ── */
    .qr-wrap {{
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }}
    .ring {{
      position: absolute;
      border-radius: 18px;
      border: 3px solid #eb114b;
      animation: pulse 2.8s ease-in-out infinite;
    }}
    .ring-1 {{ inset: -14px; }}
    .ring-2 {{ inset: -28px; border-width: 1.5px; border-color: rgba(235,17,75,0.25);
               animation-delay: 0.7s; }}
    @keyframes pulse {{
      0%, 100% {{ opacity: 1; transform: scale(1); }}
      50%       {{ opacity: 0.35; transform: scale(1.015); }}
    }}
    .qr-code {{
      display: block;
      width:  clamp(240px, 38vh, 420px);
      height: clamp(240px, 38vh, 420px);
      background: white;
      border-radius: 14px;
      padding: 10px;
    }}

    /* ── Mensaje ── */
    .msg {{
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }}
    .msg-main {{
      font-family: 'Nunito', sans-serif;
      font-size: clamp(1.3rem, 3.5vw, 2.2rem);
      font-weight: 900;
      color: white;
      letter-spacing: 0.02em;
    }}
    .msg-main em {{ color: #eb114b; font-style: normal; }}
    .msg-sub {{
      font-family: 'Barlow Condensed', sans-serif;
      font-size: clamp(0.8rem, 1.6vw, 1rem);
      font-weight: 400;
      color: rgba(255,255,255,0.35);
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }}

    /* ── Footer ── */
    .footer {{
      position: absolute;
      bottom: 1.2rem;
      font-family: 'Barlow Condensed', sans-serif;
      font-size: clamp(0.6rem, 1.1vw, 0.75rem);
      color: rgba(255,255,255,0.15);
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }}
  </style>
</head>
<body>
  <div class="wrap">

    <div class="brand">
      <span class="socia">SOCIA</span>
      <span class="tagline">Un SOC en tu aula</span>
    </div>

    <div class="qr-wrap">
      <div class="ring ring-1"></div>
      <div class="ring ring-2"></div>
      {qr_svg}
    </div>

    <div class="msg">
      <span class="msg-main">Escanea para <em>conectarte</em> a la plataforma</span>
      <span class="msg-sub">Jornadas Formativas &nbsp;·&nbsp; IES Rafael Alberti &nbsp;·&nbsp; Cádiz</span>
    </div>

  </div>
  <div class="footer">SOCIA &nbsp;·&nbsp; IES Rafael Alberti &nbsp;·&nbsp; Cádiz</div>
</body>
</html>'''

    DOCS.mkdir(exist_ok=True)
    out = DOCS / 'index.html'
    out.write_text(html, encoding='utf-8')
    return out

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    import argparse
    parser = argparse.ArgumentParser(
        description='Asistente interactivo VPN · Jornadas Formativas SOCIA')
    parser.add_argument('--dry-run', action='store_true',
                        help='Sin tocar OPNsense ni clasp (modo prueba)')
    args = parser.parse_args()

    print(f'''
{BOLD}╔══════════════════════════════════════════════════════╗
║  SOCIA VPN  —  Asistente de configuración            ║
╚══════════════════════════════════════════════════════╝{RST}''')

    if args.dry_run:
        print(f'  {DIM}⚠️  DRY-RUN activo — no se modifica nada{RST}')

    # ── 1. Conectar a OPNsense ─────────────────────────────────────────────
    _hdr('OPNsense')
    print(f'  📡 Conectando a {OPNSENSE_URL}...')
    opn      = None
    existing = []
    if not args.dry_run:
        try:
            opn      = OPNsenseClient(OPNSENSE_URL, OPNSENSE_USER, OPNSENSE_PASS)
            existing = opn.list_alumnos()
            _ok('Conectado')
        except Exception as e:
            _err(f'No se pudo conectar: {e}')
            sys.exit(1)

    max_num = int(existing[-1]['name'][6:]) if existing else 0
    if existing:
        _info(f'Peers actuales: alumno1 … alumno{max_num}  ({len(existing)} en total)')
    else:
        _info('No hay peers alumnoN en este servidor WireGuard')

    # ── 2. Preguntas ───────────────────────────────────────────────────────
    _hdr('Configuración')

    raw_n = _ask('¿Cuántos perfiles VPN quieres generar?', 50)
    try:
        n = int(raw_n)
        if n < 1:
            raise ValueError
    except ValueError:
        _err('Introduce un número entero positivo')
        sys.exit(1)

    if existing:
        modo = _choose(
            f'¿Qué hacer con los {len(existing)} peers existentes?',
            [('r', f'Reemplazar — borra alumno1-{max_num} y crea {n} nuevos desde alumno1'),
             ('a', f'Añadir     — mantiene los {len(existing)} actuales y crea alumno{max_num+1}-alumno{max_num+n}')]
        )
    else:
        modo = 'r'

    start_num = 1 if modo == 'r' else max_num + 1

    # ── 3. Gestionar OPNsense ──────────────────────────────────────────────
    _hdr('Peers WireGuard')

    if modo == 'r' and existing:
        print(f'  🗑️  Borrando {len(existing)} peers existentes...')
        if opn:
            for peer in existing:
                opn.delete(peer['uuid'], peer['name'])
                time.sleep(0.3)
        else:
            for p in existing:
                _info(f'[dry] Borraría {p["name"]}')

    print(f'  🔑 Generando {n} keypairs y creando peers...')
    new_slots = []
    for i in range(n):
        slot_num  = start_num + i
        name      = f'alumno{slot_num}'
        ip        = f'{IP_BASE}{IP_START + slot_num - 1}'
        priv, pub = gen_keypair()
        psk       = gen_psk()
        conf      = gen_conf(priv, ip, psk)
        new_uuid  = ''
        if opn:
            new_uuid = opn.add(name, pub, psk, ip)
            time.sleep(0.3)
        else:
            _info(f'[dry] Crearía {name} @ {ip}')
        new_slots.append({
            'slot': name, 'ip': ip, 'privkey': priv, 'pubkey': pub,
            'psk': psk, 'conf': conf, 'uuid': new_uuid,
            'libre': 'TRUE', 'nombre': '', 'email': '', 'centro': '', 'enviado_en': '',
        })

    if opn:
        print('  ⚙️  Reconfigurando WireGuard...')
        opn.reconfigure()

    fieldnames = ['slot','ip','privkey','pubkey','psk','conf',
                  'uuid','libre','nombre','email','centro','enviado_en']
    with open(CSV, 'w', newline='', encoding='utf-8') as f:
        csv.DictWriter(f, fieldnames=fieldnames,
                       quoting=csv.QUOTE_ALL).writeheader()
        csv.DictWriter(f, fieldnames=fieldnames,
                       quoting=csv.QUOTE_ALL).writerows(new_slots)
    _ok(f'{len(new_slots)} slots exportados → slots_vpn.csv')

    # ── 4. Desplegar Apps Script ───────────────────────────────────────────
    _hdr('Google Apps Script')
    check_clasp()
    if not args.dry_run:
        deploy_slots(new_slots)
        run_cmd('clasp open')

    if modo == 'r':
        print(f'\n  {BOLD}➡️  En Apps Script: ejecuta{RST}  setup()')
        _info('Recrea la hoja Slots completa con todos los perfiles')
    else:
        print(f'\n  {BOLD}➡️  En Apps Script: ejecuta{RST}  addSlotsToSheet()')
        _info('Añade los nuevos perfiles sin borrar ni resetear los existentes')

    # ── 5. Página de proyección ────────────────────────────────────────────
    _hdr('Página de proyección')

    gen = _choose('¿Generar la página QR para proyectar?',
                  [('s', 'Sí'), ('n', 'No, lo haré después')])

    if gen == 's':
        print()
        form_url = _ask('URL del Google Form (cópiala del Log de Apps Script)').strip()
        if form_url:
            out = gen_qr_page(form_url)
            if out:
                _ok(f'Página generada → {out.relative_to(ROOT)}')
                webbrowser.open(out.as_uri())
                print()
                _info('Abierta en el navegador. Para proyectarla pulsa F11 (pantalla completa).')
                _info('Para GitHub Pages: activa Pages en el repo apuntando a la carpeta /docs')
        else:
            _info('URL vacía — puedes generar la página más tarde ejecutando gen_qr.py <url>')

    print(f'\n{BOLD}✅ TODO LISTO{RST}\n')

if __name__ == '__main__':
    main()
