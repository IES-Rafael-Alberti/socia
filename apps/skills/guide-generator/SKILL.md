---
name: guide-generator
description: >
  Generate illustrated, pedagogical PDF guides for SOC cases from MENTORA recordings. Use for requests to create a step-by-step guide, turn a recording into teaching material, or document a cybersecurity case with a supported brand.
---

# Guide Generator

Create a PDF that teaches a method through the recorded case. Treat MENTORA data as evidence, but do not reduce the guide to the teacher's clicks.

## Inputs

Accept a MENTORA ZIP or extracted folder. Read `README-FOR-LLM.md`, `metadata.json`, the action log, the transcript and its status, the network log when present, the screenshots, and a valid video when a result is not visible elsewhere.

MENTORA replaces secrets with `[REDACTED]`. Never recover or guess them. Check every selected image for visible secrets.

## Workflow

1. Check capture warnings, dropped events, transcript failures and video validity. State any unresolved gap.
2. Extract the timestamped transcript before reading the activity log:

   ```bash
   python3 scripts/extract_transcript.py <recording>/transcription.json --output <workdir>/transcript.txt
   ```

   Read it completely. Build notes that preserve the teacher's order, examples, explanations and way of addressing the class. Treat speech-recognition errors as text to resolve against the interface and actions, not as wording to copy.
3. Read [pedagogical-writing.md](references/pedagogical-writing.md). Turn the teacher's explanation into a textbook-style practical chapter. Only after the teaching outline is complete, use the activity log to confirm the sequence and exact values. Add `transcriptRefs` to every phase and step so the didactic text remains traceable to timestamps.
4. Read [screenshot-curation.md](references/screenshot-curation.md). Choose at most one figure per conceptual step. The image linked to a click may show the state before the click; inspect later screenshots or the video.
5. Choose an existing brand from `brands/`. If the requested brand does not exist, ask the user instead of changing it silently.
6. Run the generator:

   ```bash
   python3 scripts/generate_guide.py \
     --recording <recording.zip-or-folder> \
     --content <guide.json> \
     --brand <brand-id> \
     --output <guide.pdf>
   ```

   Use `--content -` to read JSON from standard input. Add `--keep-workdir` only while debugging. By default, the script removes extraction, frames, crops, HTML, draft PDFs and layout probes after it writes the final PDF.

   Require `contentWarnings` to be empty. Missing transcript references or repeated formulaic wording means the guide needs another writing pass.

7. Run `python3 scripts/quick_validate.py <guide.pdf> --expect-text <case term>`. Render every page with `pdftoppm` and inspect the full contact sheet. Check the cover, index, phase headers, figures, captions, summary, credits, footer and page numbers. Read the PDF as a student who has not seen the video: if it lists actions without explaining the tools, concepts, queries and decisions, rewrite the content.

## Duration

The cover and footer must show active recording time, without pauses. The generator resolves it in this order:

1. `metadata.videoCapture.activeDurationMs`;
2. `metadata.videoDuration`;
3. `metadata.duration - pausedDurationMs`;
4. `metadata.duration`, with a warning that it may include pauses.

Do not copy `metadata.duration` directly when pause data exists.

## Layout rules

The template tries to place context, learning objectives and index on the same page. It first renders a probe PDF. If the index starts beside the context but spills onto another page, the generator renders it again with the full index on a new page. A long index may span several pages, but each phase group stays together.

Phases follow changes in goal, role or tool. Steps follow concepts, not individual clicks. Number steps once across the whole guide. Do not require every phase or step to use every available block.

## WeasyPrint

`assets/render.py` first tries the current Python. If needed, it runs WeasyPrint 69 in an isolated `uv` environment. On macOS it detects Homebrew's Pango and GObject libraries and passes their paths to the child process. It does not use global `pip`, `sudo` or `--break-system-packages`.

If native libraries are missing on macOS, install them with `brew install pango`. If `uv` is missing, install it from its official instructions and rerun the generator.

## JSON shape

Top-level fields: `caseTitle`, `coverTitle`, optional `coverSubtitle`, `coverMeta` as HTML lines, `context`, optional `learningObjectives`, `recordingDate`, `phases`, and `conclusion`. Omit `caseSubtitle` unless a second subtitle adds information that is not already in the title or context.

Each phase has `title`, `transcriptRefs`, `steps` and, when useful, `role`, `tool`, `introduction` and `summary`. Each step has `title`, `body` and `transcriptRefs`. References are timestamp strings used for traceability and are not printed. `body` may be an HTML string or a list of paragraphs. Optional fields are `result`, `note`, `conditional`, `evidence` and `figure`. Text fields may contain simple HTML such as `<b>`, `<code>`, `<ul>` and `<li>`.

A figure uses either `source` relative to the recording or `videoTime` plus an optional `video`. It may also include an ffmpeg `crop` value and a caption.

## Delivery

Save only the final PDF in the user's delivery folder unless they ask for sources. Report the brand, phase and step counts, active duration, page count and any evidence gap. Link the file with the file-link form supported by the current environment; do not hardcode a URI scheme.
