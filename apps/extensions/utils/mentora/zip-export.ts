import JSZip from 'jszip';
import type {
  ActionLog,
  Screenshot,
  RecordingMetadata,
  NetworkEvent,
  ExportArtifactKind,
  VideoManifest,
} from './messages';
import type { RecordedAudioChunk, RecordedFinalVideo, RecordedVideoChunk } from './db';
import { captureText, sanitizeNetworkUrl } from '../shared/network-capture';
import { sanitizeActionLog } from './action-sanitization';
import {
  transcribeAudioChunks,
  formatAsSRT,
  type TranscriptionResult,
} from './transcription';

/**
 * Exports recording data to a ZIP file
 */
export async function exportToZip(
  metadata: RecordingMetadata,
  actions: ActionLog[],
  screenshots: Screenshot[],
  videoChunks: RecordedVideoChunk[],
  finalVideo?: RecordedFinalVideo,
  audioChunks?: RecordedAudioChunk[],
  networkEvents?: NetworkEvent[],
  openRouterApiKey?: string,
  onStage?: (stage: 'transcribing' | 'packaging') => void | Promise<void>,
  videoManifest?: VideoManifest | null
): Promise<{
  blob: Blob;
  artifactKind: ExportArtifactKind;
  warning?: string;
}> {
  const zip = new JSZip();
  const screenshotFilenames = new Map<string, string>();
  screenshots.forEach((screenshot, index) => {
    const paddedIndex = String(index + 1).padStart(3, '0');
    screenshotFilenames.set(screenshot.id, `click_${paddedIndex}_${screenshot.timestamp}.png`);
  });
  const safeActions = actions.map((action) => {
    const safeAction = sanitizeActionLog(action);
    const screenshotId = safeAction.details.screenshotId;
    return screenshotId && screenshotFilenames.has(screenshotId)
      ? {
          ...safeAction,
          details: { ...safeAction.details, screenshotId: screenshotFilenames.get(screenshotId) },
        }
      : safeAction;
  });

  // Create folder with timestamp
  const timestamp = new Date(metadata.startTime).toISOString().replace(/[:.]/g, '-');
  const folderName = `mentora-recording-${timestamp}`;
  const folder = zip.folder(folderName)!;

  const orderedChunks = [...videoChunks].sort((a, b) => a.sequence - b.sequence);
  const artifactKind: ExportArtifactKind = metadata.videoCapture?.status === 'recovery'
    || videoManifest?.status === 'recovery'
    || (!finalVideo && orderedChunks.length > 0)
    ? 'recovery'
    : 'recording';
  const warning = artifactKind === 'recovery'
    ? 'El MP4 no superó la validación. Se descargó un paquete de recuperación.'
    : undefined;
  const highestStoredSequence = orderedChunks.reduce(
    (highest, chunk) => Math.max(highest, chunk.sequence + 1),
    0
  );
  const inferredEmittedChunks = Math.max(
    metadata.videoCapture?.emittedChunks ?? 0,
    highestStoredSequence
  );
  const inferredSequences = new Set(orderedChunks.map((chunk) => chunk.sequence));
  const inferredMissingSequences = Array.from(
    { length: inferredEmittedChunks },
    (_, sequence) => sequence
  ).filter((sequence) => !inferredSequences.has(sequence));
  const effectiveVideoManifest: VideoManifest | null = videoManifest ?? (
    artifactKind === 'recovery'
      ? {
          version: 1,
          recordingId: metadata.recordingId,
          mimeType: metadata.videoCapture?.mimeType ?? 'video/mp4',
          activeDurationMs: metadata.videoCapture?.activeDurationMs ?? metadata.duration ?? 0,
          pausedDurationMs: metadata.videoCapture?.pausedDurationMs ?? 0,
          emittedChunks: inferredEmittedChunks,
          storedChunks: orderedChunks.length || metadata.videoCapture?.storedChunks || 0,
          totalBytes: orderedChunks.length > 0
            ? orderedChunks.reduce((total, chunk) => total + chunk.blob.size, 0)
            : metadata.videoCapture?.totalBytes ?? 0,
          stopReason: metadata.videoCapture?.stopReason ?? 'context-restarted',
          status: 'recovery',
          missingSequences: inferredMissingSequences,
          validationError: 'No se encontró un MP4 final validado.',
          chunks: orderedChunks.map((chunk) => ({
            sequence: chunk.sequence,
            timecodeMs: chunk.timecodeMs,
            size: chunk.size,
            mimeType: chunk.mimeType,
            sha256: chunk.sha256,
            attempts: chunk.attempts,
            stored: true,
          })),
        }
      : null
  );

  // 1. Add video file
  if (finalVideo) {
    const videoBlob = finalVideo.blob;
    folder.file(
      finalVideo.filename,
      canUseBlobInput() ? videoBlob : await videoBlob.arrayBuffer(),
      { binary: true, compression: 'STORE' }
    );
    metadata.videoDuration = formatDuration(
      metadata.videoCapture?.activeDurationMs ?? metadata.duration ?? 0
    );
  } else if (orderedChunks.length > 0) {
    const videoBlob = new Blob(orderedChunks.map((chunk) => chunk.blob), {
      type: metadata.videoCapture?.mimeType || 'video/mp4',
    });
    folder.file(
      'recovery/video-unverified.mp4',
      canUseBlobInput() ? videoBlob : await videoBlob.arrayBuffer(),
      { binary: true, compression: 'STORE' }
    );
    for (const chunk of orderedChunks) {
      const filename = `${String(chunk.sequence).padStart(6, '0')}.mp4part`;
      folder.file(
        `recovery/chunks/${filename}`,
        canUseBlobInput() ? chunk.blob : await chunk.blob.arrayBuffer(),
        { binary: true, compression: 'STORE' }
      );
    }
    folder.file('RECOVERY.md', buildRecoveryReadme(effectiveVideoManifest));
    metadata.videoDuration = formatDuration(metadata.videoCapture?.activeDurationMs ?? 0);
  }
  if (artifactKind === 'recovery' && !zip.file(`${folderName}/RECOVERY.md`)) {
    folder.file('RECOVERY.md', buildRecoveryReadme(effectiveVideoManifest));
  }

  // 2. Transcribe audio if API key is available
  let transcription: TranscriptionResult | null = null;
  if (openRouterApiKey) {
    await onStage?.('transcribing');
    console.log('[Export] Transcribing audio...');
    if (audioChunks && audioChunks.length > 0) {
      // Use pre-recorded audio chunks (supports any recording length)
      console.log(`[Export] Using ${audioChunks.length} pre-recorded audio chunks`);
      transcription = await transcribeAudioChunks(audioChunks, openRouterApiKey);
    }

    if (transcription && transcription.segments.length > 0) {
      console.log('[Export] Adding transcription file...');
      folder.file('transcription.srt', formatAsSRT(transcription.segments));
    }
    if (transcription) {
      folder.file(
        'transcription.json',
        JSON.stringify(
          {
            text: transcription.text,
            duration: transcription.duration,
            segments: transcription.segments,
            words: transcription.words,
          },
          null,
          2
        )
      );
      folder.file(
        'transcription-status.json',
        JSON.stringify(
          {
            attemptedChunks: transcription.attemptedChunks,
            transcribedChunks: transcription.transcribedChunks,
            segments: transcription.segments.length,
            words: transcription.words.length,
            failedChunks: transcription.failures,
            requestsComplete: transcription.failures.length === 0,
          },
          null,
          2
        )
      );
    }
  }

  // 3. Add screenshots
  if (screenshots.length > 0) {
    const screenshotsFolder = folder.folder('screenshots')!;

    for (let i = 0; i < screenshots.length; i++) {
      const screenshot = screenshots[i];
      const filename = screenshotFilenames.get(screenshot.id)!;

      // Convert data URL to binary
      const base64Data = screenshot.dataUrl.split(',')[1];
      screenshotsFolder.file(filename, base64Data, { base64: true, compression: 'STORE' });
    }
  }

  // 4. Add activity log JSON
  const activityLog = {
    recordingId: metadata.recordingId,
    startTime: metadata.startTime,
    endTime: metadata.endTime,
    totalActions: safeActions.length,
    actions: safeActions.map((action) => ({
      ...action,
      // Remove recording-specific internal fields
    })),
  };
  folder.file('activity-log.json', JSON.stringify(activityLog, null, 2));

  // 4b. Add network log JSON (API calls captured by fetch/XHR interceptor)
  if (networkEvents && networkEvents.length > 0) {
    const networkLog = networkEvents.map((evt) => {
      const safeUrl = sanitizeNetworkUrl(evt.url);
      const safeResponseUrl = sanitizeNetworkUrl(evt.responseUrl ?? evt.url);
      const safeDocumentUrl = sanitizeNetworkUrl(evt.documentUrl ?? evt.url);
      const safeRequestBody = captureText(evt.requestBody, {
        contentType: evt.contentType,
        url: safeUrl?.value ?? evt.url,
      });
      const safeResponseBody = captureText(evt.responseBody, {
        contentType: evt.contentType,
        url: safeResponseUrl?.value ?? evt.responseUrl ?? evt.url,
      });
      return {
        t: Math.round(evt.relativeTime * 1000),
        endT:
          evt.relativeEndTime !== undefined
            ? Math.round(evt.relativeEndTime * 1000)
            : undefined,
        requestId: evt.requestId,
        durationMs: evt.durationMs,
        source: evt.source,
        method: evt.method,
        url: safeUrl?.value ?? '',
        responseUrl: safeResponseUrl?.value,
        redirected: evt.redirected,
        host: evt.host,
        pathname: evt.pathname,
        status: evt.status,
        statusText: evt.statusText,
        contentType: evt.contentType,
        requestBody: safeRequestBody.value,
        responseBody: safeResponseBody.value,
        requestBodyLength: evt.requestBodyLength,
        responseBodyLength: evt.responseBodyLength,
        requestBodyTruncated:
          evt.requestBodyTruncated || safeRequestBody.truncated,
        responseBodyTruncated:
          evt.responseBodyTruncated || safeResponseBody.truncated,
        urlRedactions: [
          ...new Set([
            ...(evt.urlRedactions ?? []),
            ...(safeUrl?.redactions ?? []),
          ]),
        ],
        responseUrlRedactions: [
          ...new Set([
            ...(evt.responseUrlRedactions ?? []),
            ...(safeResponseUrl?.redactions ?? []),
          ]),
        ],
        documentUrlRedactions: [
          ...new Set([
            ...(evt.documentUrlRedactions ?? []),
            ...(safeDocumentUrl?.redactions ?? []),
          ]),
        ],
        requestBodyRedactions: [
          ...new Set([
            ...(evt.requestBodyRedactions ?? []),
            ...(safeRequestBody.redactions ?? []),
          ]),
        ],
        responseBodyRedactions: [
          ...new Set([
            ...(evt.responseBodyRedactions ?? []),
            ...(safeResponseBody.redactions ?? []),
          ]),
        ],
        outcome: evt.outcome,
        error: evt.error,
        tabId: evt.tabId,
        frameId: evt.frameId,
        documentUrl: safeDocumentUrl?.value,
      };
    });
    folder.file('network-log.json', JSON.stringify(networkLog, null, 2));
  }

  // 5. Prepare safe metadata for every text file in the ZIP
  const pages = [
    ...metadata.pages,
    ...safeActions.map((action) => action.url),
  ]
    .map((page) => sanitizeNetworkUrl(page)?.value)
    .filter((page): page is string => Boolean(page));
  const finalMetadata: RecordingMetadata = {
    ...metadata,
    totalActions: safeActions.length,
    totalScreenshots: screenshots.length,
    pages: [...new Set(pages)],
  };

  // 6. Add human-readable activity log for LLM
  const readableLog = generateReadableLog(safeActions, finalMetadata);
  folder.file('activity-log-readable.txt', readableLog);

  // 7. Add metadata
  folder.file('metadata.json', JSON.stringify(finalMetadata, null, 2));
  if (effectiveVideoManifest) {
    folder.file('video-manifest.json', JSON.stringify(effectiveVideoManifest, null, 2));
  }

  // 8. Add LLM instructions file
  const transcriptionState = getTranscriptionState(transcription);
  const llmInstructions = generateLLMInstructions(
    finalMetadata,
    safeActions.length,
    screenshots.length,
    transcriptionState,
    networkEvents?.length || 0
  );
  folder.file('README-FOR-LLM.md', llmInstructions);

  // Generate ZIP with compression
  await onStage?.('packaging');
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    streamFiles: true,
  });
  return { blob, artifactKind, warning };
}

