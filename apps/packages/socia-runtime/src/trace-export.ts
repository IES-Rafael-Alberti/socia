/**
 * Extension-side trace export. Re-exports the pure helpers from
 * `@socia/eval` and adds a Chrome `downloads.download` helper that the
 * shared package can't reference (no chrome.* in shared code).
 */

export {
  buildTraceExport,
  traceExportToJson,
  buildExportFilenameBase,
  type TraceExport,
} from '@socia/eval';

import {
  traceExportToJson,
  buildExportFilenameBase,
  type TraceExport,
} from '@socia/eval';

export async function downloadTraceExport(exportData: TraceExport): Promise<void> {
  const json = traceExportToJson(exportData);
  const filename = `${buildExportFilenameBase(exportData)}-trace.json`;

  // Encode as base64 data URL (service workers can't use URL.createObjectURL)
  const base64 = btoa(unescape(encodeURIComponent(json)));
  const dataUrl = `data:application/json;base64,${base64}`;

  await chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
}
