import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NETWORK_BODY_LIMIT,
  captureText,
  getFetchRequestDetails,
  isSensitiveInputField,
  sanitizeNetworkCaptureMessage,
  sanitizeNetworkUrl,
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
  const original =
    '{"password":"one","access_token":"two"}&api_key=three&name=visible';
  const body = captureText(original);

  assert.equal(body.originalLength, original.length);
  assert.equal(body.value?.includes('one'), false);
  assert.equal(body.value?.includes('two'), false);
  assert.equal(body.value?.includes('three'), false);
  assert.equal(body.value?.includes('name=visible'), true);
});

test('keeps useful SOC fields while redacting nested credentials', () => {
  const body = captureText(
    JSON.stringify({
      alert_id: 'alert-42',
      source_ip: '10.0.0.8',
      user: 'analyst@example.test',
      filters: { query: 'event.code:4625' },
      auth: { accessToken: 'secret-token', expires_in: 3600 },
    }),
    { contentType: 'application/json', url: 'https://soc.test/api/cases' }
  );

  assert.match(body.value ?? '', /alert-42/);
  assert.match(body.value ?? '', /10\.0\.0\.8/);
  assert.match(body.value ?? '', /analyst@example\.test/);
  assert.match(body.value ?? '', /event\.code:4625/);
  assert.doesNotMatch(body.value ?? '', /secret-token/);
  assert.deepEqual(body.redactions, ['$.auth.accessToken']);
});

test('redacts authentication codes without removing ordinary case codes', () => {
  const auth = captureText('{"code":"login-code"}', {
    contentType: 'application/json',
    url: 'https://soc.test/oauth/callback',
  });
  const incident = captureText('{"code":"CASE-1042"}', {
    contentType: 'application/json',
    url: 'https://soc.test/api/incidents',
  });

  assert.doesNotMatch(auth.value ?? '', /login-code/);
  assert.match(incident.value ?? '', /CASE-1042/);
});

test('redacts URL credentials and preserves routes and useful parameters', () => {
  const result = sanitizeNetworkUrl(
    'https://soc.test/api/alerts?id=42&access_token=secret#/case/42?view=full&signature=signed'
  );

  assert.ok(result);
  assert.match(result.value, /id=42/);
  assert.match(result.value, /case\/42/);
  assert.match(result.value, /view=full/);
  assert.doesNotMatch(result.value, /secret|signed/);
  assert.deepEqual(result.redactions, ['$.signature', 'query.access_token']);
});

test('redacts secrets in form and XML bodies with a visible marker', () => {
  const form = captureText('username=david&password=secret&alert_id=42', {
    contentType: 'application/x-www-form-urlencoded',
  });
  const xml = captureText(
    '<login token="secret"><password>hidden</password><user>david</user></login>',
    { contentType: 'application/xml' }
  );

  assert.match(form.value ?? '', /password=\[REDACTED\]/);
  assert.match(form.value ?? '', /alert_id=42/);
  assert.doesNotMatch(form.value ?? '', /secret/);
  assert.match(xml.value ?? '', /token="\[REDACTED\]"/);
  assert.match(xml.value ?? '', /<password>\[REDACTED\]<\/password>/);
  assert.match(xml.value ?? '', /<user>david<\/user>/);
});

test('detects sensitive input fields without hiding ordinary identifiers', () => {
  assert.equal(
    isSensitiveInputField({ autocomplete: 'one-time-code', value: '123456' }),
    true
  );
  assert.equal(
    isSensitiveInputField({ name: 'apiKey', value: 'sk-or-v1-secret' }),
    true
  );
  assert.equal(
    isSensitiveInputField({ name: 'alert_id', value: 'alert-42' }),
    false
  );
});

test('validates and bounds page-provided network messages', () => {
  const sanitized = sanitizeNetworkCaptureMessage(
    {
      type: 'MENTORA_NETWORK_EVENT',
      phase: 'finish',
      requestId: 'request-1',
      source: 'fetch',
      startedAt: 1,
      finishedAt: 2,
      documentUrl: 'https://soc.test/cases',
      method: 'POST',
      url: 'https://soc.test/api/cases',
      contentType: 'application/json',
      requestBody: { value: 'x'.repeat(NETWORK_BODY_LIMIT + 10) },
      outcome: 'completed',
    },
    'https://soc.test/api/cases'
  );

  assert.ok(sanitized);
  assert.equal(sanitized.requestBody?.truncated, true);
  assert.equal(sanitized.requestBody?.value?.endsWith('...[truncated]'), true);
  assert.equal(
    sanitizeNetworkCaptureMessage(
      {
        phase: 'finish',
        requestId: 'x'.repeat(129),
        source: 'fetch',
        startedAt: 1,
        documentUrl: 'https://soc.test',
        method: 'GET',
        url: 'https://soc.test',
      },
      'https://soc.test'
    ),
    null
  );
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