function buildRecoveryReadme(manifest?: VideoManifest | null): string {
  const reason = manifest?.validationError ?? 'No se pudo validar el MP4 final.';
  const missing = manifest?.missingSequences.length
    ? manifest.missingSequences.join(', ')
    : 'ninguno detectado';
  return `# Paquete de recuperación de MENTORA

MENTORA no presenta el vídeo como válido porque falló su comprobación final.

- Motivo: ${reason}
- Fragmentos ausentes: ${missing}
- Fragmentos guardados: ${manifest?.storedChunks ?? 0} de ${manifest?.emittedChunks ?? 0}

El resto del caso sigue disponible. Usa primero la transcripción, el registro de
actividad y las capturas. \`recovery/video-unverified.mp4\` contiene los bytes
recuperados en orden. \`recovery/chunks/\` conserva cada fragmento por separado.
\`video-manifest.json\` incluye tamaños, sumas y errores.
`;
}

function canUseBlobInput(): boolean {
  return typeof document !== 'undefined' && JSZip.support.blob;
}

type TranscriptionState = 'none' | 'complete' | 'partial' | 'empty' | 'failed';

function getTranscriptionState(transcription: TranscriptionResult | null): TranscriptionState {
  if (!transcription) return 'none';
  if (transcription.segments.length === 0) {
    return transcription.failures.length > 0 ? 'failed' : 'empty';
  }
  return transcription.failures.length > 0 ? 'partial' : 'complete';
}

