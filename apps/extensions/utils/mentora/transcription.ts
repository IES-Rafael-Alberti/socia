/**
 * Audio transcription via OpenRouter.
 *
 * The endpoint returns only `{ text, usage }` — no segment-level timestamps.
 * We emit one SRT entry per audio chunk using `usage.seconds` as duration,
 * with capture times saved alongside each chunk. These are coarse anchors,
 * not synchronised subtitles.
 */

import type { RecordedAudioChunk } from './db';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
const TRANSCRIPTION_MODEL =
  (import.meta.env.EXT_OPENROUTER_MODEL_TRANSCRIPTION as string | undefined) ??
  'openai/whisper-large-v3-turbo';
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 75_000;
const MAX_ATTEMPTS = 3;

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
  attemptedChunks: number;
  transcribedChunks: number;
  failures: TranscriptionFailure[];
}

export interface TranscriptionFailure {
  chunkIndex: number;
  error: string;
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

class TranscriptionHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function transcribeChunk(
  chunk: Blob,
  format: 'webm' | 'wav' | 'mp3' | 'ogg',
  chunkIndex: number,
  apiKey: string
): Promise<{ text: string; duration: number }> {
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  console.log(
    `[Transcription] Encoding chunk ${chunkIndex + 1} (${(chunk.size / 1024 / 1024).toFixed(2)} MB)...`
  );
  const data = await blobToBase64(chunk);

  console.log(`[Transcription] Sending chunk ${chunkIndex + 1} to OpenRouter (${TRANSCRIPTION_MODEL})...`);
  let response: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://socia-extension.local',
          'X-Title': 'MENTORA',
        },
        body: JSON.stringify({
          model: TRANSCRIPTION_MODEL,
          input_audio: { data, format },
          language: 'es',
        }),
        signal: controller.signal,
      });

      if (response.ok) break;

      const errorBody = (await response.text()).slice(0, 1000);
      const error = new TranscriptionHttpError(
        response.status,
        `OpenRouter transcription error: ${response.status} - ${errorBody}`
      );
      if (!isRetryableStatus(response.status)) throw error;
      lastError = error;
    } catch (error) {
      if (error instanceof TranscriptionHttpError && !isRetryableStatus(error.status)) {
        throw error;
      }
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < MAX_ATTEMPTS) {
      await wait(500 * 2 ** (attempt - 1));
    }
  }

  if (!response?.ok) {
    throw lastError instanceof Error ? lastError : new Error('OpenRouter transcription failed');
  }

  const result = (await response.json()) as {
    text?: unknown;
    usage?: { seconds?: unknown; cost?: unknown };
  };
  const text = typeof result.text === 'string' ? result.text : '';
  const duration =
    typeof result.usage?.seconds === 'number' && Number.isFinite(result.usage.seconds)
      ? result.usage.seconds
      : 0;
  console.log(`[Transcription] Chunk ${chunkIndex + 1} response:`, {
    text: text.substring(0, 100),
    duration,
    cost: result.usage?.cost,
  });

  return {
    text,
    duration,
  };
}

/**
 * Transcribe pre-recorded audio chunks (webm/opus, about one minute each).
 * Each chunk yields a single SRT segment spanning its full duration.
 */
export async function transcribeAudioChunks(
  audioChunks: RecordedAudioChunk[],
  apiKey: string
): Promise<TranscriptionResult | null> {
  if (!apiKey) {
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
  const failures: TranscriptionFailure[] = [];
  let timelineEnd = 0;
  let transcribedChunks = 0;

  for (let i = 0; i < audioChunks.length; i++) {
    const chunk = audioChunks[i];
    const blob = new Blob([chunk.data], { type: 'audio/webm' });
    const hasCaptureTimes = chunk.end > chunk.start;
    const start = hasCaptureTimes ? chunk.start : timelineEnd;
    try {
      const result = await transcribeChunk(blob, 'webm', i, apiKey);
      const trimmed = result.text.trim();
      const end = hasCaptureTimes ? chunk.end : start + result.duration;
      timelineEnd = Math.max(timelineEnd, end);
      transcribedChunks += 1;

      if (fullText && trimmed) fullText += ' ';
      fullText += trimmed;

      if (trimmed) {
        segments.push({
          id: segments.length,
          start,
          end,
          text: trimmed,
        });
      }
    } catch (error) {
      console.error(`[Transcription] Failed to transcribe chunk ${i}:`, error);
      timelineEnd = Math.max(timelineEnd, hasCaptureTimes ? chunk.end : start);
      failures.push({
        chunkIndex: chunk.index,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    `[Transcription] Completed. Duration: ${timelineEnd.toFixed(1)}s, Segments: ${segments.length}`
  );

  return {
    text: fullText.trim(),
    segments,
    duration: timelineEnd,
    attemptedChunks: audioChunks.length,
    transcribedChunks,
    failures,
  };
}

/**
 * Fallback for when no pre-recorded audio chunks are available: send the
 * video container directly. Whisper extracts the audio track. Limited to
 * ~25 MB to stay safely within the upstream provider's timeout.
 */
export async function transcribeVideo(
  videoData: ArrayBuffer,
  apiKey: string
): Promise<TranscriptionResult | null> {
  if (!apiKey) {
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
    const result = await transcribeChunk(videoBlob, 'webm', 0, apiKey);
    const trimmed = result.text.trim();
    return {
      text: trimmed,
      segments: trimmed
        ? [{ id: 0, start: 0, end: result.duration, text: trimmed }]
        : [],
      duration: result.duration,
      attemptedChunks: 1,
      transcribedChunks: 1,
      failures: [],
    };
  } catch (error) {
    console.error('[Transcription] Failed:', error);
    return {
      text: '',
      segments: [],
      duration: 0,
      attemptedChunks: 1,
      transcribedChunks: 0,
      failures: [
        {
          chunkIndex: 0,
          error: error instanceof Error ? error.message : String(error),
        },
      ],
    };
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
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
}

function formatVTTTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
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
