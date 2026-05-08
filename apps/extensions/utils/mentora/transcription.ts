/**
 * Audio transcription using OpenAI Whisper API
 *
 * Handles long recordings by extracting audio via Web Audio API,
 * splitting into time-based chunks, and encoding each as WAV.
 */

const OPENAI_API_KEY = import.meta.env.EXT_OPENAI_API_KEY as string | undefined;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB Whisper API limit

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

/**
 * Check if transcription is available (API key configured)
 */
export function isTranscriptionAvailable(): boolean {
  return !!OPENAI_API_KEY && OPENAI_API_KEY.startsWith('sk-');
}


/**
 * Transcribe a single audio chunk using Whisper API
 */
async function transcribeChunk(
  chunk: Blob,
  chunkIndex: number,
  filename: string
): Promise<{ text: string; segments: TranscriptionSegment[]; duration: number }> {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const formData = new FormData();
  formData.append('file', chunk, filename);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  console.log(`[Transcription] Transcribing chunk ${chunkIndex + 1} (${(chunk.size / 1024 / 1024).toFixed(2)} MB)...`);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[Transcription] API error:`, error);
    throw new Error(`Whisper API error: ${response.status} - ${error}`);
  }

  const result = await response.json();

  console.log(`[Transcription] API response:`, {
    text: result.text?.substring(0, 100),
    segmentsCount: result.segments?.length,
    duration: result.duration,
    language: result.language,
  });

  if (result.text && (!result.segments || result.segments.length === 0)) {
    return {
      text: result.text,
      duration: result.duration || 0,
      segments: [{ id: 0, start: 0, end: result.duration || 0, text: result.text }],
    };
  }

  return {
    text: result.text || '',
    duration: result.duration || 0,
    segments: (result.segments || []).map(
      (seg: { id: number; start: number; end: number; text: string }) => ({
        id: seg.id,
        start: seg.start,
        end: seg.end,
        text: seg.text,
      })
    ),
  };
}

/**
 * Transcribe pre-recorded audio chunks (webm/opus, ~10 min each).
 * Each chunk was recorded during capture and is already a valid audio file.
 */
export async function transcribeAudioChunks(audioChunks: ArrayBuffer[]): Promise<TranscriptionResult | null> {
  if (!isTranscriptionAvailable()) {
    console.log('[Transcription] Skipping - no API key configured');
    return null;
  }

  if (audioChunks.length === 0) {
    console.log('[Transcription] No audio chunks to transcribe');
    return null;
  }

  try {
    console.log(`[Transcription] Starting transcription of ${audioChunks.length} audio chunks...`);

    let fullText = '';
    const allSegments: TranscriptionSegment[] = [];
    let timeOffset = 0;
    let segmentIdOffset = 0;

    for (let i = 0; i < audioChunks.length; i++) {
      const blob = new Blob([audioChunks[i]], { type: 'audio/webm' });
      const filename = `audio_chunk_${i}.webm`;

      try {
        console.log(`[Transcription] Processing chunk ${i + 1}/${audioChunks.length}, offset=${timeOffset.toFixed(1)}s, size=${(blob.size / 1024).toFixed(0)} KB`);
        const result = await transcribeChunk(blob, i, filename);

        console.log(`[Transcription] Chunk ${i + 1} result: text="${result.text?.substring(0, 50)}...", segments=${result.segments.length}, duration=${result.duration.toFixed(1)}s`);

        if (fullText && result.text) {
          fullText += ' ';
        }
        fullText += result.text;

        for (const segment of result.segments) {
          allSegments.push({
            id: segmentIdOffset + segment.id,
            start: segment.start + timeOffset,
            end: segment.end + timeOffset,
            text: segment.text,
          });
        }

        // Use the actual duration reported by Whisper for accurate offset
        timeOffset += result.duration;
        segmentIdOffset = allSegments.length;
      } catch (error) {
        console.error(`[Transcription] Failed to transcribe chunk ${i}:`, error);
      }
    }

    const duration =
      allSegments.length > 0 ? allSegments[allSegments.length - 1].end : 0;

    console.log(`[Transcription] Completed. Duration: ${duration.toFixed(1)}s, Segments: ${allSegments.length}`);

    return {
      text: fullText.trim(),
      segments: allSegments,
      duration,
    };
  } catch (error) {
    console.error('[Transcription] Failed:', error);
    return null;
  }
}

/**
 * Transcribe video audio using OpenAI Whisper.
 * Fallback for when no pre-recorded audio chunks are available.
 * Works for short recordings (< 25MB). For longer recordings, use transcribeAudioChunks.
 */
export async function transcribeVideo(videoData: ArrayBuffer): Promise<TranscriptionResult | null> {
  if (!isTranscriptionAvailable()) {
    console.log('[Transcription] Skipping - no API key configured');
    return null;
  }

  const videoBlob = new Blob([videoData], { type: 'video/webm' });
  if (videoBlob.size > MAX_FILE_SIZE) {
    console.warn(`[Transcription] Video too large (${(videoBlob.size / 1024 / 1024).toFixed(0)} MB) and no audio chunks available. Transcription skipped.`);
    return null;
  }

  try {
    console.log('[Transcription] Transcribing video directly (small file)...');
    const result = await transcribeChunk(videoBlob, 0, 'audio.webm');
    return {
      text: result.text,
      segments: result.segments,
      duration: result.duration,
    };
  } catch (error) {
    console.error('[Transcription] Failed:', error);
    return null;
  }
}

/**
 * Format transcription as SRT subtitles
 */
export function formatAsSRT(segments: TranscriptionSegment[]): string {
  return segments.map((segment, index) => {
    const startTime = formatSRTTime(segment.start);
    const endTime = formatSRTTime(segment.end);
    return `${index + 1}\n${startTime} --> ${endTime}\n${segment.text.trim()}\n`;
  }).join('\n');
}

/**
 * Format transcription as VTT subtitles
 */
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

/**
 * Format transcription as readable text with timestamps
 */
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
