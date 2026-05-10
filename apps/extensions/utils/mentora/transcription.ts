/**
 * Audio transcription via OpenRouter.
 *
 * The endpoint returns only `{ text, usage }` — no segment-level timestamps.
 * We emit one SRT entry per audio chunk using `usage.seconds` as duration,
 * which gives the guide-generator skill rough temporal anchors against the
 * activity log. Not intended as synchronised subtitles.
 */

const OPENROUTER_API_KEY = import.meta.env.EXT_OPENROUTER_API_KEY as string | undefined;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
const TRANSCRIPTION_MODEL =
  (import.meta.env.EXT_OPENROUTER_MODEL_TRANSCRIPTION as string | undefined) ??
  'openai/whisper-large-v3-turbo';
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  duration: number;
}

export function isTranscriptionAvailable(): boolean {
  return !!OPENROUTER_API_KEY;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function transcribeChunk(
  chunk: Blob,
  format: 'webm' | 'wav' | 'mp3' | 'ogg',
  chunkIndex: number
): Promise<{ text: string; duration: number }> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API key not configured');
  }

  console.log(
    `[Transcription] Encoding chunk ${chunkIndex + 1} (${(chunk.size / 1024 / 1024).toFixed(2)} MB)...`
  );
  const data = await blobToBase64(chunk);

  console.log(`[Transcription] Sending chunk ${chunkIndex + 1} to OpenRouter (${TRANSCRIPTION_MODEL})...`);
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://socia-extension.local',
      'X-Title': 'MENTORA',
    },
    body: JSON.stringify({
      model: TRANSCRIPTION_MODEL,
      input_audio: { data, format },
      language: 'es',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[Transcription] API error:', error);
    throw new Error(`OpenRouter transcription error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  console.log(`[Transcription] Chunk ${chunkIndex + 1} response:`, {
    text: result.text?.substring(0, 100),
    duration: result.usage?.seconds,
    cost: result.usage?.cost,
  });

  return {
    text: result.text || '',
    duration: result.usage?.seconds ?? 0,
  };
}

/**
 * Transcribe pre-recorded audio chunks (webm/opus, ~5 min each).
 * Each chunk yields a single SRT segment spanning its full duration.
 */
export async function transcribeAudioChunks(
  audioChunks: ArrayBuffer[]
): Promise<TranscriptionResult | null> {
  if (!isTranscriptionAvailable()) {
    console.log('[Transcription] Skipping - no OpenRouter API key configured');
    return null;
  }
  if (audioChunks.length === 0) {
    console.log('[Transcription] No audio chunks to transcribe');
    return null;
  }

  console.log(`[Transcription] Starting transcription of ${audioChunks.length} audio chunks...`);

  let fullText = '';
  const segments: TranscriptionSegment[] = [];
  let timeOffset = 0;

  for (let i = 0; i < audioChunks.length; i++) {
    const blob = new Blob([audioChunks[i]], { type: 'audio/webm' });
    try {
      const result = await transcribeChunk(blob, 'webm', i);
      const trimmed = result.text.trim();

      if (fullText && trimmed) fullText += ' ';
      fullText += trimmed;

      if (trimmed) {
        segments.push({
          id: segments.length,
          start: timeOffset,
          end: timeOffset + result.duration,
          text: trimmed,
        });
      }
      timeOffset += result.duration;
    } catch (error) {
      console.error(`[Transcription] Failed to transcribe chunk ${i}:`, error);
    }
  }

  console.log(
    `[Transcription] Completed. Duration: ${timeOffset.toFixed(1)}s, Segments: ${segments.length}`
  );

  return {
    text: fullText.trim(),
    segments,
    duration: timeOffset,
  };
}

/**
 * Fallback for when no pre-recorded audio chunks are available: send the
 * video container directly. Whisper extracts the audio track. Limited to
 * ~25 MB to stay safely within the upstream provider's timeout.
 */
export async function transcribeVideo(videoData: ArrayBuffer): Promise<TranscriptionResult | null> {
  if (!isTranscriptionAvailable()) {
    console.log('[Transcription] Skipping - no OpenRouter API key configured');
    return null;
  }

  const videoBlob = new Blob([videoData], { type: 'video/webm' });
  if (videoBlob.size > MAX_FILE_SIZE) {
    console.warn(
      `[Transcription] Video too large (${(videoBlob.size / 1024 / 1024).toFixed(0)} MB) and no audio chunks available. Transcription skipped.`
    );
    return null;
  }

  try {
    console.log('[Transcription] Transcribing video directly (small file)...');
    const result = await transcribeChunk(videoBlob, 'webm', 0);
    const trimmed = result.text.trim();
    return {
      text: trimmed,
      segments: trimmed
        ? [{ id: 0, start: 0, end: result.duration, text: trimmed }]
        : [],
      duration: result.duration,
    };
  } catch (error) {
    console.error('[Transcription] Failed:', error);
    return null;
  }
}

export function formatAsSRT(segments: TranscriptionSegment[]): string {
  return segments
    .map((segment, index) => {
      const startTime = formatSRTTime(segment.start);
      const endTime = formatSRTTime(segment.end);
      return `${index + 1}\n${startTime} --> ${endTime}\n${segment.text.trim()}\n`;
    })
    .join('\n');
}

export function formatAsVTT(segments: TranscriptionSegment[]): string {
  const lines = ['WEBVTT', ''];
  for (const segment of segments) {
    const startTime = formatVTTTime(segment.start);
    const endTime = formatVTTTime(segment.end);
    lines.push(`${startTime} --> ${endTime}`);
    lines.push(segment.text.trim());
    lines.push('');
  }
  return lines.join('\n');
}

export function formatAsReadableText(segments: TranscriptionSegment[]): string {
  const lines = ['# Audio Transcription', ''];
  for (const segment of segments) {
    const timestamp = formatReadableTime(segment.start);
    lines.push(`[${timestamp}] ${segment.text.trim()}`);
  }
  return lines.join('\n');
}

function formatSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
}

function formatVTTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(ms, 3)}`;
}

function formatReadableTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${pad(minutes, 2)}:${pad(secs, 2)}`;
}

function pad(num: number, size: number): string {
  return num.toString().padStart(size, '0');
}
