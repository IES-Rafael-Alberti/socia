/**
 * Evaluation PDF renderer for SOCIA.
 *
 * Takes a structured EvaluationReport (from openrouter.ts) plus case metadata
 * and renders a brand-aware PDF with jsPDF. Runs in the background
 * service worker — no DOM, no HTML templates, pure vector drawing.
 *
 * Brand (palette + copy + optional logos) is injected per-call from
 * `@socia/branding`. The renderer never hardcodes colours or strings.
 */

import { jsPDF } from 'jspdf';
import type { Brand, BrandPalette, RGB } from '@socia/branding';
import type { EvaluationReport } from './eval-prompt.js';

// ──────────────── Layout constants ────────────────

const WHITE: RGB = [255, 255, 255];

const PAGE = {
  width: 210, // A4 mm
  height: 297,
  marginX: 18,
  marginTop: 20,
  marginBottom: 18,
};

const CONTENT_WIDTH = PAGE.width - 2 * PAGE.marginX;

// ──────────────── Helpers ────────────────

interface Cursor {
  y: number;
  page: number;
}

function setFill(doc: jsPDF, rgb: RGB) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}
function setText(doc: jsPDF, rgb: RGB) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}
function setDraw(doc: jsPDF, rgb: RGB) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

/** Ensure there is at least `needed` mm available. Start a new page if not. */
function ensureSpace(
  doc: jsPDF,
  cursor: Cursor,
  needed: number,
  pageFooterText: string,
  colors: BrandPalette,
): Cursor {
  if (cursor.y + needed > PAGE.height - PAGE.marginBottom) {
    doc.addPage();
    drawPageFooter(doc, cursor.page + 1, pageFooterText, colors);
    return { y: PAGE.marginTop, page: cursor.page + 1 };
  }
  return cursor;
}

/** Write wrapped text handling page overflow. */
function writeParagraph(
  doc: jsPDF,
  cursor: Cursor,
  text: string,
  pageFooterText: string,
  colors: BrandPalette,
  opts: {
    x?: number;
    width?: number;
    fontSize?: number;
    lineHeight?: number;
    color?: RGB;
    fontStyle?: 'normal' | 'bold' | 'italic';
  } = {},
): Cursor {
  const x = opts.x ?? PAGE.marginX;
  const width = opts.width ?? CONTENT_WIDTH;
  const fontSize = opts.fontSize ?? 10;
  const lineHeight = opts.lineHeight ?? fontSize * 0.45;
  const color = opts.color ?? colors.dark;
  const fontStyle = opts.fontStyle ?? 'normal';

  doc.setFont('helvetica', fontStyle);
  doc.setFontSize(fontSize);
  setText(doc, color);

  const lines = doc.splitTextToSize(text, width) as string[];
  let y = cursor.y;
  let page = cursor.page;
  for (const line of lines) {
    if (y + lineHeight > PAGE.height - PAGE.marginBottom) {
      doc.addPage();
      page++;
      drawPageFooter(doc, page, pageFooterText, colors);
      y = PAGE.marginTop;
    }
    doc.text(line, x, y);
    y += lineHeight;
  }
  return { y, page };
}

// ──────────────── Decorative blocks ────────────────

interface CoverMeta {
  caseId: string;
  caseTitle: string;
  sessionDate: string;
  duration: string;
  mode: string;
  score: EvaluationReport['score'];
}

