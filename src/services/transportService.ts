import { demoEvents, demoTrips } from '../data/demo';
import type {
  Confidence,
  DataStatus,
  Mode,
  MultiModalRouteResult,
  RoadEvent,
  SpeedCamera,
  TransitFilterOptions,
  TransitTrip,
} from '../types/transit';

export interface DatasetResult<T> {
  data: T[];
  status: DataStatus;
  source: string;
  updatedAt: string;
  fetchedAt?: string;
  confidence: Confidence;
  tdxConfigured?: boolean;
  note?: string;
}

export const transportService = {
  async getRoadEvents(): Promise<DatasetResult<RoadEvent>> {
    const response = await fetch('/api/road-events');
    const payload = await response.json() as DatasetResult<RoadEvent>;
    if (!response.ok && payload.status !== 'error') throw new Error(`道路事件 API 回應 ${response.status}`);
    return payload;
  },
  getDemoRoadEvents(): DatasetResult<RoadEvent> {
    return { data: demoEvents, status: 'available', source: 'Island Pulse 示範資料', updatedAt: '2026-10-14 09:42', confidence: 'demo', note: '僅供介面展示，非即時交通資訊' };
  },
  async getTrips(mode: Mode = '高鐵', filters: TransitFilterOptions = {}): Promise<DatasetResult<TransitTrip>> {
    const params = new URLSearchParams({ mode });
    if (filters.station) params.set('station', filters.station);
    if (filters.operator) params.set('operator', filters.operator);
    if (filters.city) params.set('city', filters.city);
    if (filters.route) params.set('route', filters.route);
    if (filters.airport) params.set('airport', filters.airport);
    if (filters.refresh) params.set('refresh', '1');
    const response = await fetch(`/api/transit?${params.toString()}`);
    const payload = await response.json() as DatasetResult<TransitTrip>;
    if (!response.ok && payload.status !== 'error') throw new Error(`大眾運輸 API 回應 ${response.status}`);
    return payload;
  },
  async getRoutes(from: string, to: string, departAt: string): Promise<MultiModalRouteResult> {
    const params = new URLSearchParams({ from, to, departAt });
    const response = await fetch(`/api/routes?${params.toString()}`);
    const payload = await response.json() as MultiModalRouteResult;
    if (!response.ok && payload.status !== 'error') throw new Error(`跨運具路線 API 回應 ${response.status}`);
    return payload;
  },
  getDemoTrips(mode?: Mode): DatasetResult<TransitTrip> {
    return {
      data: mode ? demoTrips.filter((trip) => trip.mode === mode) : demoTrips,
      status: 'available',
      source: 'Island Pulse 示範資料',
      updatedAt: '2026-10-14 09:42',
      confidence: 'demo',
      note: '僅供版面預覽，非實際班表或即時營運狀態。',
    };
  },
  async getSpeedCameras(): Promise<DatasetResult<SpeedCamera>> {
    const response = await fetch('/api/speed-cameras');
    const payload = await response.json() as DatasetResult<SpeedCamera>;
    if (!response.ok && payload.status !== 'error') throw new Error(`測速資料 API 回應 ${response.status}`);
    return payload;
  },
};

