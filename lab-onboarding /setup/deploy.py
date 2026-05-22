#!/usr/bin/env python3
"""
deploy.py  —  Despliega el sistema completo en Google
=======================================================
Qué hace:
  1. Lee slots_vpn.csv e inyecta los datos en Bootstrap.gs
  2. Crea el proyecto Apps Script (clasp create) si no existe
  3. Sube todos los .gs (clasp push)
  4. Abre el navegador para que ejecutes setup() manualmente

Requisitos:
  - clasp autenticado: ejecuta  ! clasp login  primero
  - slots_vpn.csv generado por setup_opnsense.py

Uso:
  python3 deploy.py
"""

import csv, json, os, subprocess, sys, webbrowser, re

BASE   = os.path.dirname(os.path.abspath(__file__))
ROOT   = os.path.join(BASE, '..')
SCRIPT = os.path.join(ROOT, 'apps-script')
CSV    = os.path.join(BASE, 'slots_vpn.csv')
CLASP  = os.path.join(ROOT, '.clasp.json')
INFRA_MD = os.path.join(ROOT, 'instrucciones', 'infraestructura.md')

def run(cmd, cwd=None, capture=True):
    r = subprocess.run(cmd, shell=True, cwd=cwd or ROOT,
                       capture_output=capture, text=True)
    return r.stdout.strip(), r.stderr.strip(), r.returncode

def check_clasp_auth():
    rc_path = os.path.expanduser('~/.clasprc.json')
    if not os.path.exists(rc_path):
        print('❌ clasp no autenticado.')
        print('   Ejecuta primero:  ! clasp login')
        sys.exit(1)
    print('✅ clasp autenticado')

def inject_csv_into_bootstrap():
    """Lee el CSV, sustituye SLOTS_DATA en Bootstrap.gs y devuelve el contenido original."""
    bootstrap = os.path.join(SCRIPT, 'Bootstrap.gs')
    with open(CSV, newline='', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))

    js_rows = []
    for r in rows:
        conf_escaped = (r['conf']
                        .replace('\\', '\\\\')
                        .replace('"', '\\"')
                        .replace('\n', '\\n')
                        .replace('\r', ''))
        js_rows.append(
            f'  ["{r["slot"]}","{r["ip"]}","{r["privkey"]}",'
            f'"{r["pubkey"]}","{r["psk"]}","{conf_escaped}","{r["uuid"]}"]'
        )

    slots_js = 'var SLOTS_DATA = [\n' + ',\n'.join(js_rows) + '\n];'

    with open(bootstrap, 'r', encoding='utf-8') as f:
        original = f.read()

    content = re.sub(
        r'var SLOTS_DATA = \[.*?\];',
        lambda m: slots_js,
        original,
        flags=re.DOTALL
    )

    with open(bootstrap, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f'✅ {len(rows)} slots inyectados en Bootstrap.gs')
    return original  # para restaurar después del push

def inject_infra_html():
    """Convierte infraestructura.md a HTML e inyecta en Config.gs → INFRA_HTML."""
    try:
        import markdown as md_lib
    except ImportError:
        print('  ⚠️  Instala markdown:  pip install markdown  — INFRA_HTML no actualizado')
        return

    if not os.path.exists(INFRA_MD):
        print('  ⚠️  instrucciones/infraestructura.md no encontrado — INFRA_HTML no actualizado')
        return

    with open(INFRA_MD, encoding='utf-8') as f:
        md_content = f.read()

    raw_html = md_lib.markdown(md_content, extensions=['tables'])

    # Aplicar estilos inline compatibles con clientes de email
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

    config_path = os.path.join(SCRIPT, 'Config.gs')
    with open(config_path, encoding='utf-8') as f:
        config = f.read()

    new_config = re.sub(
        r'(INFRA_HTML:\s*`).*?(`)',
        lambda m: m.group(1) + '\n    ' + final_html + '\n  ' + m.group(2),
        config,
        flags=re.DOTALL
    )

    with open(config_path, 'w', encoding='utf-8') as f:
        f.write(new_config)

    print('✅ INFRA_HTML actualizado desde infraestructura.md')

def restore_bootstrap(original_content):
    """Restaura Bootstrap.gs al placeholder limpio (sin claves reales)."""
    bootstrap = os.path.join(SCRIPT, 'Bootstrap.gs')
    with open(bootstrap, 'w', encoding='utf-8') as f:
        f.write(original_content)
    print('✅ Bootstrap.gs restaurado (claves no quedan en el repo)')

def create_or_load_project():
    """Crea el proyecto clasp si no existe, o carga el existente"""
    if os.path.exists(CLASP):
        with open(CLASP) as f:
            d = json.load(f)
        print(f'✅ Proyecto existente: {d.get("scriptId","")}')
        return d.get('scriptId', '')

    print('📦 Creando proyecto Apps Script...')
    # Crear spreadsheet primero, luego asociar el script a él
    out, err, rc = run(
        'clasp create --type sheets --title "VPN Jornadas SOCIA" --rootDir apps-script',
        cwd=ROOT
    )
    print(out or err)

    if os.path.exists(CLASP):
        with open(CLASP) as f:
            d = json.load(f)
        return d.get('scriptId', '')
    return ''

def push_code():
    print('🚀 Subiendo código con clasp push...')
    out, err, rc = run('clasp push --force', cwd=ROOT)
    if rc != 0:
        print(f'❌ Error en clasp push:\n{err}')
        sys.exit(1)
    print(out or '✅ Código subido correctamente')

def open_script():
    out, err, rc = run('clasp open', cwd=ROOT)
    print('\n📋 Apps Script abierto en el navegador.')
    print('   ➡️  Selecciona la función "setup" y pulsa ▶️ Run')
    print('   ➡️  Acepta los permisos que te pida Google')
    print('   ➡️  Cuando termine, mira el Log para obtener la URL del Form')

def main():
    print('╔══════════════════════════════════════════════════╗')
    print('║  DEPLOY — Jornadas Formativas SOCIA              ║')
    print('╚══════════════════════════════════════════════════╝\n')

    check_clasp_auth()

    if not os.path.exists(CSV):
        print(f'❌ No se encuentra {CSV}')
        print('   Ejecuta primero: python3 setup_opnsense.py')
        sys.exit(1)

    original = inject_csv_into_bootstrap()
    inject_infra_html()
    create_or_load_project()
    push_code()
    restore_bootstrap(original)
    open_script()

    print('\n✅ DEPLOY COMPLETADO')
    print('   Último paso manual: ejecutar setup() en el editor de Apps Script\n')

if __name__ == '__main__':
    main()
