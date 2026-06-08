#!/usr/bin/env python3
"""Utilidades compartidas para run.py y run_team.py."""

import base64, os, re, subprocess, sys
import urllib3
from pathlib import Path

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

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

# ── Entorno ────────────────────────────────────────────────────────────────────
def load_env(env_path: Path):
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

def require_env(key, default=None):
    val = os.environ.get(key, default)
    if not val:
        _err(f'Falta {key}. Configúrala en setup/.env')
        sys.exit(1)
    return val

# ── Criptografía WireGuard ─────────────────────────────────────────────────────
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

def gen_keypair():
    pk   = X25519PrivateKey.generate()
    priv = base64.b64encode(pk.private_bytes_raw()).decode()
    pub  = base64.b64encode(pk.public_key().public_bytes_raw()).decode()
    return priv, pub

def gen_psk():
    return base64.b64encode(os.urandom(32)).decode()

def gen_conf(privkey, ip, psk, server_pubkey, dns, allowed_ips, endpoint, keepalive):
    return (
        f'[Interface]\nPrivateKey = {privkey}\nAddress = {ip}/32\n'
        f'DNS = {dns}\n\n[Peer]\nPublicKey = {server_pubkey}\n'
        f'PresharedKey = {psk}\nAllowedIPs = {allowed_ips}\n'
        f'Endpoint = {endpoint}\nPersistentKeepalive = {keepalive}\n'
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

    def list_peers(self, prefix):
        """Devuelve [{name, uuid}] de peers que empiezan por prefix, ordenados."""
        data = self._get('/api/wireguard/client/searchClient',
                         {'current': 1, 'rowCount': 500, 'searchPhrase': ''})
        peers = [
            {'name': r['name'], 'uuid': r.get('uuid', '')}
            for r in data.get('rows', [])
            if r.get('name', '').startswith(prefix)
        ]
        return sorted(peers, key=lambda x: x['name'])

    def delete(self, uuid, name):
        result = self._post(f'/api/wireguard/client/delClient/{uuid}')
        ok = 'deleted' in str(result)
        print(f'  {"✅" if ok else "⚠️ "} Borrado {name}')
        return ok

    def add(self, name, pubkey, psk, ip, server_uuid, keepalive='15'):
        result = self._post('/api/wireguard/client/addClient', {'client': {
            'enabled': '1', 'name': name, 'pubkey': pubkey, 'psk': psk,
            'tunneladdress': f'{ip}/32', 'serveraddress': '', 'serverport': '',
            'endpoint': '', 'keepalive': keepalive, 'servers': server_uuid,
        }})
        uid = result.get('uuid', '')
        print(f'  {"✅" if uid else "⚠️ "} Creado {name} ({ip})')
        return uid

    def reconfigure(self):
        result = self._post('/api/wireguard/service/reconfigure')
        return result.get('result', result)

# ── Shell / clasp ──────────────────────────────────────────────────────────────
def run_cmd(cmd, cwd):
    r = subprocess.run(cmd, shell=True, cwd=str(cwd),
                       capture_output=True, text=True)
    return r.stdout.strip(), r.stderr.strip(), r.returncode

def check_clasp():
    if not (Path.home() / '.clasprc.json').exists():
        _err('clasp no autenticado. Ejecuta primero:  clasp login')
        sys.exit(1)
    _ok('clasp autenticado')

# ── Infraestructura.md → INFRA_HTML ───────────────────────────────────────────
def inject_infra_html(infra_md_path: Path, config_gs_path: Path):
    try:
        import markdown as md_lib
    except ImportError:
        _err('Instala markdown:  pip install markdown  — INFRA_HTML no actualizado')
        return

    if not infra_md_path.exists():
        _info(f'{infra_md_path.name} no encontrado — INFRA_HTML no actualizado')
        return

    md_content = infra_md_path.read_text(encoding='utf-8')
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

    final_html = f'<div style="font-family:Arial,sans-serif;">\n{html}\n</div>'
    config     = config_gs_path.read_text(encoding='utf-8')

    new_config = re.sub(
        r'(INFRA_HTML:\s*`).*?(`)',
        lambda m: m.group(1) + '\n    ' + final_html + '\n  ' + m.group(2),
        config,
        flags=re.DOTALL
    )
    config_gs_path.write_text(new_config, encoding='utf-8')
    _ok('INFRA_HTML actualizado desde infraestructura.md')
