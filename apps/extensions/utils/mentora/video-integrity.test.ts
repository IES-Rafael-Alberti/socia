import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecordedVideoChunk } from './db';
import {
  assembleVideo,
  chooseMp4MimeType,
  sha256Blob,
  validateVideoChunks,
} from './video-integrity';

async function chunk(sequence: number, bytes: number[]): Promise<RecordedVideoChunk> {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' });
  return {
    sequence,
    blob,
    timecodeMs: sequence * 1_000,
    size: blob.size,
    mimeType: blob.type,
    sha256: await sha256Blob(blob),
    attempts: 1,
  };
}

test('prefers avc3 and falls back to avc1', () => {
  assert.match(chooseMp4MimeType(() => true) ?? '', /avc3/);
  assert.match(chooseMp4MimeType((mime) => mime.includes('avc1')) ?? '', /avc1/);
  assert.equal(chooseMp4MimeType(() => false), null);
});

test('assembles chunks by capture sequence', async () => {
  const chunks = [await chunk(1, [3, 4]), await chunk(0, [1, 2])];
  const video = assembleVideo(chunks, 'video/mp4');
  assert.deepEqual(Array.from(new Uint8Array(await video.arrayBuffer())), [1, 2, 3, 4]);
});

test('reports missing sequences', async () => {
  const result = await validateVideoChunks([await chunk(0, [1]), await chunk(2, [3])], 3);
  assert.equal(result.valid, false);
  assert.deepEqual(result.missingSequences, [1]);
});

test('detects a changed stored chunk', async () => {
  const original = await chunk(0, [1, 2, 3]);
  const result = await validateVideoChunks(
    [{ ...original, blob: new Blob([new Uint8Array([1, 2, 4])], { type: 'video/mp4' }) }],
    1
  );
  assert.equal(result.valid, false);
  assert.match(result.error ?? '', /SHA-256/);
});
