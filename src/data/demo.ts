import type { DataMeta, Mode, RoadEvent, SpeedCamera, TransitTrip } from '../types/transit';

const meta: DataMeta = { source: 'Island Pulse 示範資料', updatedAt: '2026-10-14 09:42', status: 'available', confidence: 'demo', note: '僅供介面展示，非即時交通資訊' };
export const demoEvents: RoadEvent[] = [
  { id: 'evt-1', kind: 'incident', title: '多車事故', location: '國道一號・內湖交流道附近', direction: '南下，往汐止方向', description: '外側車道事故處理中，請依現場指示減速通行。', severity: 'high', coordinates: [25.062, 121.576], observedAt: '09:36', expectedClearance: '約 10:20', meta },
  { id: 'evt-2', kind: 'roadwork', title: '路面養護施工', location: '市民大道・光華路口', direction: '西向東', description: '夜間刨鋪工程占用一線車道。', severity: 'medium', coordinates: [25.044, 121.532], observedAt: '09:18', expectedClearance: '11:00', meta },
  { id: 'evt-3', kind: 'closure', title: '道路封閉', location: '陽金公路・竹子湖路段', direction: '雙向', description: '路樹倒塌，該路段暫時封閉。', severity: 'high', coordinates: [25.173, 121.543], observedAt: '09:31', meta },
  { id: 'evt-4', kind: 'congestion', title: '車流緩慢', location: '建國高架・忠孝東路出口', direction: '北向南', description: '車多行速緩慢，建議預留通行時間。', severity: 'low', coordinates: [25.041, 121.537], observedAt: '09:40', meta },
  { id: 'evt-5', kind: 'congestion', title: '車流回堵', location: '國道三號・新店交流道', direction: '北上', description: '匝道車流回堵至主線，請留意車距。', severity: 'medium', coordinates: [24.958, 121.537], observedAt: '09:28', meta },
];
export const demoCameras: SpeedCamera[] = [
  { id: 'cam-1', name: '固定式測速照相', road: '台 2 甲線・陽金公路', limitKph: 40, direction: '往陽明山', coordinates: [25.16, 121.55], meta },
  { id: 'cam-2', name: '固定式測速照相', road: '建國高架・民權東路段', limitKph: 60, direction: '南向', coordinates: [25.064, 121.537], meta },
];
const tripMeta: DataMeta = { ...meta, confidence: 'demo' };
export const demoTrips: TransitTrip[] = [
  { id: 't1', mode: '高鐵', route: '南港－左營', origin: '南港', destination: '左營', departure: '10:00', arrival: '11:49', status: '依時刻表示意', meta: tripMeta },
  { id: 't2', mode: '台鐵', route: '自強 121 次', origin: '臺北', destination: '花蓮', departure: '10:15', arrival: '12:27', status: '依時刻表示意', meta: tripMeta },
  { id: 't3', mode: '捷運', route: '淡水信義線', origin: '臺北車站', destination: '象山', departure: '10:02', arrival: '10:25', status: '班距示意', meta: tripMeta },
  { id: 't4', mode: '公車', route: '307 路', origin: '板橋', destination: '撫遠街', departure: '10:06', arrival: '10:52', status: '示意班次', meta: tripMeta },
  { id: 't5', mode: '航班', route: 'BR 108', origin: '桃園', destination: '東京羽田', departure: '10:20', arrival: '14:25', status: '示意航班', meta: tripMeta },
];
export const transportModes: Mode[] = ['高鐵', '台鐵', '捷運', '公車', '航班'];
export const eventLabels = { incident: '事故', roadwork: '施工', closure: '封路', congestion: '壅塞', 'speed-camera': '測速照相' } as const;
export const severityLabels = { high: '嚴重', medium: '中度', low: '輕微' } as const;