function drawCover(doc: jsPDF, meta: CoverMeta, brand: Brand) {
  const colors = brand.palette;

  // Full primary background
  setFill(doc, colors.primary);
  doc.rect(0, 0, PAGE.width, PAGE.height, 'F');

  // Imago (top-right corner) — only if the brand provides one.
  if (brand.logos?.imago) {
    try {
      const imagoSize = 32; // mm
      doc.addImage(
        `data:image/png;base64,${brand.logos.imago}`,
        'PNG',
        PAGE.width - PAGE.marginX - imagoSize,
        PAGE.marginTop,
        imagoSize,
        imagoSize,
        undefined,
        'FAST',
      );
    } catch {
      /* If a brand ships an invalid PNG, render the cover without it
         instead of failing the whole evaluation. */
    }
  }

  // Eyebrow
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setText(doc, WHITE);
  doc.text(brand.name.eyebrow, PAGE.marginX, 80);

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.text('Evaluación', PAGE.marginX, 105);
  doc.text('del caso', PAGE.marginX, 118);

  // Subtitle
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.text(meta.caseTitle, PAGE.marginX, 135, {
    maxWidth: CONTENT_WIDTH,
  });

  // Meta panel (translucent white block)
  const panelY = 160;
  const panelH = 42;
  setFill(doc, WHITE);
  doc.setGState(
    new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({
      opacity: 0.12,
    }),
  );
  doc.roundedRect(PAGE.marginX, panelY, CONTENT_WIDTH, panelH, 3, 3, 'F');
  doc.setGState(
    new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({
      opacity: 1,
    }),
  );

  // Meta lines (white text on the translucent panel)
  doc.setFontSize(10);
  setText(doc, WHITE);
  doc.setFont('helvetica', 'bold');

  const lines = [
    `Caso:  ${meta.caseId}`,
    `Fecha de realización:  ${meta.sessionDate}`,
    `Duración:  ${meta.duration}`,
    `Modo:  ${meta.mode}`,
    `Hitos completados:  ${meta.score.completed} / ${meta.score.total}  (${meta.score.percentage}%)`,
  ];
  let ly = panelY + 8;
  for (const line of lines) {
    doc.text(line, PAGE.marginX + 6, ly);
    ly += 7;
  }

  // Footer attribution — wraps onto two lines for legibility.
  setText(doc, WHITE);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const footerY = PAGE.height - 22;
  setDraw(doc, WHITE);
  doc.setLineWidth(0.2);
  doc.line(PAGE.marginX, footerY - 5, PAGE.width - PAGE.marginX, footerY - 5);
  const footerLines = doc.splitTextToSize(
    brand.copy.evaluationCoverFooter,
    CONTENT_WIDTH,
  ) as string[];
  let fy = footerY;
  for (const line of footerLines) {
    doc.text(line, PAGE.marginX, fy);
    fy += 5;
  }
}

