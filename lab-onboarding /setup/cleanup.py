#!/usr/bin/env python3
"""
cleanup.py  —  Limpieza de perfiles VPN post-formación · Jornadas SOCIA
========================================================================
Borra peers WireGuard de OPNsense de forma interactiva tras acabar la
formación.

Uso:
  python3 setup/cleanup.py
  python3 setup/cleanup.py --dry-run   # muestra qué se borraría sin tocar nada
"""

import re, sys, time
from pathlib import Path

from vpn_utils import (
    BOLD, DIM, RED, RST,
    _hdr, _ok, _err, _info, _ask, _choose,
    load_env, require_env,
    OPNsenseClient,
)

BASE = Path(__file__).parent
load_env(BASE / '.env')

OPNSENSE_URL  = require_env('OPNSENSE_URL')
OPNSENSE_USER = require_env('OPNSENSE_USER')
OPNSENSE_PASS = require_env('OPNSENSE_PASS')

# ── Consultar peers ────────────────────────────────────────────────────────────

def _fetch_all(opn):
    return opn._get('/api/wireguard/client/searchClient',
                    {'current': 1, 'rowCount': 500, 'searchPhrase': ''}).get('rows', [])


def list_alumnos(opn):
    rows = _fetch_all(opn)
    peers = [
        {'name': r['name'], 'uuid': r.get('uuid', ''), 'ip': r.get('tunneladdress', '')}
        for r in rows if re.match(r'^alumno\d+$', r.get('name', ''))
    ]
    return sorted(peers, key=lambda x: int(x['name'][6:]))


def list_equipo_peers(opn):
    rows = _fetch_all(opn)
    peers = [
        {'name': r['name'], 'uuid': r.get('uuid', ''), 'ip': r.get('tunneladdress', '')}
        for r in rows if re.match(r'^equipo\d+_m\d+$', r.get('name', ''))
    ]
    return sorted(peers, key=lambda x: (
        int(re.match(r'^equipo(\d+)_m(\d+)$', x['name']).group(1)),
        int(re.match(r'^equipo(\d+)_m(\d+)$', x['name']).group(2)),
    ))


def group_by_team(peers):
    teams = {}
    for p in peers:
        m = re.match(r'^equipo(\d+)_m(\d+)$', p['name'])
        if m:
            teams.setdefault(int(m.group(1)), []).append(p)
    return [{'num': t, 'members': teams[t]} for t in sorted(teams)]

# ── Mostrar ────────────────────────────────────────────────────────────────────

def show_alumnos(peers):
    print(f'\n  {BOLD}{len(peers)} perfiles individuales:{RST}')
    for i, p in enumerate(peers, 1):
        ip_str = f'  {DIM}({p["ip"]}){RST}' if p.get('ip') else ''
        print(f'    {i:>3}. {p["name"]}{ip_str}')


def show_teams(teams):
    total = sum(len(t['members']) for t in teams)
    print(f'\n  {BOLD}{len(teams)} equipos  ({total} peers en total):{RST}')
    for t in teams:
        members_str = ',  '.join(m['name'] for m in t['members'])
        print(f'    {t["num"]:>3}. equipo{t["num"]}  →  {members_str}')

# ── Selección ──────────────────────────────────────────────────────────────────

def parse_selection(raw, max_n):
    """Parsea "1,3,5-8,10" en una lista de índices 1-based válidos."""
    selected = set()
    for part in raw.split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-', 1)
            try:
                selected.update(range(int(a), int(b) + 1))
            except ValueError:
                pass
        elif part.isdigit():
            selected.add(int(part))
    return sorted(n for n in selected if 1 <= n <= max_n)


def pick_alumnos(alumnos):
    """Pregunta cuáles alumnos borrar y devuelve la lista."""
    show_alumnos(alumnos)
    sel = _choose('¿Cuáles borrar?', [
        ('t', f'Todos ({len(alumnos)})'),
        ('n', f'Los primeros N'),
        ('s', 'Selección manual (por número de lista)'),
        ('c', 'Ninguno — cancelar'),
    ])
    if sel == 'c':
        return []
    if sel == 't':
        return alumnos[:]
    if sel == 'n':
        raw = _ask(f'¿Cuántos? (1-{len(alumnos)})')
        try:
            n = int(raw)
            if not 1 <= n <= len(alumnos):
                raise ValueError
            return alumnos[:n]
        except ValueError:
            _err('Número no válido — cancelado')
            return []
    # sel == 's'
    raw = _ask('Números separados por comas o rangos  (ej: 1,3,5-8)')
    indices = parse_selection(raw, len(alumnos))
    if not indices:
        _err('Selección vacía o no válida — cancelado')
        return []
    return [alumnos[i - 1] for i in indices]


