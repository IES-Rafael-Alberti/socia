import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NETWORK_BODY_LIMIT,
  captureText,
  getFetchRequestDetails,
  serializeNetworkBody,
  shouldRelayNetworkCapture,
  type NetworkCaptureMessage,
} from './network-capture';

test('truncates bodies at 16 KiB and reports their original length', () => {
  const body = captureText('x'.repeat(NETWORK_BODY_LIMIT + 10));

  assert.equal(body.originalLength, NETWORK_BODY_LIMIT + 10);
  assert.equal(body.truncated, true);
  assert.equal(body.value?.endsWith('...[truncated]'), true);
});

test('redacts secrets in JSON and form bodies', () => {
  const body = captureText(
    '{"password":"one","access_token":"two"}&api_key=three&name=visible'
  );

  assert.equal(body.value?.includes('one'), false);
  assert.equal(body.value?.includes('two'), false);
  assert.equal(body.value?.includes('three'), false);
  assert.equal(body.value?.includes('name=visible'), true);
});

test('reads method and body from a Request object', async () => {
  const request = new Request('https://example.test/api/case', {
    method: 'POST',
    body: JSON.stringify({ title: 'Case' }),
  });

  const details = getFetchRequestDetails(request);

  assert.equal(details.method, 'POST');
  assert.equal(details.url, 'https://example.test/api/case');
  assert.equal((await details.body).value, '{"title":"Case"}');
});

test('serializes form fields and safe file metadata', async () => {
  const form = new FormData();
  form.append('title', 'Case');
  form.append('evidence', new Blob(['secret contents'], { type: 'text/plain' }), 'evidence.txt');

  const value = await serializeNetworkBody(form);

  assert.match(value ?? '', /title=Case/);
  assert.match(value ?? '', /name="evidence.txt"/);
  assert.match(value ?? '', /type="text\/plain"/);
  assert.doesNotMatch(value ?? '', /secret contents/);
});

test('keeps failed GET requests without a content type', () => {
  const event: NetworkCaptureMessage = {
    type: 'MENTORA_NETWORK_EVENT',
    phase: 'finish',
    requestId: 'request-1',
    source: 'fetch',
    startedAt: 1,
    finishedAt: 2,
    documentUrl: 'https://example.test',
    method: 'GET',
    url: 'https://example.test/api',
    contentType: '',
    outcome: 'failed',
  };

  assert.equal(shouldRelayNetworkCapture(event, event.url), true);
  assert.equal(
    shouldRelayNetworkCapture({ ...event, outcome: 'completed' }, event.url),
    false
  );
});
