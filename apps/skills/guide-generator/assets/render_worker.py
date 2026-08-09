#!/usr/bin/env python3
"""Proceso aislado que importa WeasyPrint y registra la paginación."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from weasyprint import HTML


def element_pages(document) -> dict[str, int]:
    pages: dict[str, int] = {}
    for page_number, page in enumerate(document.pages, start=1):
        for box in page._page_box.descendants():
            element = getattr(box, "element", None)
            element_id = element.get("id") if element is not None else None
            if element_id and element_id not in pages:
                pages[element_id] = page_number
    return pages


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_html", type=Path)
    parser.add_argument("output_pdf", type=Path)
    parser.add_argument("--probe", type=Path)
    args = parser.parse_args()

    html_path = args.input_html.resolve()
    document = HTML(filename=str(html_path), base_url=str(html_path.parent)).render()
    args.output_pdf.parent.mkdir(parents=True, exist_ok=True)
    document.write_pdf(str(args.output_pdf))
    if args.probe:
        result = {"pageCount": len(document.pages), "elements": element_pages(document)}
        args.probe.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
