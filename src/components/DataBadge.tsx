import type { Confidence, DataStatus } from '../types/transit';

const statusLabels: Record<DataStatus, string> = {
  available: '資料正常',
  loading: '載入中',
  empty: '目前無資料',
  stale: '資料已過期',
  error: '連線錯誤',
  unavailable: '尚未設定憑證',
};
const confidenceLabels: Record<Confidence, string> = {
  'official-live': '警廣即時資料',
  live: 'TDX 即時資料',
  scheduled: '官方班表資料',
  'official-static': '官方靜態清冊',
  estimated: '推估資料',
  demo: 'Demo 示範資料',
};
export function DataBadge({ status = 'available', confidence = 'demo' }: { status?: DataStatus; confidence?: Confidence }) {
  const label = status === 'available' ? confidenceLabels[confidence] ?? statusLabels.available : statusLabels[status];
  return <span className={`data-badge data-${status}`}><i aria-hidden="true" />{label}</span>;
}