/**
 * Generates a human-readable log for LLM consumption
 */
function generateReadableLog(actions: ActionLog[], metadata: RecordingMetadata): string {
  const lines: string[] = [];

  lines.push('# MENTORA - Tutorial Recording Log');
  lines.push('');
  lines.push(`Recording ID: ${metadata.recordingId}`);
  lines.push(`Start Time: ${new Date(metadata.startTime).toISOString()}`);
  if (metadata.endTime) {
    lines.push(`End Time: ${new Date(metadata.endTime).toISOString()}`);
    lines.push(`Duration: ${formatDuration(metadata.duration || 0)}`);
  }
  lines.push(`Total Actions: ${actions.length}`);
  lines.push('');
  lines.push('## Pages Visited');
  metadata.pages.forEach((page) => {
    lines.push(`- ${page}`);
  });
  lines.push('');
  lines.push('## Action Timeline');
  lines.push('');

  let currentUrl = '';

  for (const action of actions) {
    // Add page header when URL changes
    if (action.url !== currentUrl) {
      currentUrl = action.url;
      lines.push('');
      lines.push(`### Page: ${action.pageTitle || action.url}`);
      lines.push(`URL: ${action.url}`);
      lines.push('');
    }

    const timeStr = formatTimestamp(action.relativeTime);
    const screenshotRef = action.details.screenshotId
      ? ` [Screenshot: ${action.details.screenshotId}]`
      : '';

    lines.push(`[${timeStr}] ${action.humanReadable}${screenshotRef}`);

    // Add extra details for certain action types
    if (action.type === 'input' && action.details.inputValue) {
      lines.push(`         Value: "${action.details.inputValue}"`);
    }
    if (action.type === 'select_text' && action.details.selectedText) {
      lines.push(`         Text: "${action.details.selectedText}"`);
    }
    if (action.details.element?.selector) {
      lines.push(`         Selector: ${action.details.element.selector}`);
    }
  }

  lines.push('');
  lines.push('--- End of Log ---');

  return lines.join('\n');
}

