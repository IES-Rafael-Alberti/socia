---
name: guide-generator
description: >
  Generate illustrated step-by-step PDF guides for SOC cybersecurity cases from MENTORA recording data
  (activity-log.json, network-log.json, metadata.json, screenshots). Produces a polished document
  branded for the educational centre that owns the recording — cover, table of contents, phases,
  step-by-step instructions with screenshots, notes, summary table, and credits.
  Use this skill whenever the user asks to "generar una guía", "crear guía paso a paso",
  "convertir grabación en guía", "PDF didáctico", "documentación del caso", "material didáctico",
  or provides a MENTORA ZIP / recording folder and wants a shareable document for students.
---

# Guide Generator for MENTORA recordings

You generate illustrated step-by-step PDF guides for cybersecurity students, using the data recorded by MENTORA as the source of truth. The output is a polished document branded for an educational centre, ready to share with students and for inclusion in didactic material.

When in doubt about tone, density, or layout, follow the structure described below — the result should look like a clean handout for a vocational training (FP) cybersecurity classroom.

## Input: a MENTORA recording

You receive either a MENTORA ZIP or its extracted folder. The folder contains:

| File | Content | Your use |
|---|---|---|
| `metadata.json` | Case title, start/end timestamps, duration, page list | Cover metadata, final credits |
| `activity-log.json` | Ordered array of DOM events (clicks, inputs, navigations, form submits) with timestamps and element text | Primary source for reconstructing *what the teacher did* |
| `activity-log-readable.txt` | Same as above but human-readable | Quick scan to get the narrative |
| `network-log.json` (optional) | Intercepted HTTP requests — use this to confirm which API calls happened | Useful for disambiguating "login" from other POSTs, and for tool detection by host |
| `screenshots/*.png` | One screenshot per significant action — usually many more than the final guide needs | Pick a curated subset (one per step) for the guide |
| `video.webm`, `transcription.srt` | Screen recording + audio transcript | Optional — use to fill gaps if the activity log is ambiguous |
| `README-FOR-LLM.md` | Teacher-provided hints about the case | Read first — sometimes has priority info |

## Output: a styled PDF

The PDF has this structure (in order):

1. **Full-bleed brand-coloured cover** with the brand's imago at top right, eyebrow ("<centre> · Ciberseguridad"), big title, subtitle, case subtitle, metadata block (alert, IPs, tools, date, duration), and MENTORA attribution footer.
2. **Context box** — a paragraph describing what the case is about.
3. **Table of contents** grouped by phase.
4. **Phase sections** — each begins with a brand-coloured phase header (FASE N | ROLE | Title), then sequential steps with text + screenshot + optional note.
5. **Summary table** — Fase / Rol / Herramienta / Acciones clave.
6. **Credit box** with the brand's sello and attribution text.

## Choosing the brand

The brand controls the colour palette, the cover eyebrow, the page footer and the credit text.

1. Look at the recording metadata, the README and the user's request to identify which centre owns the case.
2. Pick the brand id from `brands/`:
   - `ies-rafael-alberti` — IES Rafael Alberti (Cádiz). Default if no centre is mentioned.
   - `cifp-cuenca` — CIFP N.º 1 Cuenca.
   - …or any other directory present in `brands/`. New centres are added by dropping a folder following the same shape (see `brands/README.md`).
3. Read `brands/<id>/brand.json` — it has the palette, the eyebrow, the page footer string and the credit-box copy.
4. Use the two PNGs from that folder: `imago.png` (cover) and `sello.png` (credit box).

If the user explicitly asks for a brand that doesn't exist, stop and ask — don't fall back silently.

## Step-by-step process

### 1. Inspect the recording

Open `metadata.json` to get the case title, date and duration. Scan `activity-log-readable.txt` (or the JSON) to build a mental model of the narrative: which tools were used, in what order, what happened at each stage.

If there's a `network-log.json`, scan the hosts that appear — each distinct host usually maps to one tool (172.17.33.104 → TheHive, 172.17.33.153 → Graylog, 172.17.33.103 → Malcolm, 172.17.33.1 → OPNsense, etc.).

### 2. Decide the phase structure

Group the recording into **phases**. Phase boundaries are natural when the teacher switches tools or roles (N1 → N2 handoff, or investigación → contención). Let the case decide how many there are — some cases are a single phase, others span the full incident response lifecycle. Each phase has:

- A title (e.g. "Triaje y creación del caso en TheHive")
- A role (e.g. "Analista N1" — MENTORA recordings often involve role changes, infer them from user context or README)
- A number (FASE 1, FASE 2, …)

A typical brute-force triage case fits in five phases (triage, investigation, packet analysis, containment, closure). A shorter case may need only one or two. Match the phases to what the teacher actually did, not to a target.

### 3. Decide the step list

Within each phase, identify **meaningful steps** — atomic actions that you can explain in one paragraph with one screenshot. Steps should:

- Have a verb-led title ("Localizar la alerta #311", "Ejecutar analyzers sobre la IP atacante")
- Be numbered sequentially across the whole guide (Paso 1 through Paso N — never restart per phase)
- Cover one concept each — if a single click performs several things, group them; if one "action" needs multiple screens to explain, split into sub-steps

The count per phase depends on what the teacher did — a login phase may have two or three steps, a detailed triage may have ten. Don't pad short cases with filler, don't compress long ones to hit a number.

### 4. Curate the screenshots

This is the most delicate part. **Read `references/screenshot-curation.md` before doing this step.** Key ideas:

