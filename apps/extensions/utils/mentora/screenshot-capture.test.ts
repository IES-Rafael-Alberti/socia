import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canCaptureScreenshot,
  SCREENSHOT_CAPTURE_INTERVAL_MS,
} from './screenshot-capture';

test('allows screenshots of active HTTP pages', () => {
  assert.equal(
    canCaptureScreenshot({ active: true, url: 'https://example.test/dashboard' }, null, 1000),
    true
  );
});

test('rejects tabs without a supported page URL', () => {
  assert.equal(canCaptureScreenshot({ active: true, url: '' }, null, 1000), false);
  assert.equal(
    canCaptureScreenshot({ active: true, url: 'chrome://extensions' }, null, 1000),
    false
  );
  assert.equal(
    canCaptureScreenshot({ active: false, url: 'https://example.test' }, null, 1000),
    false
  );
});

test('keeps screenshot calls below the Chrome rate limit', () => {
  const tab = { active: true, url: 'https://example.test' };

  assert.equal(canCaptureScreenshot(tab, 1000, 1200), false);
  assert.equal(
    canCaptureScreenshot(tab, 1000, 1000 + SCREENSHOT_CAPTURE_INTERVAL_MS),
    true
  );
});