/**
 * Generates instructions for LLM to understand the recording
 */
function generateLLMInstructions(
  metadata: RecordingMetadata,
  actionCount: number,
  screenshotCount: number,
  transcriptionState: TranscriptionState,
  networkEventCount: number
): string {
  const hasTranscription = transcriptionState === 'complete' || transcriptionState === 'partial';
  const hasTranscriptionStatus = transcriptionState !== 'none';
  const networkFiles = networkEventCount > 0
    ? `- \`network-log.json\` - Captured API calls with timing, redirects, errors and request/response bodies
`
    : '';

  const transcriptionFiles = hasTranscription
    ? `- \`transcription.srt\` - Audio transcription with segment timestamps
`
    : '';
  const transcriptionDataFile = hasTranscriptionStatus
    ? `- \`transcription.json\` - Full text, segments and word timestamps
`
    : '';
  const transcriptionStatusFile = hasTranscriptionStatus
    ? `- \`transcription-status.json\` - Result of each transcription request
`
    : '';

  const transcriptionNote = hasTranscription
    ? `5. **Read \`transcription.json\`** for what was said during the recording. Match its segment or word timestamps with the action log.
`
    : '';
  const transcriptionLabel = {
    none: 'No',
    complete: 'Complete',
    partial: 'Partial',
    empty: 'Empty',
    failed: 'Failed',
  }[transcriptionState];
  const captureWarnings = metadata.captureWarnings?.length
    ? `\n## Capture Warnings\n\n${metadata.captureWarnings.map((warning) => `- ${warning}`).join('\n')}\n`
    : '';
  const videoLabel = metadata.videoCapture?.status === 'recovery'
    ? '- `recovery/` - Unverified MP4 bytes and ordered fragments for recovery\n- `video-manifest.json` - Video fragment integrity and validation report'
    : '- `video.mp4` - Validated screen recording with audio';
  const videoInstruction = metadata.videoCapture?.status === 'recovery'
    ? '4. **Do not treat the recovery video as complete evidence.** Prefer transcription, actions and screenshots.'
    : '4. **Watch the video** for visual context';

  return `# MENTORA Recording Package

This package contains a tutorial recording captured by the MENTORA browser extension.

## Contents

${videoLabel}
- \`screenshots/\` - PNG screenshots captured on each click action
- \`activity-log.json\` - Structured JSON log of all user actions
- \`activity-log-readable.txt\` - Human-readable timeline of actions
- \`metadata.json\` - Recording session metadata
${networkFiles}${transcriptionFiles}${transcriptionDataFile}${transcriptionStatusFile}
## Recording Summary

- **Extension**: ${metadata.extensionName} v${metadata.version}
- **Recording ID**: ${metadata.recordingId}
- **Duration**: ${metadata.videoDuration || 'N/A'}
- **Total Actions**: ${actionCount}
- **Total Screenshots**: ${screenshotCount}
- **Pages Visited**: ${metadata.pages.length}
- **Network Events Captured**: ${networkEventCount}
- **Audio Transcription**: ${transcriptionLabel}
${captureWarnings}

## How to Use This Recording

### For LLMs/AI Agents

1. **Read \`activity-log-readable.txt\`** for a quick understanding of what the user did
2. **Parse \`activity-log.json\`** for structured data including:
   - CSS selectors for each interacted element
   - Timestamps relative to recording start
   - Input values (non-sensitive)
   - Navigation events
3. **Reference screenshots** by their IDs mentioned in the action log
${videoInstruction}
${transcriptionNote}

When reading \`network-log.json\`, use \`t\` and \`endT\` to align requests
with actions and speech. Ignore failed or unknown outcomes as milestone proof.
If a body is marked as truncated, only rely on text that is present in the
captured value. \`url\` is the requested URL and \`responseUrl\` is the final
URL after redirects.

### Action Types Captured

- \`click\` - Mouse clicks with element details and position
- \`input\` - Text input (passwords excluded)
- \`scroll\` - Page scrolling with direction
- \`navigation\` - Page navigation events
- \`tab_switch\` - Browser tab changes
- \`tab_create\` / \`tab_close\` - Tab lifecycle
- \`select_text\` - Text selection
- \`copy\` / \`paste\` - Clipboard operations
- \`keypress\` - Special keys and shortcuts
- \`form_submit\` - Form submissions
- \`hover\` - Significant hover events (>500ms)

### Element Identification

Each click action includes:
- \`selector\` - Unique CSS selector for the element
- \`tagName\` - HTML tag name
- \`text\` - Visible text content
- \`ariaLabel\` - Accessibility label if available
- \`position\` - Click coordinates

## Reproducing the Tutorial

To reproduce the actions programmatically:

1. Navigate to the starting URL
2. For each action in \`activity-log.json\`:
   - Use the \`selector\` to find the element
   - Perform the action type (click, type, etc.)
   - Wait for any navigation to complete
3. Verify against screenshots for visual confirmation

---
Generated by MENTORA - Tutorial Capture Extension
`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}
