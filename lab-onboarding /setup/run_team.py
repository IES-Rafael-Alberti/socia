#!/usr/bin/env python3
"""
run_team.py  —  Asistente interactivo VPN equipos · Jornadas Formativas SOCIA
==============================================================================
Uso:
  python3 setup/run_team.py                # flujo completo
  python3 setup/run_team.py --deploy-only  # solo sube el código a Apps Script
  python3 setup/run_team.py --dry-run      # sin tocar OPNsense ni clasp
"""

import csv, os, re, sys, time, webbrowser
from io import BytesIO
from pathlib import Path

from vpn_utils import (
    BOLD, DIM, RST,
    _hdr, _ok, _err, _info, _ask, _choose,
    load_env, require_env,
    gen_keypair, gen_psk, gen_conf,
    OPNsenseClient, run_cmd, check_clasp,
    inject_infra_html,
)

# ── Rutas ──────────────────────────────────────────────────────────────────────
BASE        = Path(__file__).parent
ROOT        = BASE.parent
SCRIPT_TEAM = ROOT / 'apps-script-team'
DOCS        = ROOT / 'docs'
CSV         = BASE / 'slots_team.csv'
INFRA_MD    = ROOT / 'instrucciones' / 'infraestructura_team.md'

# ── Configuración ──────────────────────────────────────────────────────────────
load_env(BASE / '.env')

OPNSENSE_URL   = require_env('OPNSENSE_URL')
OPNSENSE_USER  = require_env('OPNSENSE_USER')
OPNSENSE_PASS  = require_env('OPNSENSE_PASS')
SERVER_UUID    = require_env('SERVER_UUID')
SERVER_PUBKEY  = require_env('SERVER_PUBKEY')
WG_ENDPOINT    = require_env('WG_ENDPOINT')
WG_DNS         = '1.1.1.1, 8.8.8.8'
WG_KEEPALIVE   = '15'
WG_ALLOWED_IPS = '10.0.3.0/24, 172.17.33.0/24, 172.17.34.0/24, 172.18.1.0/24, 172.31.0.0/24'

IP_BASE        = '10.0.3.'
IP_TEAM_START  = 151        # equipo1_m1 → 10.0.3.151 … equipo25_m2 → 10.0.3.200
MEMBERS        = 2          # miembros por equipo (el form tiene 2 campos de email)
PEER_PREFIX    = 'equipo'

# ── Utilidades de equipo ───────────────────────────────────────────────────────
def peer_name(team_num, member_num):
    return f'equipo{team_num}_m{member_num}'

def team_ip(team_num, member_num):
    offset = (team_num - 1) * MEMBERS + (member_num - 1)
    return f'{IP_BASE}{IP_TEAM_START + offset}'

def max_team_from_peers(peers):
    nums = []
    for p in peers:
        m = re.match(r'^equipo(\d+)_m\d+$', p['name'])
        if m:
            nums.append(int(m.group(1)))
    return max(nums, default=0)

# ── Deploy Apps Script equipos ─────────────────────────────────────────────────
def _escape_conf(conf):
    return (conf
            .replace('\\', '\\\\')
            .replace('"',  '\\"')
            .replace('\n', '\\n')
            .replace('\r', ''))

