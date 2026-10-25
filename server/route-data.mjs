const COUNTABLE_STATUSES = new Set(['available', 'empty', 'stale']);

export function getCorridorMetric(result, count) {
  const status = result?.status || 'error';
  const hasUsableData = COUNTABLE_STATUSES.has(status);
  return {
    count: hasUsableData ? count : null,
    status,
    updatedAt: result?.updatedAt || '',
    note: result?.note || '',
  };
}

export function formatCorridorMetric(label, metric) {
  if (metric.count === null) return `${label}資料暫不可用`;
  const countLabel = `${metric.count} 筆${label}`;
  return metric.status === 'stale' ? `${countLabel}（使用快取資料）` : countLabel;
}
