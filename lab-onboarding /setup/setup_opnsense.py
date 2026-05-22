#!/usr/bin/env python3
"""
setup_opnsense.py
=================
Fase 0 del sistema de registro VPN para las Jornadas Formativas SOCIA.

Qué hace:
  1. Borra los peers alumno1-12 existentes (invalida configs viejas)
  2. Genera 50 keypairs Curve25519 + PSK individuales
  3. Crea alumno1-50 en OPNsense con IPs 10.0.3.101-150
  4. Aplica la configuración (reconfigure)
  5. Exporta slots_vpn.csv → importar a Google Sheets

Uso:
  pip install -r requirements.txt
  python3 setup_opnsense.py

  Añade --dry-run para ver qué haría sin tocar OPNsense.
"""

import requests
import json
import csv
import base64
import os
import re
import sys
import time
import urllib3
import argparse
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURACIÓN  — lee de .env si existe, si no usa los valores por defecto
# Copia setup/.env.example → setup/.env y rellena los valores reales
# ─────────────────────────────────────────────────────────────────────────────
def _load_env():
    env_path = Path(__file__).parent / '.env'
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

_load_env()

def _require(key, default=None):
    val = os.environ.get(key, default)
    if not val:
        print(f'❌ Falta la variable {key}. Configúrala en setup/.env')
        sys.exit(1)
    return val

OPNSENSE_URL  = _require('OPNSENSE_URL')
OPNSENSE_USER = _require('OPNSENSE_USER')
OPNSENSE_PASS = _require('OPNSENSE_PASS')

SERVER_UUID   = _require('SERVER_UUID')
SERVER_PUBKEY = _require('SERVER_PUBKEY')
WG_ENDPOINT   = _require('WG_ENDPOINT')
WG_DNS        = '1.1.1.1, 8.8.8.8'
WG_KEEPALIVE  = '15'

# Subredes accesibles por VPN (split tunnel — solo red del centro)
WG_ALLOWED_IPS = '10.0.3.0/24, 172.17.33.0/24, 172.17.34.0/24, 172.18.1.0/24, 172.31.0.0/24'

IP_BASE  = '10.0.3.'
IP_START = 101        # alumno1 → 10.0.3.101, alumno50 → 10.0.3.150

# Peers existentes a borrar
ALUMNO_DELETE = {
    'alumno1':  'REDACTED_PEER_UUID',
    'alumno2':  'REDACTED_PEER_UUID',
    'alumno3':  'REDACTED_PEER_UUID',
    'alumno4':  'REDACTED_PEER_UUID',
    'alumno5':  'REDACTED_PEER_UUID',
    'alumno6':  'REDACTED_PEER_UUID',
    'alumno7':  'REDACTED_PEER_UUID',
    'alumno8':  'REDACTED_PEER_UUID',
    'alumno9':  'REDACTED_PEER_UUID',
    'alumno10': 'REDACTED_PEER_UUID',
    'alumno11': 'REDACTED_PEER_UUID',
    'alumno12': 'REDACTED_PEER_UUID',
}

OUTPUT_CSV = 'slots_vpn.csv'

# ─────────────────────────────────────────────────────────────────────────────
# GENERACIÓN DE CLAVES
# ─────────────────────────────────────────────────────────────────────────────

def gen_keypair():
    pk = X25519PrivateKey.generate()
    priv = base64.b64encode(pk.private_bytes_raw()).decode()
    pub  = base64.b64encode(pk.public_key().public_bytes_raw()).decode()
    return priv, pub

def gen_psk():
    return base64.b64encode(os.urandom(32)).decode()

def gen_conf(privkey, ip, psk):
    return (
        f"[Interface]\n"
        f"PrivateKey = {privkey}\n"
        f"Address = {ip}/32\n"
        f"DNS = {WG_DNS}\n"
        f"\n"
        f"[Peer]\n"
        f"PublicKey = {SERVER_PUBKEY}\n"
        f"PresharedKey = {psk}\n"
        f"AllowedIPs = {WG_ALLOWED_IPS}\n"
        f"Endpoint = {WG_ENDPOINT}\n"
        f"PersistentKeepalive = {WG_KEEPALIVE}\n"
    )

# ─────────────────────────────────────────────────────────────────────────────
# CLIENTE OPNSENSE
# ─────────────────────────────────────────────────────────────────────────────

