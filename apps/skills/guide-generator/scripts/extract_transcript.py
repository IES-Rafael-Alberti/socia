#!/usr/bin/env python3
"""Convierte transcription.json en texto legible con marcas de tiempo."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    minutes, seconds = divmod(total, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"


def extract(path: Path, start: float = 0, end: float | None = None) -> str:
    data = json.loads(path.read_text(encoding="utf-8"))
    lines: list[str] = []
    for segment in data.get("segments", []):
        segment_start = float(segment.get("start", 0))
        segment_end = float(segment.get("end", segment_start))
        if segment_end < start or (end is not None and segment_start > end):
            continue
        text = re.sub(r"\s+", " ", str(segment.get("text", ""))).strip()
        if text:
            lines.append(f"[{timestamp(segment_start)}-{timestamp(segment_end)}] {text}")
    return "\n".join(lines) + ("\n" if lines else "")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("transcription", type=Path)
    parser.add_argument("--from-second", type=float, default=0)
    parser.add_argument("--to-second", type=float)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = extract(args.transcription, args.from_second, args.to_second)
    if args.output:
        args.output.write_text(result, encoding="utf-8")
    else:
        print(result, end="")


if __name__ == "__main__":
    main()
