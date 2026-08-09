#!/usr/bin/env python3
"""Renderiza HTML con WeasyPrint sin modificar el Python del sistema."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


WEASYPRINT_VERSION = "69.0"


def macos_library_dirs() -> list[Path]:
    """Devuelve rutas que pueden contener las bibliotecas nativas de WeasyPrint."""
    candidates = [Path("/opt/homebrew/lib"), Path("/usr/local/lib")]
    return [
        path
        for path in candidates
        if any(path.glob("libgobject-2.0.*")) and any(path.glob("libpango-1.0.*"))
    ]


def renderer_environment(base: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(base or os.environ)
    if sys.platform != "darwin":
        return env
    found = [str(path) for path in macos_library_dirs()]
    if not found:
        return env
    for name in ("DYLD_FALLBACK_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
        current = env.get(name)
        env[name] = os.pathsep.join(found + ([current] if current else []))
    return env


def render_commands(worker: Path, html_path: Path, pdf_path: Path, probe: Path | None) -> list[list[str]]:
    args = [str(worker), str(html_path), str(pdf_path)]
    if probe:
        args += ["--probe", str(probe)]
    commands = [[sys.executable, *args]]
    uv = shutil.which("uv")
    if uv:
        commands.append(
            [uv, "run", "--isolated", "--with", f"weasyprint=={WEASYPRINT_VERSION}", "python", *args]
        )
    return commands


def failure_help(errors: list[str]) -> str:
    detail = "\n\n".join(errors)
    native = ""
    if sys.platform == "darwin" and not macos_library_dirs():
        native = (
            "\nNo se han encontrado Pango y GObject. Instálalos con "
            "`brew install pango` y vuelve a ejecutar el comando."
        )
    uv_hint = "" if shutil.which("uv") else "\nInstala uv desde https://docs.astral.sh/uv/."
    return f"No se pudo iniciar WeasyPrint.{native}{uv_hint}\n\nDetalle:\n{detail}"


def render_html(html_path: Path, pdf_path: Path, probe: Path | None = None) -> None:
    html_path = html_path.resolve()
    pdf_path = pdf_path.resolve()
    worker = Path(__file__).with_name("render_worker.py")
    if not html_path.is_file():
        raise FileNotFoundError(f"No existe el HTML de entrada: {html_path}")
    errors: list[str] = []
    for command in render_commands(worker, html_path, pdf_path, probe):
        result = subprocess.run(
            command,
            env=renderer_environment(),
            text=True,
            capture_output=True,
        )
        if result.returncode == 0:
            return
        errors.append(f"$ {' '.join(command[:6])}\n{result.stderr.strip() or result.stdout.strip()}")
    raise RuntimeError(failure_help(errors))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_html", type=Path)
    parser.add_argument("output_pdf", type=Path)
    parser.add_argument("--probe", type=Path, help="JSON con la página de los elementos que tienen id")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        render_html(args.input_html, args.output_pdf, args.probe)
    except (FileNotFoundError, RuntimeError) as error:
        print(error, file=sys.stderr)
        return 1
    size_mb = args.output_pdf.stat().st_size / (1024 * 1024)
    extra = ""
    if args.probe and args.probe.exists():
        pages = json.loads(args.probe.read_text(encoding="utf-8")).get("pageCount")
        extra = f", {pages} páginas" if pages else ""
    print(f"PDF creado: {args.output_pdf.resolve()} ({size_mb:.1f} MB{extra})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