class OPNsenseClient:
    def __init__(self, url, user, password):
        self.url = url
        self.session = requests.Session()
        self.session.verify = False
        self.csrf_token = None
        self._login(user, password)

    def _login(self, user, password):
        # 1. GET login page → token para el form de login
        resp = self.session.get(f'{self.url}/', headers={'User-Agent': 'Mozilla/5.0'})
        m = re.search(r'name="([^"]+)" value="([^"]+)" autocomplete="new-password"', resp.text)
        if not m:
            raise RuntimeError('No se encontró el formulario de login')
        csrf_field, csrf_value = m.group(1), m.group(2)

        # 2. POST login
        login_resp = self.session.post(
            f'{self.url}/',
            data={'usernamefld': user, 'passwordfld': password,
                  'login': '1', csrf_field: csrf_value},
            headers={'User-Agent': 'Mozilla/5.0'},
            allow_redirects=True
        )
        if '/ui/core/dashboard' not in login_resp.url:
            raise RuntimeError(f'Login fallido — URL final: {login_resp.url}')

        # 3. GET dashboard → obtener CSRF token fresco válido para la sesión activa
        dash = self.session.get(f'{self.url}/ui/core/dashboard',
                                headers={'User-Agent': 'Mozilla/5.0'})
        h = re.search(r'setRequestHeader\("X-CSRFToken",\s*"([^"]+)"', dash.text)
        if not h:
            raise RuntimeError('No se pudo obtener el CSRF token del dashboard')
        self.csrf_token = h.group(1)
        print(f'  ✅ Login OK (CSRF: {self.csrf_token[:12]}...)')

    def _post(self, path, data=None):
        resp = self.session.post(
            f'{self.url}{path}',
            json=data or {},
            headers={
                'User-Agent':   'Mozilla/5.0',
                'Content-Type': 'application/json',
                'X-CSRFToken':  self.csrf_token,
                'Referer':      f'{self.url}/ui/core/dashboard',
                'Origin':       self.url,
            }
        )
        try:
            return resp.json()
        except Exception:
            return {'status': resp.status_code, 'text': resp.text[:200]}

    def search_alumno_clients(self):
        result = self._post('/api/wireguard/client/searchClient',
                            {'current': 1, 'rowCount': 200})
        return [(r['name'], r['uuid'])
                for r in result.get('rows', [])
                if r.get('name', '').startswith('alumno')]

    def delete_client(self, uuid, name):
        result = self._post(f'/api/wireguard/client/delClient/{uuid}')
        ok = result.get('result') == 'deleted' or 'deleted' in str(result)
        print(f'  {"✅" if ok else "⚠️ "} Borrado {name}: {result}')
        return ok

    def add_client(self, name, pubkey, psk, ip):
        data = {
            'client': {
                'enabled':       '1',
                'name':          name,
                'pubkey':        pubkey,
                'psk':           psk,
                'tunneladdress': f'{ip}/32',
                'serveraddress': '',
                'serverport':    '',
                'endpoint':      '',
                'keepalive':     WG_KEEPALIVE,
                'servers':       SERVER_UUID,
            }
        }
        result = self._post('/api/wireguard/client/addClient', data)
        uuid = result.get('uuid', '')
        ok = bool(uuid)
        print(f'  {"✅" if ok else "⚠️ "} Creado {name} ({ip}): uuid={uuid or result}')
        return uuid

    def reconfigure(self):
        result = self._post('/api/wireguard/service/reconfigure')
        print(f'  🔄 Reconfigure: {result}')
        return result

# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true',
                        help='Genera el CSV sin tocar OPNsense')
    args = parser.parse_args()

    print('╔══════════════════════════════════════════════════╗')
    print('║  VPN SETUP — Jornadas Formativas SOCIA           ║')
    print('╚══════════════════════════════════════════════════╝\n')

    if args.dry_run:
        print('⚠️  MODO DRY-RUN — no se modifica OPNsense\n')

    # Paso 1: Login
    print('📡 Conectando a OPNsense...')
    if not args.dry_run:
        opn = OPNsenseClient(OPNSENSE_URL, OPNSENSE_USER, OPNSENSE_PASS)

    # Paso 2: Descubrir y borrar todos los peers alumno* existentes
    if not args.dry_run:
        existing = opn.search_alumno_clients()
        print(f'\n🗑️  Encontrados {len(existing)} peers alumno* existentes — borrando...')
        for name, uuid in existing:
            opn.delete_client(uuid, name)
            time.sleep(0.4)
    else:
        print(f'\n🗑️  [DRY] Descubriría y borraría todos los peers alumno* existentes')

    # Paso 3: Generar y crear 50 slots
    print(f'\n🔑 Generando 50 keypairs y creando peers...')
    slots = []
    for i in range(1, 51):
        name = f'alumno{i}'
        ip   = f'{IP_BASE}{IP_START + i - 1}'
        priv, pub = gen_keypair()
        psk       = gen_psk()
        conf      = gen_conf(priv, ip, psk)

        new_uuid = ''
        if not args.dry_run:
            new_uuid = opn.add_client(name, pub, psk, ip)
            time.sleep(0.4)
        else:
            print(f'  [DRY] Crearía {name} @ {ip}')

        slots.append({
            'slot':       name,
            'ip':         ip,
            'privkey':    priv,
            'pubkey':     pub,
            'psk':        psk,
            'conf':       conf,
            'uuid':       new_uuid,
            'libre':      'TRUE',
            'nombre':     '',
            'email':      '',
            'centro':     '',
            'enviado_en': '',
        })

    # Paso 4: Aplicar config
    print('\n⚙️  Aplicando configuración en OPNsense...')
    if not args.dry_run:
        opn.reconfigure()

    # Paso 5: Exportar CSV
    print(f'\n📄 Exportando {OUTPUT_CSV}...')
    fieldnames = ['slot','ip','privkey','pubkey','psk','conf',
                  'uuid','libre','nombre','email','centro','enviado_en']
    with open(OUTPUT_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(slots)

    print(f'\n✅ HECHO — {len(slots)} slots en {OUTPUT_CSV}')
    print('\nSiguiente paso:')
    print('  → Abre Google Sheets y sube slots_vpn.csv como hoja "Slots"')
    print('  → Asegúrate de que la columna G (libre) quede como TRUE/FALSE')
    print('  → Sigue las instrucciones en apps-script/README.md\n')

if __name__ == '__main__':
    main()
