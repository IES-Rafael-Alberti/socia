import assert from 'node:assert/strict';
import test from 'node:test';
import { CaptureQuota, serializedByteLength } from './capture-limits';

test('limits each source without blocking a different tab', () => {
  const quota = new CaptureQuota({ perMinute: 2, maxEvents: 10, maxBytes: 100 });

  assert.equal(quota.tryAccept(1, 1, 1).accepted, true);
  assert.equal(quota.tryAccept(1, 1, 2).accepted, true);
  assert.deepEqual(quota.tryAccept(1, 1, 3), {
    accepted: false,
    reason: 'rate',
  });
  assert.equal(quota.tryAccept(2, 1, 3).accepted, true);
  assert.equal(quota.tryAccept(1, 1, 60_002).accepted, true);
});

test('reports count and byte drops', () => {
  const countQuota = new CaptureQuota({ perMinute: 10, maxEvents: 1, maxBytes: 100 });
  countQuota.tryAccept(1, 10);
  assert.equal(countQuota.tryAccept(1, 10).reason, 'count');
  assert.equal(countQuota.summary().droppedEvents, 1);

  const byteQuota = new CaptureQuota({ perMinute: 10, maxEvents: 10, maxBytes: 5 });
  assert.equal(byteQuota.tryAccept(1, 6).reason, 'bytes');
  assert.equal(byteQuota.summary().droppedBytes, 6);
});

test('measures serialized UTF-8 bytes', () => {
  assert.equal(serializedByteLength('á'), 4);
});
