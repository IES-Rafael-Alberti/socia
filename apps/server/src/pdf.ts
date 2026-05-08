/**
 * Server-side wrapper around the shared SOCIA evaluation PDF renderer.
 *
 * The renderer is identical to the one the extension uses in standalone mode.
 * We just write the bytes to disk here instead of triggering a browser download.
 */

import fs from 'node:fs';
import { renderEvaluationPdf } from '@socia/eval';
import type { EvaluationReport } from '@socia/eval';
import type { Brand } from '@socia/branding';

export interface ServerEvaluationPdfInput {
  filePath: string;
  caseId: string;
  caseTitle: string;
  sessionStartedAt: string; // ISO
  durationText: string;
  mode: 'guided' | 'unguided';
  report: EvaluationReport;
  brand: Brand;
}

export function writeEvaluationPdf(input: ServerEvaluationPdfInput): void {
  const bytes = renderEvaluationPdf({
    caseId: input.caseId,
    caseTitle: input.caseTitle,
    sessionStartedAt: input.sessionStartedAt,
    durationText: input.durationText,
    mode: input.mode,
    report: input.report,
    brand: input.brand,
  });
  fs.writeFileSync(input.filePath, Buffer.from(bytes));
}
