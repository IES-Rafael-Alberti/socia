#!/usr/bin/env python3
"""
Render a guide HTML to PDF using weasyprint.

Usage:
  python render.py <input.html> <output.pdf>

The input HTML must reference images via relative paths (images/*.png and
assets/*.png). weasyprint resolves them relative to the HTML file.
"""
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        print("Usage: python render.py <input.html> <output.pdf>", file=sys.stderr)
        sys.exit(2)

    html_path = Path(sys.argv[1]).resolve()
    pdf_path = Path(sys.argv[2]).resolve()

    if not html_path.exists():
        print(f"Input HTML not found: {html_path}", file=sys.stderr)
        sys.exit(1)

    try:
        from weasyprint import HTML
    except ImportError:
        print("weasyprint is not installed. Run:", file=sys.stderr)
        print("  pip install weasyprint --break-system-packages", file=sys.stderr)
        sys.exit(1)

    # base_url ensures relative paths in <img src="..."> resolve correctly
    HTML(filename=str(html_path), base_url=str(html_path.parent)).write_pdf(str(pdf_path))
    size_mb = pdf_path.stat().st_size / (1024 * 1024)
    print(f"OK -> {pdf_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