def pick_teams(teams):
    """Pregunta cuáles equipos borrar y devuelve la lista plana de peers."""
    show_teams(teams)
    sel = _choose('¿Cuáles borrar?', [
        ('t', f'Todos los equipos ({len(teams)})'),
        ('n', f'Los primeros N equipos'),
        ('s', 'Selección manual de equipos (por número de lista)'),
        ('c', 'Ninguno — cancelar'),
    ])
    if sel == 'c':
        return []
    if sel == 't':
        return [p for t in teams for p in t['members']]
    if sel == 'n':
        raw = _ask(f'¿Cuántos equipos? (1-{len(teams)})')
        try:
            n = int(raw)
            if not 1 <= n <= len(teams):
                raise ValueError
            return [p for t in teams[:n] for p in t['members']]
        except ValueError:
            _err('Número no válido — cancelado')
            return []
    # sel == 's'
    raw = _ask('Números de equipo separados por comas o rangos  (ej: 1,3,5-8)')
    indices = parse_selection(raw, len(teams))
    if not indices:
        _err('Selección vacía o no válida — cancelado')
        return []
    return [p for i in indices for p in teams[i - 1]['members']]

# ── Confirmar y borrar ─────────────────────────────────────────────────────────

def confirm_delete(peers):
    print(f'\n  {RED}{BOLD}Se van a borrar {len(peers)} peers:{RST}')
    shown = peers if len(peers) <= 20 else peers[:20]
    for p in shown:
        print(f'    • {p["name"]}')
    if len(peers) > 20:
        print(f'    … y {len(peers) - 20} más')
    val = input(f'\n{RED}{BOLD}¿Confirmas el borrado? [s/N]:{RST} ').strip().lower()
    return val == 's'


def delete_peers(opn, peers, dry_run):
    for p in peers:
        if dry_run:
            _info(f'[dry] Borraría {p["name"]}')
        else:
            opn.delete(p['uuid'], p['name'])
            time.sleep(0.3)

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description='Limpieza de perfiles VPN · Jornadas SOCIA')
    parser.add_argument('--dry-run', action='store_true',
                        help='Muestra qué se borraría sin tocar OPNsense')
    args = parser.parse_args()

    print(f'''
{BOLD}╔══════════════════════════════════════════════════════╗
║  SOCIA VPN  —  Limpieza post-formación               ║
╚══════════════════════════════════════════════════════╝{RST}''')

    if args.dry_run:
        print(f'  {DIM}⚠️  DRY-RUN activo — no se modifica nada{RST}')

    # ── Conectar ───────────────────────────────────────────────────────────
    _hdr('OPNsense')
    print(f'  📡 Conectando a {OPNSENSE_URL}...')
    try:
        opn = OPNsenseClient(OPNSENSE_URL, OPNSENSE_USER, OPNSENSE_PASS)
        _ok('Conectado')
    except Exception as e:
        _err(f'No se pudo conectar: {e}')
        sys.exit(1)

    # ── Tipo de perfiles ───────────────────────────────────────────────────
    _hdr('Tipo de perfiles a limpiar')
    tipo = _choose('¿Qué perfiles quieres borrar?', [
        ('a', 'Individuales  (alumno1, alumno2, ...)'),
        ('e', 'Equipos       (equipo1_m1, equipo1_m2, ...)'),
        ('x', 'Ambos tipos'),
    ])

    to_delete = []

    if tipo in ('a', 'x'):
        _hdr('Perfiles individuales')
        alumnos = list_alumnos(opn)
        if not alumnos:
            _info('No hay perfiles alumnoN en este servidor')
        else:
            to_delete.extend(pick_alumnos(alumnos))

    if tipo in ('e', 'x'):
        _hdr('Perfiles de equipos')
        equipo_peers = list_equipo_peers(opn)
        if not equipo_peers:
            _info('No hay perfiles equipoN_mN en este servidor')
        else:
            teams = group_by_team(equipo_peers)
            to_delete.extend(pick_teams(teams))

    if not to_delete:
        print(f'\n{BOLD}Nada que borrar. Saliendo.{RST}\n')
        return

    # ── Confirmar y borrar ─────────────────────────────────────────────────
    _hdr('Confirmar borrado')
    if not confirm_delete(to_delete):
        print(f'\n  Operación cancelada.\n')
        return

    _hdr('Borrando peers')
    delete_peers(opn, to_delete, args.dry_run)

    if not args.dry_run:
        print('\n  ⚙️  Reconfigurando WireGuard...')
        opn.reconfigure()

    _ok(f'{len(to_delete)} perfiles eliminados')
    print(f'\n{BOLD}✅ LIMPIEZA COMPLETADA{RST}\n')


if __name__ == '__main__':
    main()