- Many recorded screenshots → one per meaningful step in the guide (the right count depends on the case, not on a target)
- Pick the screenshot that best shows the *completed* state of each step
- Verify each image matches its caption — tool swaps (Malcolm vs. Arkime, TheHive vs. Graylog) are the most common mistake
- Copy chosen screenshots to a local `images/` folder with clear names

### 5. Write the pedagogical text

Each step has:

- **Heading** (`<h3>`): "Paso N. Verb-led title"
- **1–3 paragraphs** in Spanish explaining what to do, the specific values (IPs, tags, severidad), and why if it's non-obvious
- **One figure** with caption
- **Optional `.note-box`** to add pedagogical context the student should know ("if there had been successful logins, escalate to HIGH")

Tone: second person plural is fine but a typical guide uses impersonal infinitive ("Abrir el navegador", "Completar el formulario") — stay consistent within a guide. Use `<b>` for field names, button labels, and specific values. Use `<code>` for query strings and filter expressions.

### 6. Fill the HTML template

Use `assets/template.html` as the starting point. It already wires the brand override (CSS custom properties at the top of the inlined `<style>`) and references the brand logos as `assets/imago.png` / `assets/sello.png`.

You substitute two kinds of placeholders:

**Case-specific** (always replaced from the recording):

| Placeholder | Source |
|---|---|
| `{{INLINE_CSS}}` | Full content of `assets/styles.css`, pasted verbatim |
| `{{CASE_TITLE}}`, `{{COVER_TITLE}}`, `{{COVER_SUBTITLE_1}}`, `{{COVER_SUBTITLE_2}}` | Case title and subtitles inferred from `metadata.json` and the recording |
| `{{COVER_META_LINES}}` | HTML of `<b>Label:</b> value` lines separated by `·` and `<br>` (alert ref, IPs, tools, date, duration) |
| `{{CASE_CONTEXT}}` | One-paragraph context |
| `{{PHASE_*}}`, `{{STEP_*}}`, `{{N}}`, `{{ROLE}}`, `{{TOOL}}`, `{{ACTIONS}}`, `{{CONCLUSION}}`, `{{RECORDING_DATE}}`, `{{DURATION}}`, `{{STEP_COUNT}}` | Each phase / step / summary row, repeated as needed |

**Brand-specific** (replaced from `brands/<id>/brand.json`):

| Placeholder | Source field |
|---|---|
| `{{BRAND_PRIMARY}}`, `{{BRAND_PRIMARY_DARK}}`, `{{BRAND_TINT}}`, `{{BRAND_DARK}}`, `{{BRAND_MUTED}}`, `{{BRAND_BORDER}}` | `palette.*` (hex strings, ready to inline as CSS values) |
| `{{BRAND_PAGE_FOOTER}}` | `copy.pageFooter` |
| `{{BRAND_EYEBROW}}` | `name.eyebrow` |
| `{{BRAND_NAME_SHORT}}` | `name.short` |
| `{{BRAND_GUIDE_CREDIT_BOX}}` | `copy.guideCreditBox` (used in cover footer AND credit box at the end) |

Then copy `brands/<id>/imago.png` → `output/assets/imago.png` and `brands/<id>/sello.png` → `output/assets/sello.png`.

### 7. Render to PDF

Use the bundled script:

```bash
pip install weasyprint --break-system-packages --quiet
python3 <skill-path>/assets/render.py <your-guide>.html <output>.pdf
```

Or inline:

```python
from weasyprint import HTML
HTML(filename="guia.html", base_url="guia-rebuild/").write_pdf("output.pdf")
```

`base_url` must point to the folder containing the HTML so that `images/` and `assets/` paths resolve.

### 8. Verify

Read the produced PDF (`Read` tool with `pages: "1"`, then a middle page, then the last) and check:

- Cover renders correctly — brand-coloured background, white text, imago at top right, metadata block visible
- Phase headers show coloured block + tinted info panel, no text overflow
- Every figure has its caption and the content visually matches the step it belongs to
- Summary table on the last page, credit box with sello, footer with recording date
- Page numbers at bottom right, brand `pageFooter` text at bottom left (from page 2 onward)

## File naming

Output filename format: `guia-caso-<brief-case-description>.pdf` (lowercase, kebab-case). Example: `guia-caso-brute-force-ssh.pdf`, `guia-caso-phishing-banco.pdf`.

## Common pitfalls

- **Swapped screenshots** for similar-looking screens (Malcolm/Arkime, Graylog dashboard views). Always verify visually.
- **Including too many screenshots**: raw MENTORA output has far more images than the guide should show. Curate ruthlessly — one per meaningful step.
- **Forgetting `base_url`** in weasyprint: images will 404 silently and the PDF will have empty figures.
- **Hardcoding colours or strings** instead of using the `{{BRAND_*}}` placeholders: the document loses its brand identity. Always read the brand from `brands/<id>/brand.json` and substitute every `{{BRAND_*}}` token before rendering.
- **Forgetting to copy the brand's PNGs**: the template references `assets/imago.png` and `assets/sello.png` — if you forget to copy them from `brands/<id>/`, the cover and credit box will have broken images.
- **Writing captions that describe the action, not the image**: captions must say what's visible.

## Delivery

Save the final PDF to the user's working folder. Mention briefly:
- Brand applied (so the user can confirm it matches their centre)
- Number of phases and steps in the guide
- Total duration from the recording metadata
- Link using `computer://` format
