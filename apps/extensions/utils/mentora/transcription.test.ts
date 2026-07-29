import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecordedAudioChunk } from './db';
import { formatAsSRT, transcribeAudioChunks } from './transcription';

function chunk(index: number, start: number, end: number): RecordedAudioChunk {
  return {
    index,
    start,
    end,
    data: new ArrayBuffer(1),
  };
}

test('keeps capture times when a middle chunk fails', async () => {
  const chunks = [
    chunk(0, 0, 60),
    chunk(1, 60, 120),
    chunk(2, 120, 180),
  ];

  const result = await transcribeAudioChunks(
    chunks,
    'test-key',
    async (_blob, _format, index) => {
      if (index === 1) throw new Error('temporary error');
      return {
        text: `chunk ${index}`,
        duration: 60,
      };
    }
  );

  assert.ok(result);
  assert.deepEqual(
    result.segments.map(({ start, end }) => ({ start, end })),
    [
      { start: 0, end: 60 },
      { start: 120, end: 180 },
    ]
  );
  assert.equal(result.duration, 180);
  assert.deepEqual(result.failures.map((failure) => failure.chunkIndex), [1]);
});

test('uses reported duration for old chunks without capture times', async () => {
  const chunks = [
    chunk(0, 0, 0),
    chunk(1, 0, 0),
  ];

  const result = await transcribeAudioChunks(
    chunks,
    'test-key',
    async (_blob, _format, index) => ({
      text: `chunk ${index}`,
      duration: index === 0 ? 10 : 12,
    })
  );

  assert.ok(result);
  assert.deepEqual(
    result.segments.map(({ start, end }) => ({ start, end })),
    [
      { start: 0, end: 10 },
      { start: 10, end: 22 },
    ]
  );
});

test('carries rounded milliseconds into the next second', () => {
  const srt = formatAsSRT([
    {
      id: 0,
      start: 1.9996,
      end: 62.0004,
      text: 'Prueba',
    },
  ]);

  assert.match(srt, /00:00:02,000 --> 00:01:02,000/);
});