function drawScoreBadge(
  doc: jsPDF,
  cursor: Cursor,
  score: EvaluationReport['score'],
  pageFooterText: string,
  colors: BrandPalette,
): Cursor {
  const boxH = 28;
  cursor = ensureSpace(doc, cursor, boxH + 6, pageFooterText, colors);

  // Outline box
  setFill(doc, colors.tint);
  doc.roundedRect(PAGE.marginX, cursor.y, CONTENT_WIDTH, boxH, 3, 3, 'F');

  // Big grade on the left
  setText(doc, colors.primary);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.text(`${score.grade_out_of_10}`, PAGE.marginX + 8, cursor.y + 20);

  setText(doc, colors.primaryDark);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('/ 10', PAGE.marginX + 26, cursor.y + 20);

  // Right side: milestones + percentage
  setText(doc, colors.dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(
    `${score.completed} / ${score.total} hitos completados`,
    PAGE.marginX + 50,
    cursor.y + 12,
  );

  setText(doc, colors.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(
    `${score.percentage}% de los objetivos del caso`,
    PAGE.marginX + 50,
    cursor.y + 20,
  );

  return { y: cursor.y + boxH + 6, page: cursor.page };
}

function drawSectionHeading(
  doc: jsPDF,
  cursor: Cursor,
  text: string,
  pageFooterText: string,
  colors: BrandPalette,
): Cursor {
  cursor = ensureSpace(doc, cursor, 12, pageFooterText, colors);
  setText(doc, colors.dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(text, PAGE.marginX, cursor.y + 4);

  // Primary underline
  setDraw(doc, colors.primary);
  doc.setLineWidth(1.2);
  doc.line(PAGE.marginX, cursor.y + 6.5, PAGE.marginX + 40, cursor.y + 6.5);

  return { y: cursor.y + 12, page: cursor.page };
}

function drawPhaseHeader(
  doc: jsPDF,
  cursor: Cursor,
  phase: EvaluationReport['phase_feedback'][number],
  pageFooterText: string,
  colors: BrandPalette,
): Cursor {
  const blockH = 14;
  cursor = ensureSpace(doc, cursor, blockH + 3, pageFooterText, colors);

  // Left primary block (phase id)
  const leftW = 30;
  setFill(doc, colors.primary);
  doc.roundedRect(PAGE.marginX, cursor.y, leftW, blockH, 2, 2, 'F');

  setText(doc, WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`${phase.completed} / ${phase.total}`, PAGE.marginX + leftW / 2, cursor.y + 9, {
    align: 'center',
  });

  // Right tint block (phase title)
  setFill(doc, colors.tint);
  doc.rect(PAGE.marginX + leftW, cursor.y, CONTENT_WIDTH - leftW, blockH, 'F');

  // Left border accent
  setFill(doc, colors.primary);
  doc.rect(PAGE.marginX + leftW, cursor.y, 1.2, blockH, 'F');

  setText(doc, colors.dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(phase.phase_title, PAGE.marginX + leftW + 4, cursor.y + 9);

  return { y: cursor.y + blockH + 3, page: cursor.page };
}

function drawBulletList(
  doc: jsPDF,
  cursor: Cursor,
  items: string[],
  pageFooterText: string,
  colors: BrandPalette,
  color: RGB = colors.dark,
): Cursor {
  for (const item of items) {
    if (!item?.trim()) continue;
    cursor = ensureSpace(doc, cursor, 6, pageFooterText, colors);

    // Bullet
    setFill(doc, colors.primary);
    doc.circle(PAGE.marginX + 2, cursor.y + 1.5, 0.9, 'F');

    // Text
    cursor = writeParagraph(doc, cursor, item, pageFooterText, colors, {
      x: PAGE.marginX + 7,
      width: CONTENT_WIDTH - 7,
      fontSize: 10,
      lineHeight: 4.8,
      color,
    });
    cursor.y += 2;
  }
  return cursor;
}

function drawPageFooter(
  doc: jsPDF,
  pageNum: number,
  pageFooterText: string,
  colors: BrandPalette,
) {
  setText(doc, colors.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(pageFooterText, PAGE.marginX, PAGE.height - 8);
  doc.text(`${pageNum}`, PAGE.width - PAGE.marginX, PAGE.height - 8, {
    align: 'right',
  });
}

// ──────────────── Main entry ────────────────

export interface EvaluationPdfInput {
  caseId: string;
  caseTitle: string;
  sessionStartedAt: string; // ISO
  durationText: string; // "mm:ss"
  mode: 'guided' | 'unguided';
  report: EvaluationReport;
  /** Brand (palette + copy + optional logos) applied to the PDF. */
  brand: Brand;
}

/**
 * Render the evaluation report as a PDF and return it as a Uint8Array
 * (ready to be wrapped in a Blob or added to a ZIP).
 */
export function renderEvaluationPdf(input: EvaluationPdfInput): Uint8Array {
  const { brand } = input;
  const colors = brand.palette;
  const pageFooter = brand.copy.pageFooter;

  const doc = new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: 'portrait',
  });

  // Prettier Spanish date
  const prettyDate = new Date(input.sessionStartedAt).toLocaleString('es-ES', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const coverMeta: CoverMeta = {
    caseId: input.caseId,
    caseTitle: input.caseTitle,
    sessionDate: prettyDate,
    duration: input.durationText,
    mode: input.mode === 'guided' ? 'Guiado' : 'No guiado',
    score: input.report.score,
  };

  // ─── Page 1: Cover ───
  drawCover(doc, coverMeta, brand);

  // ─── Page 2+: Content ───
  doc.addPage();
  drawPageFooter(doc, 2, pageFooter, colors);
  let cursor: Cursor = { y: PAGE.marginTop, page: 2 };

  // Score badge
  cursor = drawSectionHeading(doc, cursor, 'Resumen', pageFooter, colors);
  cursor = drawScoreBadge(doc, cursor, input.report.score, pageFooter, colors);

  // Summary paragraph
  cursor = writeParagraph(doc, cursor, input.report.summary, pageFooter, colors, {
    fontSize: 10.5,
    lineHeight: 5.2,
    color: colors.dark,
  });
  cursor.y += 4;

  // Phase-by-phase
  cursor = drawSectionHeading(doc, cursor, 'Análisis por fase', pageFooter, colors);
  for (const phase of input.report.phase_feedback) {
    cursor = drawPhaseHeader(doc, cursor, phase, pageFooter, colors);
    if (phase.what_went_well?.trim()) {
      cursor = writeParagraph(doc, cursor, 'LO QUE FUE BIEN', pageFooter, colors, {
        fontSize: 8.5,
        lineHeight: 4.2,
        color: colors.primaryDark,
        fontStyle: 'bold',
      });
      cursor = writeParagraph(doc, cursor, phase.what_went_well, pageFooter, colors, {
        fontSize: 10,
        lineHeight: 4.8,
        color: colors.dark,
      });
      cursor.y += 1;
    }
    if (phase.what_to_improve?.trim()) {
      cursor = writeParagraph(doc, cursor, 'LO QUE MEJORAR', pageFooter, colors, {
        fontSize: 8.5,
        lineHeight: 4.2,
        color: colors.primaryDark,
        fontStyle: 'bold',
      });
      cursor = writeParagraph(doc, cursor, phase.what_to_improve, pageFooter, colors, {
        fontSize: 10,
        lineHeight: 4.8,
        color: colors.dark,
      });
    }
    cursor.y += 4;
  }

  // Strengths / Weaknesses / Recommendations
  if (input.report.strengths?.length) {
    cursor = drawSectionHeading(doc, cursor, 'Puntos fuertes', pageFooter, colors);
    cursor = drawBulletList(doc, cursor, input.report.strengths, pageFooter, colors);
    cursor.y += 2;
  }
  if (input.report.weaknesses?.length) {
    cursor = drawSectionHeading(doc, cursor, 'Aspectos a mejorar', pageFooter, colors);
    cursor = drawBulletList(doc, cursor, input.report.weaknesses, pageFooter, colors);
    cursor.y += 2;
  }
  if (input.report.recommendations?.length) {
    cursor = drawSectionHeading(doc, cursor, 'Recomendaciones', pageFooter, colors);
    cursor = drawBulletList(doc, cursor, input.report.recommendations, pageFooter, colors);
    cursor.y += 2;
  }

  // Hints analysis
  if (input.report.hints_analysis?.trim()) {
    cursor = drawSectionHeading(doc, cursor, 'Uso de pistas', pageFooter, colors);
    cursor = writeParagraph(doc, cursor, input.report.hints_analysis, pageFooter, colors, {
      fontSize: 10,
      lineHeight: 4.8,
      color: colors.dark,
    });
    cursor.y += 4;
  }

  // Conclusion (visually highlighted — tint box with left accent + optional sello)
  if (input.report.conclusion?.trim()) {
    // Pre-measure so we can draw the background before the text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    const textLines = doc.splitTextToSize(
      input.report.conclusion,
      CONTENT_WIDTH - 10,
    ) as string[];
    const lineHeight = 5.2;
    const boxH = textLines.length * lineHeight + 6;

    cursor = ensureSpace(doc, cursor, boxH + 14, pageFooter, colors);
    cursor = drawSectionHeading(doc, cursor, 'Conclusión', pageFooter, colors);

    const boxTop = cursor.y;
    setFill(doc, colors.tint);
    doc.rect(PAGE.marginX, boxTop, CONTENT_WIDTH, boxH, 'F');
    setFill(doc, colors.primary);
    doc.rect(PAGE.marginX, boxTop, 1.5, boxH, 'F');

    setText(doc, colors.dark);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    let ty = boxTop + 5;
    for (const line of textLines) {
      doc.text(line, PAGE.marginX + 5, ty);
      ty += lineHeight;
    }
    cursor = { y: boxTop + boxH + 4, page: cursor.page };
  }

  // Sello in the bottom-right of the last content page — only if the brand
  // provides one. Adds the institutional stamp without crowding the layout.
  if (brand.logos?.sello) {
    try {
      const selloSize = 22; // mm
      const selloX = PAGE.width - PAGE.marginX - selloSize;
      const selloY = PAGE.height - PAGE.marginBottom - selloSize - 4;
      // Only render the sello if there's room; otherwise skip silently.
      if (cursor.y < selloY - 4) {
        doc.addImage(
          `data:image/png;base64,${brand.logos.sello}`,
          'PNG',
          selloX,
          selloY,
          selloSize,
          selloSize,
          undefined,
          'FAST',
        );
      }
    } catch {
      /* invalid PNG — skip silently */
    }
  }

  return doc.output('arraybuffer') as unknown as Uint8Array;
}
