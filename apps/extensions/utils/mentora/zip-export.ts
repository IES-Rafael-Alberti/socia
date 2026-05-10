import JSZip from 'jszip';
import type { ActionLog, Screenshot, RecordingMetadata, NetworkEvent } from './messages';
import {
  transcribeAudioChunks,
  transcribeVideo,
  isTranscriptionAvailable,
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
  videoChunks: ArrayBuffer[],
  finalVideo?: ArrayBuffer,
  audioChunks?: ArrayBuffer[],
  networkEvents?: NetworkEvent[]
): Promise<Blob> {
  const zip = new JSZip();

  // Create folder with timestamp
  const timestamp = new Date(metadata.startTime).toISOString().replace(/[:.]/g, '-');
  const folderName = `mentora-recording-${timestamp}`;
  const folder = zip.folder(folderName)!;

  // Prepare video data for both saving and transcription
  let videoData: ArrayBuffer | null = null;

  // 1. Add video file
  if (finalVideo) {
    folder.file('video.webm', new Uint8Array(finalVideo), { binary: true });
    metadata.videoDuration = formatDuration(metadata.duration || 0);
    videoData = finalVideo;
  } else if (videoChunks.length > 0) {
    const totalBytes = videoChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of videoChunks) {
      combined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    folder.file('video.webm', combined, { binary: true });
    videoData = combined.buffer;

    // Calculate video duration for metadata
    metadata.videoDuration = formatDuration(metadata.duration || 0);
  }

  // 2. Transcribe audio if API key is available
  let transcription: TranscriptionResult | null = null;
  if (isTranscriptionAvailable()) {
    console.log('[Export] Transcribing audio...');
    if (audioChunks && audioChunks.length > 0) {
      // Use pre-recorded audio chunks (supports any recording length)
      console.log(`[Export] Using ${audioChunks.length} pre-recorded audio chunks`);
      transcription = await transcribeAudioChunks(audioChunks);
    } else if (videoData) {
      // Fallback: send video directly (only works for small files < 25MB)
      console.log('[Export] No audio chunks, falling back to video transcription');
      transcription = await transcribeVideo(videoData);
    }

    if (transcription && transcription.segments.length > 0) {
      console.log('[Export] Adding transcription file...');
      folder.file('transcription.srt', formatAsSRT(transcription.segments));
    }
  }

  // 3. Add screenshots
  if (screenshots.length > 0) {
    const screenshotsFolder = folder.folder('screenshots')!;

    for (let i = 0; i < screenshots.length; i++) {
      const screenshot = screenshots[i];
      const paddedIndex = String(i + 1).padStart(3, '0');
      const filename = `click_${paddedIndex}_${screenshot.timestamp}.png`;

      // Convert data URL to binary
      const base64Data = screenshot.dataUrl.split(',')[1];
      screenshotsFolder.file(filename, base64Data, { base64: true });
    }
  }

  // 4. Add activity log JSON
  const activityLog = {
    recordingId: metadata.recordingId,
    startTime: metadata.startTime,
    endTime: metadata.endTime,
    totalActions: actions.length,
    actions: actions.map((action) => ({
      ...action,
      // Remove recording-specific internal fields
    })),
  };
  folder.file('activity-log.json', JSON.stringify(activityLog, null, 2));

  // 4b. Add network log JSON (API calls captured by fetch/XHR interceptor)
  if (networkEvents && networkEvents.length > 0) {
    const networkLog = networkEvents.map((evt) => ({
      t: Math.round(evt.relativeTime * 1000),
      method: evt.method,
      url: evt.url,
      host: evt.host,
      pathname: evt.pathname,
      status: evt.status,
      contentType: evt.contentType,
      requestBody: evt.requestBody,
      responseBody: evt.responseBody,
    }));
    folder.file('network-log.json', JSON.stringify(networkLog, null, 2));
  }

  // 5. Add human-readable activity log for LLM
  const readableLog = generateReadableLog(actions, metadata);
  folder.file('activity-log-readable.txt', readableLog);

  // 6. Add metadata
  const finalMetadata: RecordingMetadata = {
    ...metadata,
    totalActions: actions.length,
    totalScreenshots: screenshots.length,
  };
  folder.file('metadata.json', JSON.stringify(finalMetadata, null, 2));

  // 7. Add LLM instructions file
  const llmInstructions = generateLLMInstructions(metadata, actions.length, screenshots.length, !!transcription, networkEvents?.length || 0);
  folder.file('README-FOR-LLM.md', llmInstructions);

  // Generate ZIP with compression
  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
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
  hasTranscription: boolean,
  networkEventCount: number
): string {
  const networkFiles = networkEventCount > 0
    ? `- \`network-log.json\` - Captured API calls (HTTP method, URL, request/response bodies)
`
    : '';

  const transcriptionFiles = hasTranscription
    ? `- \`transcription.srt\` - Audio transcription of the recording, segmented by chunk
`
    : '';

  const transcriptionNote = hasTranscription
    ? `5. **Read \`transcription.srt\`** for what was said during the recording. Use the action timestamps in the activity log to locate the relevant chunk; chunk boundaries are coarse (~5 min) and not aligned to individual phrases.
`
    : '';

  return `# MENTORA Recording Package

This package contains a tutorial recording captured by the MENTORA browser extension.

## Contents

- \`video.webm\` - Screen recording with audio (VP9 codec, optimized for size)
- \`screenshots/\` - PNG screenshots captured on each click action
- \`activity-log.json\` - Structured JSON log of all user actions
- \`activity-log-readable.txt\` - Human-readable timeline of actions
- \`metadata.json\` - Recording session metadata
${networkFiles}${transcriptionFiles}
## Recording Summary

- **Extension**: ${metadata.extensionName} v${metadata.version}
- **Recording ID**: ${metadata.recordingId}
- **Duration**: ${metadata.videoDuration || 'N/A'}
- **Total Actions**: ${actionCount}
- **Total Screenshots**: ${screenshotCount}
- **Pages Visited**: ${metadata.pages.length}
- **Network Events Captured**: ${networkEventCount}
- **Audio Transcription**: ${hasTranscription ? 'Yes' : 'No'}

## How to Use This Recording

### For LLMs/AI Agents

1. **Read \`activity-log-readable.txt\`** for a quick understanding of what the user did
2. **Parse \`activity-log.json\`** for structured data including:
   - CSS selectors for each interacted element
   - Timestamps relative to recording start
   - Input values (non-sensitive)
   - Navigation events
3. **Reference screenshots** by their IDs mentioned in the action log
4. **Watch the video** for visual context
${transcriptionNote}

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
