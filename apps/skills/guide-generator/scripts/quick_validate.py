#!/usr/bin/env python3
"""Comprueba la estructura básica de un PDF y, si se pide, renderiza sus páginas."""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path


def command(name: str) -> str:
    result = shutil.which(name)
    if not result:
        raise RuntimeError(f"No se encuentra el comando requerido: {name}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--expect-text", action="append", default=[])
    parser.add_argument("--render-dir", type=Path)
    args = parser.parse_args()
    if not args.pdf.is_file() or args.pdf.stat().st_size < 10_000:
        print("El PDF no existe o está vacío", file=sys.stderr)
        return 1
    try:
        info = subprocess.run([command("pdfinfo"), str(args.pdf)], check=True, text=True, capture_output=True).stdout
        pages_match = re.search(r"^Pages:\s+(\d+)", info, re.MULTILINE)
        pages = int(pages_match.group(1)) if pages_match else 0
        text = subprocess.run([command("pdftotext"), str(args.pdf), "-"], check=True, text=True, capture_output=True).stdout
        errors = []
        if pages < 2:
            errors.append("el documento tiene menos de dos páginas")
        if re.search(r"{{[A-Z0-9_]+}}", text):
            errors.append("quedan marcadores sin sustituir")
        for expected in args.expect_text:
            if expected.casefold() not in text.casefold():
                errors.append(f"falta el texto esperado: {expected}")
        if args.render_dir:
            args.render_dir.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                [command("pdftoppm"), "-png", "-r", "120", str(args.pdf), str(args.render_dir / "pagina")],
                check=True,
            )
            rendered = list(args.render_dir.glob("pagina-*.png"))
            if len(rendered) != pages:
                errors.append(f"se renderizaron {len(rendered)} de {pages} páginas")
        if errors:
            print("Error: " + "; ".join(errors), file=sys.stderr)
            return 1
        print(f"PDF válido: {pages} páginas, {len(text.split())} palabras")
        return 0
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