def deploy_team_slots(teams):
    bootstrap = SCRIPT_TEAM / 'Bootstrap_team.gs'
    js_rows   = []
    for t in teams:
        row = (
            f'  ["{t["equipo"]}",'
            f'"{t["slot_m1"]}","{t["ip_m1"]}","{t["privkey_m1"]}",'
            f'"{t["pubkey_m1"]}","{t["psk_m1"]}","{_escape_conf(t["conf_m1"])}","{t["uuid_m1"]}",'
            f'"{t["slot_m2"]}","{t["ip_m2"]}","{t["privkey_m2"]}",'
            f'"{t["pubkey_m2"]}","{t["psk_m2"]}","{_escape_conf(t["conf_m2"])}","{t["uuid_m2"]}"]'
        )
        js_rows.append(row)

    slots_js = 'var SLOTS_TEAM_DATA = [\n' + ',\n'.join(js_rows) + '\n];'
    original = bootstrap.read_text(encoding='utf-8')
    content  = re.sub(r'var SLOTS_TEAM_DATA = \[.*?\];',
                      lambda m: slots_js, original, flags=re.DOTALL)
    bootstrap.write_text(content, encoding='utf-8')
    _ok(f'{len(teams)} equipos inyectados en Bootstrap_team.gs')

    inject_infra_html(INFRA_MD, SCRIPT_TEAM / 'Config_team.gs')

    clasp_file = SCRIPT_TEAM / '.clasp.json'
    if not clasp_file.exists():
        print('  📦 Creando proyecto Apps Script equipos...')
        out, err, rc = run_cmd(
            'clasp create --type sheets --title "VPN Equipos SOCIA"',
            SCRIPT_TEAM
        )
        print(f'  {out or err}')

    out, err, rc = run_cmd('clasp push --force', SCRIPT_TEAM)
    bootstrap.write_text(original, encoding='utf-8')
    if out:
        _info(out)
    if rc != 0:
        _err(f'clasp push falló:\n{err}')
        sys.exit(1)
    _ok('Código subido · Bootstrap_team.gs restaurado (claves no quedan en disco)')

