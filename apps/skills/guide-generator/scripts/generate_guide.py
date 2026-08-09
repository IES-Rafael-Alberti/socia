#!/usr/bin/env python3
"""Genera una guía PDF desde una grabación MENTORA y un guion JSON."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any


SKILL_ROOT = Path(__file__).resolve().parents[1]
PLACEHOLDER = re.compile(r"{{[A-Z0-9_]+}}")


def format_duration(milliseconds: int | float) -> str:
    seconds = max(0, int(float(milliseconds) / 1000))
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"


def active_duration(metadata: dict[str, Any]) -> tuple[str, str, str | None]:
    capture = metadata.get("videoCapture") or {}
    active_ms = capture.get("activeDurationMs")
    if isinstance(active_ms, (int, float)) and active_ms >= 0:
        return format_duration(active_ms), "videoCapture.activeDurationMs", None
    video_duration = metadata.get("videoDuration")
    if isinstance(video_duration, str) and re.fullmatch(r"(?:\d+:)?\d{1,2}:\d{2}", video_duration):
        return video_duration, "videoDuration", None
    total = metadata.get("duration")
    paused = capture.get("pausedDurationMs", metadata.get("pausedDurationMs"))
    if isinstance(total, (int, float)) and isinstance(paused, (int, float)):
        return format_duration(max(0, total - paused)), "duration - pausedDurationMs", None
    if isinstance(total, (int, float)):
        warning = "No consta el tiempo pausado; la duración puede incluir pausas."
        return format_duration(total), "duration", warning
    raise ValueError("metadata.json no contiene una duración válida")


def safe_extract(archive: Path, target: Path) -> None:
    root = target.resolve()
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            destination = (target / member.filename).resolve()
            if destination != root and root not in destination.parents:
                raise ValueError(f"Ruta no segura en el ZIP: {member.filename}")
        source.extractall(target)


def find_recording_root(path: Path, extraction: Path) -> Path:
    if path.is_file():
        if not zipfile.is_zipfile(path):
            raise ValueError(f"El archivo no es un ZIP válido: {path}")
        safe_extract(path, extraction)
        candidates = list(extraction.rglob("metadata.json"))
    elif path.is_dir():
        candidates = [path / "metadata.json"] if (path / "metadata.json").is_file() else list(path.rglob("metadata.json"))
    else:
        raise FileNotFoundError(f"No existe la grabación: {path}")
    if len(candidates) != 1:
        raise ValueError(f"Se esperaba un metadata.json y se encontraron {len(candidates)}")
    return candidates[0].parent.resolve()


def read_content(path: str) -> dict[str, Any]:
    raw = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    content = json.loads(raw)
    required = ("caseTitle", "coverTitle", "context", "phases", "conclusion")
    missing = [key for key in required if not content.get(key)]
    if missing:
        raise ValueError(f"Faltan campos del guion: {', '.join(missing)}")
    if not all(phase.get("steps") for phase in content["phases"]):
        raise ValueError("Cada fase debe contener al menos un paso")
    for phase_number, phase in enumerate(content["phases"], start=1):
        if not phase.get("title"):
            raise ValueError(f"La fase {phase_number} no tiene título")
        for step_number, step in enumerate(phase["steps"], start=1):
            if not step.get("title") or not step.get("body"):
                raise ValueError(
                    f"El paso {step_number} de la fase {phase_number} necesita title y body"
                )
    return content


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def resolve_inside(root: Path, relative: str) -> Path:
    result = (root / relative).resolve()
    if result != root and root not in result.parents:
        raise ValueError(f"La imagen sale de la grabación: {relative}")
    if not result.is_file():
        raise FileNotFoundError(f"No existe la imagen: {relative}")
    return result


def run_ffmpeg(arguments: list[str]) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("Se necesita ffmpeg para extraer o recortar esta figura")
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *arguments], check=True)


def prepare_figure(step: dict[str, Any], recording: Path, images: Path, number: int) -> dict[str, str] | None:
    figure = step.get("figure")
    if not figure:
        return None
    suffix = Path(figure.get("source", "frame.png")).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        suffix = ".png"
    filename = f"paso-{number:02d}{suffix}"
    target = images / filename
    if figure.get("videoTime"):
        video = resolve_inside(recording, figure.get("video", "video.mp4"))
        run_ffmpeg(["-ss", str(figure["videoTime"]), "-i", str(video), "-frames:v", "1", str(target)])
    else:
        source = resolve_inside(recording, figure["source"])
        shutil.copy2(source, target)
    if figure.get("crop"):
        cropped = target.with_name(f"{target.stem}-crop{target.suffix}")
        run_ffmpeg(["-i", str(target), "-vf", f"crop={figure['crop']}", str(cropped)])
        cropped.replace(target)
    result = {"filename": filename, "caption": figure.get("caption", "")}
    if max_height := figure.get("maxHeight"):
        if not re.fullmatch(r"\d+(?:\.\d+)?(?:px|mm|cm)", str(max_height)):
            raise ValueError(f"maxHeight no válido en el paso {number}: {max_height}")
        result["maxHeight"] = str(max_height)
    return result


def build_toc(phases: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    number = 0
    for phase_index, phase in enumerate(phases, start=1):
        steps: list[str] = []
        for step in phase["steps"]:
            number += 1
            steps.append(f'<div class="step">Paso {number}. {esc(step["title"])}</div>')
        blocks.append(
            '<div class="toc-phase">'
            f'<div class="phase-title">Fase {phase_index}. {esc(phase["title"])}</div>'
            f'{"".join(steps)}</div>'
        )
    return "".join(blocks)


def body_html(value: str | list[str]) -> str:
    if isinstance(value, str):
        return value if re.search(r"<(?:p|ul|ol|div)\b", value) else f"<p>{value}</p>"
    if isinstance(value, list) and value and all(isinstance(item, str) for item in value):
        return "".join(f"<p>{item}</p>" for item in value if item)
    raise ValueError("body debe ser un texto o una lista de párrafos")


def content_quality_warnings(content: dict[str, Any]) -> list[str]:
    serialized = json.dumps(content, ensure_ascii=False).casefold()
    warnings: list[str] = []
    repeated_case = serialized.count("en este caso")
    if repeated_case > 2:
        warnings.append(
            f"La fórmula 'En este caso' aparece {repeated_case} veces; integrar los datos en la narración."
        )
    subtitle = str(content.get("caseSubtitle", "")).casefold()
    if re.search(r"caso\s*#?\s*\d+|aplicable a (?:casos|alertas) similares", subtitle):
        warnings.append("El segundo subtítulo de portada parece contener un identificador interno o texto genérico.")
    for number, phase in enumerate(content.get("phases", []), start=1):
        if not phase.get("introduction") and not phase.get("objective"):
            warnings.append(f"La fase {number} no introduce la herramienta ni la pregunta que intenta resolver.")
        if not phase.get("transcriptRefs"):
            warnings.append(f"La fase {number} no indica qué parte de la transcripción sustenta su explicación.")
        for step_number, step in enumerate(phase.get("steps", []), start=1):
            if not step.get("transcriptRefs"):
                warnings.append(
                    f"El paso {step_number} de la fase {number} no tiene referencias a la transcripción."
                )
    return warnings


def build_step(step: dict[str, Any], number: int, figure: dict[str, str] | None) -> str:
    if not step.get("title") or not step.get("body"):
        raise ValueError(f"El paso {number} necesita title y body")
    objective = (
        f'<p class="step-purpose"><b>Objetivo:</b> {step["objective"]}</p>'
        if step.get("objective") else ""
    )
    result = (
        f'<div class="result-box"><p><b>Resultado:</b> {step["result"]}</p></div>'
        if step.get("result") else ""
    )
    conditional = ""
    if rule := step.get("conditional"):
        conditional = (
            '<div class="conditional-box"><h4>Decisión condicional</h4>'
            f'<p><b>Si {rule["condition"]}:</b> {rule["whenTrue"]}</p>'
            f'<p><b>Si no:</b> {rule["whenFalse"]}</p></div>'
        )
    note = f'<div class="note-box"><p><b>Nota:</b> {step["note"]}</p></div>' if step.get("note") else ""
    evidence = f'<p><b>Evidencia que conviene guardar:</b> {step["evidence"]}</p>' if step.get("evidence") else ""
    figure_html = ""
    if figure:
        style = f' style="max-height:{esc(figure["maxHeight"])}"' if figure.get("maxHeight") else ""
        figure_html = (
            f'<figure><img src="images/{esc(figure["filename"])}" alt=""{style}>'
            f'<figcaption>{esc(figure["caption"])}</figcaption></figure>'
        )
    return (
        '<section class="guide-step">'
        f'<h3>Paso {number}. {esc(step["title"])}</h3>'
        f'{objective}<div class="step-body">{body_html(step["body"])}</div>'
        f'{result}{conditional}{evidence}{note}{figure_html}'
        '</section>'
    )


def build_phases(content: dict[str, Any], recording: Path, images: Path) -> tuple[str, str, int]:
    sections: list[str] = []
    rows: list[str] = []
    number = 0
    for phase_index, phase in enumerate(content["phases"], start=1):
        role = esc(phase.get("role", ""))
        phase_introduction = phase.get("introduction", phase.get("objective"))
        phase_intro_html = (
            f'<div class="phase-objective">{phase_introduction}</div>'
            if phase_introduction else ""
        )
        sections.append(
            '<section class="phase">'
            '<div class="phase-header">'
            f'<div class="phase-num">FASE {phase_index}</div>'
            '<div class="phase-info">'
            f'<div class="phase-role">{role}</div>'
            f'<div class="phase-title">{esc(phase["title"])}</div></div></div>'
            f'{phase_intro_html}'
        )
        for step in phase["steps"]:
            number += 1
            figure = prepare_figure(step, recording, images, number)
            sections.append(build_step(step, number, figure))
        sections.append("</section>")
        rows.append(
            f'<tr><td>{phase_index}</td><td>{role or "—"}</td>'
            f'<td>{esc(phase.get("tool", "—"))}</td>'
            f'<td>{phase.get("summary", phase["title"])}</td></tr>'
        )
    return "".join(sections), "".join(rows), number


def fill_template(
    content: dict[str, Any], brand: dict[str, Any], duration: str, phases_html: str,
    summary_rows: str, step_count: int, toc_class: str,
) -> str:
    template = (SKILL_ROOT / "assets" / "template.html").read_text(encoding="utf-8")
    css = (SKILL_ROOT / "assets" / "styles.css").read_text(encoding="utf-8")
    palette = brand["palette"]
    copy = brand["copy"]
    objectives_section = ""
    if content.get("learningObjectives"):
        objectives = "<ul>" + "".join(f"<li>{item}</li>" for item in content["learningObjectives"]) + "</ul>"
        objectives_section = f'<div class="objectives-box"><h2>Objetivos de aprendizaje</h2>{objectives}</div>'
    meta_lines = content.get("coverMeta", []) + [f"<b>Tiempo activo:</b> {esc(duration)}"]
    values = {
        "INLINE_CSS": css,
        "BRAND_PRIMARY": palette["primary"], "BRAND_PRIMARY_DARK": palette["primaryDark"],
        "BRAND_TINT": palette["tint"], "BRAND_DARK": palette["dark"],
        "BRAND_MUTED": palette["muted"], "BRAND_BORDER": palette["border"],
        "BRAND_PAGE_FOOTER": esc(copy["pageFooter"]), "BRAND_EYEBROW": esc(brand["name"]["eyebrow"]),
        "BRAND_NAME_SHORT": esc(brand["name"]["short"]),
        "BRAND_GUIDE_CREDIT_BOX": esc(copy["guideCreditBox"]),
        "CASE_TITLE": esc(content["caseTitle"]), "COVER_TITLE": esc(content["coverTitle"]),
        "COVER_SUBTITLE_1": esc(content.get("coverSubtitle", "Guía práctica")),
        "COVER_CASE_SUBTITLE": (
            f'<div class="case-subtitle">{esc(content["caseSubtitle"])}</div>'
            if content.get("caseSubtitle") else ""
        ),
        "COVER_META_LINES": "<br>".join(meta_lines), "CASE_CONTEXT": content["context"],
        "OBJECTIVES_SECTION": objectives_section,
        "TOC_CLASS": toc_class,
        "TOC_CONTENT": build_toc(content["phases"]), "PHASES_CONTENT": phases_html,
        "SUMMARY_ROWS": summary_rows, "CONCLUSION": content["conclusion"],
        "RECORDING_DATE": esc(content.get("recordingDate", "fecha no indicada")),
        "DURATION": esc(duration), "STEP_COUNT": str(step_count),
    }
    for name, value in values.items():
        template = template.replace("{{" + name + "}}", value)
    unresolved = PLACEHOLDER.findall(template)
    if unresolved:
        raise ValueError(f"Quedan marcadores sin resolver: {', '.join(sorted(set(unresolved)))}")
    return template


def toc_needs_new_page(probe: dict[str, Any]) -> bool:
    elements = probe.get("elements", {})
    context_page = elements.get("context-start")
    toc_start = elements.get("toc-start")
    toc_end = elements.get("toc-end")
    return bool(context_page and toc_start == context_page and toc_end and toc_end > toc_start)


def render(html_path: Path, pdf_path: Path, probe_path: Path) -> None:
    script = SKILL_ROOT / "assets" / "render.py"
    subprocess.run([sys.executable, str(script), str(html_path), str(pdf_path), "--probe", str(probe_path)], check=True)


def generate(recording_input: Path, content: dict[str, Any], brand_id: str, output: Path, keep: bool) -> dict[str, Any]:
    brand_dir = SKILL_ROOT / "brands" / brand_id
    if not (brand_dir / "brand.json").is_file():
        raise ValueError(f"No existe la marca '{brand_id}'")
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=".guide-build-", dir=output.parent))
    succeeded = False
    try:
        recording = find_recording_root(recording_input.resolve(), work / "recording")
        metadata = json.loads((recording / "metadata.json").read_text(encoding="utf-8"))
        duration, duration_source, warning = active_duration(metadata)
        brand = json.loads((brand_dir / "brand.json").read_text(encoding="utf-8"))
        build = work / "document"
        images = build / "images"
        assets = build / "assets"
        images.mkdir(parents=True)
        assets.mkdir()
        shutil.copy2(brand_dir / "imago.png", assets / "imago.png")
        shutil.copy2(brand_dir / "sello.png", assets / "sello.png")
        phases_html, summary_rows, step_count = build_phases(content, recording, images)
        html_path = build / "guide.html"
        draft_pdf = work / "draft.pdf"
        probe_path = work / "probe.json"
        html_path.write_text(
            fill_template(content, brand, duration, phases_html, summary_rows, step_count, ""),
            encoding="utf-8",
        )
        render(html_path, draft_pdf, probe_path)
        probe = json.loads(probe_path.read_text(encoding="utf-8"))
        toc_moved = toc_needs_new_page(probe)
        if toc_moved:
            html_path.write_text(
                fill_template(content, brand, duration, phases_html, summary_rows, step_count, "toc-new-page"),
                encoding="utf-8",
            )
            render(html_path, draft_pdf, probe_path)
            probe = json.loads(probe_path.read_text(encoding="utf-8"))
        os.replace(draft_pdf, output)
        succeeded = True
        return {
            "output": str(output), "brand": brand_id, "phases": len(content["phases"]),
            "steps": step_count, "duration": duration, "durationSource": duration_source,
            "durationWarning": warning, "tocMoved": toc_moved, "pages": probe.get("pageCount"),
            "contentWarnings": content_quality_warnings(content),
            "workdir": str(work) if keep else None,
        }
    finally:
        if not keep:
            shutil.rmtree(work, ignore_errors=True)
        elif not succeeded:
            print(f"Directorio de diagnóstico conservado: {work}", file=sys.stderr)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recording", required=True, type=Path, help="ZIP o carpeta MENTORA")
    parser.add_argument("--content", required=True, help="Guion JSON o - para leerlo de stdin")
    parser.add_argument("--brand", required=True, help="Identificador de brands/")
    parser.add_argument("--output", required=True, type=Path, help="PDF final")
    parser.add_argument("--keep-workdir", action="store_true", help="Conserva HTML, imágenes y pruebas")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = generate(args.recording, read_content(args.content), args.brand, args.output, args.keep_workdir)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
