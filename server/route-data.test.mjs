import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCorridorMetric, getCorridorMetric } from './route-data.mjs';

test('does not present an unavailable road feed as zero corridor events', () => {
  const metric = getCorridorMetric({ status: 'error', updatedAt: '' }, 0);
  assert.equal(metric.count, null);
  assert.equal(metric.status, 'error');
  assert.equal(formatCorridorMetric('即時路況', metric), '即時路況資料暫不可用');
});

test('keeps a confirmed empty result distinct from an unavailable feed', () => {
  const metric = getCorridorMetric({ status: 'empty', updatedAt: '2026-10-26 10:00' }, 0);
  assert.equal(metric.count, 0);
  assert.equal(formatCorridorMetric('即時路況', metric), '0 筆即時路況');
});

test('labels cached corridor counts as stale data', () => {
  const metric = getCorridorMetric({ status: 'stale', updatedAt: '2026-10-26 09:30' }, 3);
  assert.equal(metric.count, 3);
  assert.equal(formatCorridorMetric('即時路況', metric), '3 筆即時路況（使用快取資料）');
});