# ── Página de proyección ───────────────────────────────────────────────────────
def gen_qr_page(form_url: str):
    try:
        import qrcode
        import qrcode.image.svg
    except ImportError:
        _err('Falta el paquete qrcode. Ejecuta:  pip install qrcode[svg]')
        return None

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
  <title>VPN Equipos · Jornadas Formativas SOCIA</title>
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
    }}
    .wrap {{
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-evenly;
      min-height: 100vh;
      padding: 4vh 2rem;
    }}
    .brand {{ display: flex; flex-direction: column; align-items: center; gap: 0.4rem; }}
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
    .qr-wrap {{ position: relative; display: flex; align-items: center; justify-content: center; }}
    .ring {{
      position: absolute;
      border-radius: 18px;
      border: 3px solid #eb114b;
      animation: pulse 2.8s ease-in-out infinite;
    }}
    .ring-1 {{ inset: -14px; }}
    .ring-2 {{ inset: -28px; border-width: 1.5px; border-color: rgba(235,17,75,0.25); animation-delay: 0.7s; }}
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
    .msg {{ text-align: center; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }}
    .msg-main {{
      font-size: clamp(1.3rem, 3.5vw, 2.2rem);
      font-weight: 900;
      color: white;
    }}
    .msg-main em {{ color: #eb114b; font-style: normal; }}
    .msg-sub {{
      font-family: 'Barlow Condensed', sans-serif;
      font-size: clamp(0.8rem, 1.6vw, 1rem);
      color: rgba(255,255,255,0.35);
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }}
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
      <span class="tagline">Un SOC en tu aula &nbsp;·&nbsp; Registro por equipos</span>
    </div>
    <div class="qr-wrap">
      <div class="ring ring-1"></div>
      <div class="ring ring-2"></div>
      {qr_svg}
    </div>
    <div class="msg">
      <span class="msg-main">Registra tu <em>equipo</em> para acceder a la plataforma</span>
      <span class="msg-sub">Jornadas Formativas &nbsp;·&nbsp; IES Rafael Alberti &nbsp;·&nbsp; Cádiz</span>
    </div>
  </div>
  <div class="footer">SOCIA &nbsp;·&nbsp; IES Rafael Alberti &nbsp;·&nbsp; Cádiz</div>
</body>
</html>'''

    DOCS.mkdir(exist_ok=True)
    out = DOCS / 'index_team.html'
    out.write_text(html, encoding='utf-8')
    return out

# ── Cargar equipos desde CSV ───────────────────────────────────────────────────
def load_teams_from_csv():
    if not CSV.exists():
        _err(f'No se encuentra {CSV}. Ejecuta primero sin --deploy-only.')
        sys.exit(1)
    with open(CSV, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    import argparse
    parser = argparse.ArgumentParser(
        description='Asistente interactivo VPN equipos · Jornadas Formativas SOCIA')
    parser.add_argument('--dry-run', action='store_true',
                        help='Sin tocar OPNsense ni clasp (modo prueba)')
    parser.add_argument('--deploy-only', action='store_true',
                        help='Solo sube el código a Apps Script usando el slots_team.csv existente')
    args = parser.parse_args()

    print(f'''
{BOLD}╔══════════════════════════════════════════════════════╗
║  SOCIA VPN  —  Registro por Equipos                  ║
╚══════════════════════════════════════════════════════╝{RST}''')

    if args.dry_run:
        print(f'  {DIM}⚠️  DRY-RUN activo — no se modifica nada{RST}')

    # ── Modo deploy-only: salta OPNsense y usa el CSV existente ───────────
    if args.deploy_only:
        _hdr('Deploy-only — cargando slots_team.csv')
        teams = load_teams_from_csv()
        _ok(f'{len(teams)} equipos cargados desde {CSV.name}')
        _hdr('Google Apps Script — Equipos')
        check_clasp()
        deploy_team_slots(teams)
        run_cmd('clasp open', SCRIPT_TEAM)
        print(f'\n  {BOLD}➡️  En Apps Script: ejecuta{RST}  setupTeam()')
        _hdr('Página de proyección')
        try:
            gen = _choose('¿Generar la página QR para proyectar?',
                          [('s', 'Sí'), ('n', 'No, lo haré después')])
            if gen == 's':
                form_url = _ask('URL del Google Form').strip()
                if form_url:
                    out = gen_qr_page(form_url)
                    if out:
                        _ok(f'Página generada → {out.relative_to(ROOT)}')
                        webbrowser.open(out.as_uri())
        except EOFError:
            _info('Ejecutado sin terminal interactivo — QR no generado')
        print(f'\n{BOLD}✅ TODO LISTO{RST}\n')
        return

    # ── 1. Conectar a OPNsense ─────────────────────────────────────────────
    _hdr('OPNsense')
    print(f'  📡 Conectando a {OPNSENSE_URL}...')
    opn      = None
    existing = []
    if not args.dry_run:
        try:
            opn      = OPNsenseClient(OPNSENSE_URL, OPNSENSE_USER, OPNSENSE_PASS)
            existing = opn.list_peers(PEER_PREFIX)
            _ok('Conectado')
        except Exception as e:
            _err(f'No se pudo conectar: {e}')
            sys.exit(1)

    max_team = max_team_from_peers(existing)
    if existing:
        _info(f'Peers actuales: {len(existing)} peers equipo* (hasta equipo{max_team})')
    else:
        _info('No hay peers equipoN en este servidor WireGuard')

    # ── 2. Preguntas ───────────────────────────────────────────────────────
    _hdr('Configuración')

    raw_n = _ask('¿Cuántos equipos quieres generar?', 25)
    try:
        n = int(raw_n)
        if n < 1:
            raise ValueError
    except ValueError:
        _err('Introduce un número entero positivo')
        sys.exit(1)

    total_peers = n * MEMBERS
    max_ip      = IP_TEAM_START + total_peers - 1
    _info(f'Se crearán {total_peers} peers VPN ({n} equipos × {MEMBERS} miembros) → IPs 10.0.3.{IP_TEAM_START}–10.0.3.{max_ip}')

    if max_ip > 200:
        _err(f'Rango de IPs insuficiente: el máximo es 10.0.3.200 (25 equipos de 2). Reduce el número de equipos.')
        sys.exit(1)

    if existing:
        modo = _choose(
            f'¿Qué hacer con los {len(existing)} peers existentes?',
            [('r', f'Reemplazar — borra todos los equipo* y crea {n} equipos nuevos desde equipo1'),
             ('a', f'Añadir     — mantiene los actuales y crea equipo{max_team+1}–equipo{max_team+n}')]
        )
    else:
        modo = 'r'

    start_team = 1 if modo == 'r' else max_team + 1

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

    print(f'  🔑 Generando {total_peers} keypairs y creando peers...')
    new_teams = []
    for i in range(n):
        t = start_team + i

        # Miembro 1
        name_m1 = peer_name(t, 1)
        ip_m1   = team_ip(t, 1)
        priv1, pub1 = gen_keypair()
        psk1        = gen_psk()
        conf1       = gen_conf(priv1, ip_m1, psk1, SERVER_PUBKEY,
                               WG_DNS, WG_ALLOWED_IPS, WG_ENDPOINT, WG_KEEPALIVE)
        uuid1 = ''
        if opn:
            uuid1 = opn.add(name_m1, pub1, psk1, ip_m1, SERVER_UUID, WG_KEEPALIVE)
            time.sleep(0.3)
        else:
            _info(f'[dry] Crearía {name_m1} @ {ip_m1}')

        # Miembro 2
        name_m2 = peer_name(t, 2)
        ip_m2   = team_ip(t, 2)
        priv2, pub2 = gen_keypair()
        psk2        = gen_psk()
        conf2       = gen_conf(priv2, ip_m2, psk2, SERVER_PUBKEY,
                               WG_DNS, WG_ALLOWED_IPS, WG_ENDPOINT, WG_KEEPALIVE)
        uuid2 = ''
        if opn:
            uuid2 = opn.add(name_m2, pub2, psk2, ip_m2, SERVER_UUID, WG_KEEPALIVE)
            time.sleep(0.3)
        else:
            _info(f'[dry] Crearía {name_m2} @ {ip_m2}')

        new_teams.append({
            'equipo':    f'equipo{t}',
            'slot_m1':   name_m1, 'ip_m1': ip_m1,
            'privkey_m1': priv1,  'pubkey_m1': pub1,
            'psk_m1':    psk1,    'conf_m1': conf1, 'uuid_m1': uuid1,
            'slot_m2':   name_m2, 'ip_m2': ip_m2,
            'privkey_m2': priv2,  'pubkey_m2': pub2,
            'psk_m2':    psk2,    'conf_m2': conf2, 'uuid_m2': uuid2,
            'libre': 'TRUE', 'nombre_equipo': '', 'email_m1': '',
            'email_m2': '', 'centro': '', 'enviado_en': '',
        })

    if opn:
        print('  ⚙️  Reconfigurando WireGuard...')
        opn.reconfigure()

    fieldnames = [
        'equipo',
        'slot_m1', 'ip_m1', 'privkey_m1', 'pubkey_m1', 'psk_m1', 'conf_m1', 'uuid_m1',
        'slot_m2', 'ip_m2', 'privkey_m2', 'pubkey_m2', 'psk_m2', 'conf_m2', 'uuid_m2',
        'libre', 'nombre_equipo', 'email_m1', 'email_m2', 'centro', 'enviado_en',
    ]
    with open(CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(new_teams)
    _ok(f'{len(new_teams)} equipos exportados → slots_team.csv')

    # ── 4. Desplegar Apps Script ───────────────────────────────────────────
    _hdr('Google Apps Script — Equipos')
    check_clasp()
    if not args.dry_run:
        deploy_team_slots(new_teams)
        run_cmd('clasp open', SCRIPT_TEAM)

    print(f'\n  {BOLD}➡️  En Apps Script: ejecuta{RST}  setupTeam()')
    _info('Crea la hoja Slots_Equipos, la hoja TheHive (con las 50 URLs precargadas) y el formulario')

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
                _info('Abierta en el navegador. F11 para pantalla completa.')

    print(f'\n{BOLD}✅ TODO LISTO{RST}\n')

if __name__ == '__main__':
    main()
