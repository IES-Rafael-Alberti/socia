import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { exportToZip } from './zip-export';
import type { RecordingMetadata } from './messages';

const metadata: RecordingMetadata = {
  extensionName: 'MENTORA',
  version: '1.0.0',
  recordingId: 'recording-test',
  startTime: Date.UTC(2026, 7, 8),
  duration: 1_000,
  totalActions: 0,
  totalScreenshots: 0,
  pages: [],
};

test('keeps incremental video chunks in order', async () => {
  const stages: string[] = [];
  const zipBlob = await exportToZip(
    { ...metadata },
    [],
    [],
    [new Uint8Array([1, 2]).buffer, new Uint8Array([3, 4]).buffer],
    undefined,
    [],
    [],
    undefined,
    (stage) => {
      stages.push(stage);
    }
  );

  const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
  const video = zip.file(/video\.webm$/)[0];

  assert.ok(video);
  assert.deepEqual(
    Array.from(await video.async('uint8array')),
    [1, 2, 3, 4]
  );
  assert.deepEqual(stages, ['packaging']);
});

test('keeps support for a legacy final video', async () => {
  const zipBlob = await exportToZip(
    { ...metadata },
    [],
    [],
    [new Uint8Array([9]).buffer],
    new Uint8Array([5, 6, 7]).buffer
  );

  const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
  const video = zip.file(/video\.webm$/)[0];

  assert.ok(video);
  assert.deepEqual(Array.from(await video.async('uint8array')), [5, 6, 7]);
});
