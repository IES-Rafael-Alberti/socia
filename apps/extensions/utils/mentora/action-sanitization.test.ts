import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActionLog } from './messages';
import { sanitizeActionLog } from './action-sanitization';
import { ACTION_INPUT_VALUE_LIMIT } from './capture-limits';

function action(overrides: Partial<ActionLog> = {}): ActionLog {
  return {
    id: 'action-1',
    timestamp: 1,
    relativeTime: 0,
    type: 'navigation',
    url: 'https://soc.test/cases?access_token=secret&id=42',
    pageTitle: 'Cases',
    details: {},
    humanReadable:
      'Navigated to https://soc.test/cases?access_token=secret&id=42',
    ...overrides,
  };
}

test('removes credentials from action URLs and readable text', () => {
  const result = sanitizeActionLog(
    action({
      details: {
        toUrl: 'https://soc.test/cases?code=CASE-42&token=secret',
        element: {
          tagName: 'A',
          href: 'https://soc.test/export?signature=signed&id=42',
        },
      },
    })
  );

  assert.doesNotMatch(JSON.stringify(result), /secret|signed/);
  assert.match(result.url, /id=42/);
  assert.match(result.details.toUrl ?? '', /code=CASE-42/);
});

test('removes a forged sensitive input from details and readable text', () => {
  const result = sanitizeActionLog(
    action({
      type: 'input',
      details: {
        inputName: 'api_key',
        inputValue: 'sk-forged-secret-value',
      },
      humanReadable: "Typed 'sk-forged-secret-value' in API key",
    })
  );

  assert.equal(result.details.inputValue, '[REDACTED]');
  assert.doesNotMatch(result.humanReadable, /sk-forged-secret-value/);
});

test('bounds action fields and removes unknown data before storage', () => {
  const forged = action({
    type: 'input',
    details: {
      inputName: 'query',
      inputValue: 'x'.repeat(ACTION_INPUT_VALUE_LIMIT + 100),
    },
  }) as ActionLog & { extra: string };
  forged.extra = 'untrusted';

  const result = sanitizeActionLog(forged);

  assert.equal(result.details.inputValue?.length, ACTION_INPUT_VALUE_LIMIT);
  assert.equal('extra' in result, false);
});
