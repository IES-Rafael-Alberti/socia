/**
 * Build and download the final "finish case" ZIP bundle.
 * Contains the v4.0 trace JSON + the evaluation PDF.
 *
 * If the LLM evaluation fails for any reason, we still download the trace
 * alone so the student's work is not lost.
 */

import JSZip from 'jszip';
import { evaluateCase } from './openrouter';
import type { EvaluationReport } from './openrouter';
import { renderEvaluationPdf } from '@socia/eval';
import { interpolateWorkflowText } from '@socia/eval';
import type { WorkflowData } from '@socia/eval';
import type { Brand } from '@socia/branding';
import type { TraceExport } from './trace-export';
import {
  traceExportToJson,
  buildExportFilenameBase,
  downloadTraceExport,
} from './trace-export';

export interface FinishResult {
  success: boolean;
  evaluationSucceeded: boolean;
  error?: string;
}

/**
 * Convert a base64 string to a data URL that chrome.downloads.download accepts.
 * Service workers can't call URL.createObjectURL so we use data URLs.
 */
function blobToDataUrl(bytes: Uint8Array, mime: string): string {
  // Build a binary string in chunks to avoid stack overflow on large payloads
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  const base64 = btoa(binary);
  return `data:${mime};base64,${base64}`;
}

/**
 * Generate evaluation + PDF, bundle with trace JSON into a ZIP, and trigger
 * the download. Returns a result indicating whether evaluation succeeded.
 */
export async function finishAndDownload(
  workflow: WorkflowData,
  traceExport: TraceExport,
  brand: Brand,
): Promise<FinishResult> {
  const filenameBase = buildExportFilenameBase(traceExport);
  const traceJson = traceExportToJson(traceExport);

  let evaluation: EvaluationReport | null = null;
  let evalError: string | undefined;

  try {
    evaluation = await evaluateCase(workflow, traceExport);
  } catch (err) {
    evalError = err instanceof Error ? err.message : String(err);
    console.error('[SOCIA finish] Evaluation failed:', evalError);
  }

  // If evaluation failed, fall back to just downloading the trace JSON so the
  // student's work isn't lost.
  if (!evaluation) {
    await downloadTraceExport(traceExport);
    return {
      success: true,
      evaluationSucceeded: false,
      error: evalError,
    };
  }

  // Render the PDF
  const pdfBytes = renderEvaluationPdf({
    caseId: traceExport.case_id,
    caseTitle: interpolateWorkflowText(workflow.case.title, workflow.variables),
    sessionStartedAt: traceExport.session.started_at,
    durationText: traceExport.session.duration,
    mode: traceExport.session.mode,
    report: evaluation,
    brand,
  });

  // Build ZIP
  const zip = new JSZip();
  zip.file(`${filenameBase}-trace.json`, traceJson);
  zip.file(`${filenameBase}-evaluacion.pdf`, pdfBytes);
  zip.file(
    `${filenameBase}-evaluacion.json`,
    JSON.stringify(evaluation, null, 2)
  );

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const dataUrl = blobToDataUrl(zipBytes, 'application/zip');

  await chrome.downloads.download({
    url: dataUrl,
    filename: `${filenameBase}.zip`,
    saveAs: true,
  });

  return { success: true, evaluationSucceeded: true };
}
