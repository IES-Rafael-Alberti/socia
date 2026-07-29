import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecordedAudioChunk } from './db';
import {
  buildTranscriptionRequest,
  formatAsSRT,
  transcribeAudioChunks,
} from './transcription';

function chunk(index: number, start: number, end: number): RecordedAudioChunk {
  return {
    index,
    start,
    end,
    data: new ArrayBuffer(1),
  };
}

test('requests word and segment timestamps from OpenRouter', () => {
  const request = buildTranscriptionRequest('audio-data', 'webm');

  assert.equal(request.response_format, 'verbose_json');
  assert.deepEqual(request.timestamp_granularities, ['word', 'segment']);
});

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

test('moves provider segment and word times onto the recording timeline', async () => {
  const result = await transcribeAudioChunks(
    [chunk(0, 300, 360)],
    'test-key',
    async () => ({
      text: 'Hola mundo',
      duration: 60,
      segments: [
        {
          start: 1.25,
          end: 2.75,
          text: 'Hola mundo',
        },
      ],
      words: [
        { word: 'Hola', start: 1.25, end: 1.7 },
        { word: 'mundo', start: 2, end: 2.75 },
      ],
    })
  );

  assert.ok(result);
  assert.deepEqual(result.segments, [
    {
      id: 0,
      start: 301.25,
      end: 302.75,
      text: 'Hola mundo',
    },
  ]);
  assert.deepEqual(result.words, [
    { word: 'Hola', start: 301.25, end: 301.7 },
    { word: 'mundo', start: 302, end: 302.75 },
  ]);
});

test('keeps provider timestamps inside each recorded chunk', async () => {
  const result = await transcribeAudioChunks(
    [chunk(0, 10, 20)],
    'test-key',
    async () => ({
      text: 'Prueba',
      duration: 12,
      segments: [{ start: -1, end: 12, text: 'Prueba' }],
      words: [{ word: 'Prueba', start: 9, end: 12 }],
    })
  );

  assert.ok(result);
  assert.deepEqual(result.segments[0], {
    id: 0,
    start: 10,
    end: 20,
    text: 'Prueba',
  });
  assert.deepEqual(result.words[0], {
    word: 'Prueba',
    start: 19,
    end: 20,
  });
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
