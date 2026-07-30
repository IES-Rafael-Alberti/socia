import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isOpenRouterKeyFormatValid,
  validateOpenRouterKey,
} from './openrouter-validation';

function responseFetcher(status: number, body: unknown = {}) {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}

test('accepts trimmed keys that start with sk-', () => {
  assert.equal(isOpenRouterKeyFormatValid(' sk-or-v1-test '), true);
  assert.equal(isOpenRouterKeyFormatValid('or-v1-test'), false);
  assert.equal(isOpenRouterKeyFormatValid(''), false);
});

test('accepts a valid key with a remaining limit', async () => {
  const result = await validateOpenRouterKey(
    'sk-or-v1-test',
    responseFetcher(200, { data: { limit_remaining: 4.5 } })
  );

  assert.deepEqual(result, { status: 'valid', limitRemaining: 4.5 });
});

test('accepts a valid key without its own limit', async () => {
  const result = await validateOpenRouterKey(
    'sk-or-v1-test',
    responseFetcher(200, { data: { limit_remaining: null } })
  );

  assert.deepEqual(result, { status: 'valid', limitRemaining: null });
});

test('reports an exhausted key from its remaining limit', async () => {
  const result = await validateOpenRouterKey(
    'sk-or-v1-test',
    responseFetcher(200, { data: { limit_remaining: 0 } })
  );

  assert.deepEqual(result, { status: 'exhausted', limitRemaining: 0 });
});

test('classifies authentication and credit errors', async () => {
  const invalid = await validateOpenRouterKey(
    'sk-or-v1-test',
    responseFetcher(401)
  );
  const forbidden = await validateOpenRouterKey(
    'sk-or-v1-test',
    responseFetcher(403)
  );
  const exhausted = await validateOpenRouterKey(
    'sk-or-v1-test',
    responseFetcher(402)
  );

  assert.equal(invalid.status, 'invalid');
  assert.equal(forbidden.status, 'invalid');
  assert.equal(exhausted.status, 'exhausted');
});

test('reports server and network failures as unavailable', async () => {
  const serverFailure = await validateOpenRouterKey(
    'sk-or-v1-test',
    responseFetcher(500)
  );
  const networkFailure = await validateOpenRouterKey(
    'sk-or-v1-test',
    (async () => {
      throw new TypeError('Network error');
    }) as typeof fetch
  );

  assert.equal(serverFailure.status, 'unavailable');
  assert.equal(networkFailure.status, 'unavailable');
});

test('rejects a malformed key without making a request', async () => {
  let requested = false;
  const result = await validateOpenRouterKey(
    'wrong-key',
    (async () => {
      requested = true;
      return new Response();
    }) as typeof fetch
  );

  assert.equal(result.status, 'invalid');
  assert.equal(requested, false);
});
