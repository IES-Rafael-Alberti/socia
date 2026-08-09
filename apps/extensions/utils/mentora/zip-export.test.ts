import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { exportToZip } from './zip-export';
import type { ActionLog, RecordingMetadata, Screenshot, VideoManifest } from './messages';
import { sha256Blob } from './video-integrity';

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
  const result = await exportToZip(
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

  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
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
    {
      blob: new Blob([new Uint8Array([5, 6, 7])], { type: 'video/webm' }),
      mimeType: 'video/webm',
      filename: 'video.webm',
    }
  );

  const zip = await JSZip.loadAsync(await zipBlob.blob.arrayBuffer());
  const video = zip.file(/video\.webm$/)[0];

  assert.ok(video);
  assert.deepEqual(Array.from(await video.async('uint8array')), [5, 6, 7]);
});

test('exports a validated MP4 with its manifest', async () => {
  const manifest: VideoManifest = {
    version: 1,
    recordingId: metadata.recordingId,
    mimeType: 'video/mp4',
    activeDurationMs: 1_000,
    pausedDurationMs: 0,
    emittedChunks: 1,
    storedChunks: 1,
    totalBytes: 3,
    stopReason: 'user',
    status: 'valid',
    missingSequences: [],
    chunks: [],
  };
  const result = await exportToZip(
    { ...metadata, videoCapture: { ...manifest, format: 'mp4', manifestFile: 'video-manifest.json' } },
    [],
    [],
    [],
    { blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }), mimeType: 'video/mp4', filename: 'video.mp4' },
    [],
    [],
    undefined,
    undefined,
    manifest
  );
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  assert.equal(result.artifactKind, 'recording');
  assert.ok(zip.file(/video\.mp4$/)[0]);
  assert.ok(zip.file(/video-manifest\.json$/)[0]);
});

test('creates a recovery package for an invalid MP4', async () => {
  const blob = new Blob([new Uint8Array([7, 8])], { type: 'video/mp4' });
  const manifest: VideoManifest = {
    version: 1,
    recordingId: metadata.recordingId,
    mimeType: 'video/mp4',
    activeDurationMs: 1_000,
    pausedDurationMs: 0,
    emittedChunks: 2,
    storedChunks: 1,
    totalBytes: 2,
    stopReason: 'user',
    status: 'recovery',
    missingSequences: [1],
    validationError: 'Falta el fragmento 1.',
    chunks: [],
  };
  const result = await exportToZip(
    { ...metadata, videoCapture: { ...manifest, format: 'mp4', manifestFile: 'video-manifest.json' } },
    [],
    [],
    [{ sequence: 0, blob, timecodeMs: 0, size: 2, mimeType: 'video/mp4', sha256: await sha256Blob(blob), attempts: 1 }],
    undefined,
    [],
    [],
    undefined,
    undefined,
    manifest
  );
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  assert.equal(result.artifactKind, 'recovery');
  assert.ok(zip.file(/RECOVERY\.md$/)[0]);
  assert.ok(zip.file(/recovery\/video-unverified\.mp4$/)[0]);
  assert.ok(zip.file(/recovery\/chunks\/000000\.mp4part$/)[0]);
  assert.equal(zip.file(/\/video\.mp4$/).length, 0);
});

test('infers a recovery package when the capture context closed before validation', async () => {
  const blob = new Blob([new Uint8Array([4, 5])], { type: 'video/mp4' });
  const result = await exportToZip(
    { ...metadata },
    [],
    [],
    [{
      sequence: 0,
      blob,
      timecodeMs: 0,
      size: blob.size,
      mimeType: 'video/mp4',
      sha256: await sha256Blob(blob),
      attempts: 1,
    }]
  );
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const manifestFile = zip.file(/video-manifest\.json$/)[0];

  assert.equal(result.artifactKind, 'recovery');
  assert.ok(manifestFile);
  assert.equal(JSON.parse(await manifestFile.async('string')).stopReason, 'context-restarted');
});

test('rewrites screenshot references and recovers pages from actions', async () => {
  const action: ActionLog = {
    id: 'action-1',
    timestamp: 10,
    relativeTime: 1,
    type: 'click',
    url: 'https://example.test/case',
    pageTitle: 'Case',
    details: { screenshotId: 'screenshot_11.png' },
    humanReadable: 'Clicked',
  };
  const screenshot: Screenshot = {
    id: 'screenshot_11.png',
    timestamp: 11,
    relativeTime: 1,
    dataUrl: 'data:image/png;base64,AA==',
    actionId: action.id,
  };
  const result = await exportToZip({ ...metadata }, [action], [screenshot], [], undefined);
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const activityFile = zip.file(/activity-log\.json$/)[0];
  const metadataFile = zip.file(/metadata\.json$/)[0];
  assert.ok(activityFile && metadataFile);
  const activity = JSON.parse(await activityFile.async('string'));
  const exportedMetadata = JSON.parse(await metadataFile.async('string'));
  assert.equal(activity.actions[0].details.screenshotId, 'click_001_11.png');
  assert.deepEqual(exportedMetadata.pages, ['https://example.test/case']);
});
