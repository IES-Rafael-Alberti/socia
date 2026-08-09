import type { RecordedVideoChunk } from './db';

export const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc3.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
] as const;

export function chooseMp4MimeType(
  isSupported: (mimeType: string) => boolean
): string | null {
  return VIDEO_MIME_CANDIDATES.find(isSupported) ?? null;
}

export async function sha256Blob(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface ChunkSetValidation {
  valid: boolean;
  missingSequences: number[];
  totalBytes: number;
  error?: string;
}

export async function validateVideoChunks(
  chunks: RecordedVideoChunk[],
  emittedChunks: number
): Promise<ChunkSetValidation> {
  const bySequence = new Map(chunks.map((chunk) => [chunk.sequence, chunk]));
  const missingSequences: number[] = [];

  for (let sequence = 0; sequence < emittedChunks; sequence += 1) {
    if (!bySequence.has(sequence)) missingSequences.push(sequence);
  }

  let totalBytes = 0;
  for (const chunk of chunks) {
    totalBytes += chunk.blob.size;
    if (chunk.size !== chunk.blob.size) {
      return {
        valid: false,
        missingSequences,
        totalBytes,
        error: `El fragmento ${chunk.sequence} cambió de tamaño al leerlo.`,
      };
    }
    const storedHash = await sha256Blob(chunk.blob);
    if (storedHash !== chunk.sha256) {
      return {
        valid: false,
        missingSequences,
        totalBytes,
        error: `La suma SHA-256 del fragmento ${chunk.sequence} no coincide.`,
      };
    }
  }

  if (missingSequences.length > 0) {
    return {
      valid: false,
      missingSequences,
      totalBytes,
      error: `Faltan ${missingSequences.length} fragmentos de vídeo.`,
    };
  }

  return { valid: true, missingSequences, totalBytes };
}

export function assembleVideo(chunks: RecordedVideoChunk[], mimeType: string): Blob {
  return new Blob(
    [...chunks].sort((a, b) => a.sequence - b.sequence).map((chunk) => chunk.blob),
    { type: mimeType }
  );
}
