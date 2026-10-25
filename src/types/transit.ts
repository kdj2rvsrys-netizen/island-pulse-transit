export type EventKind = 'incident' | 'roadwork' | 'closure' | 'congestion' | 'speed-camera';
export type Severity = 'high' | 'medium' | 'low';
export type DataStatus = 'available' | 'loading' | 'empty' | 'stale' | 'error' | 'unavailable';
export type Confidence = 'live' | 'official-live' | 'scheduled' | 'estimated' | 'official-static' | 'demo';
export type Mode = '高鐵' | '台鐵' | '捷運' | '公車' | '航班';

export interface DataMeta {
  source: string;
  updatedAt: string;
  fetchedAt?: string;
  status: DataStatus;
  confidence: Confidence;
  note?: string;
}
export interface RoadEvent {
  id: string;
  kind: EventKind;
  subKind?: string;
  title: string;
  location: string;
  direction: string;
  description: string;
  severity: Severity;
  coordinates: [number, number];
  observedAt: string;
  updatedAt?: string;
  expectedClearance?: string;
  cleared?: boolean;
  phase?: 'active' | 'upcoming' | 'ended';
  region?: string;
  authority?: string;
  meta: DataMeta;
}
export interface SpeedCamera {
  id: string;
  name: string;
  road: string;
  limitKph: number | null;
  direction: string;
  coordinates: [number, number];
  city?: string;
  region?: string;
  address?: string;
  authority?: string;
  datasetId?: '7320' | '13940';
  enforcement?: string;
  meta: DataMeta;
}
export interface TransitStation { id: string; name: string; mode: Mode; coordinates: [number, number]; }
export interface TransitRoute { id: string; name: string; mode: Mode; color: string; stations: string[]; }
export interface TransitTrip { id: string; mode: Mode; route: string; origin: string; destination: string; departure: string; arrival: string | null; status: string; delayMinutes?: number; meta: DataMeta; }

export interface TransitFilterOptions {
  station?: string;
  operator?: string;
  city?: string;
  route?: string;
  airport?: string;
  refresh?: boolean;
}

export type RouteMode = Mode | '自駕';

export interface RouteUpcomingTrip {
  trainNo: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  durationMinutes: number | null;
  durationText: string;
}

export interface RouteStep {
  stepNo: number;
  vehicle: string;
  instruction: string;
  detail: string;
  duration: string;
}

export interface BookingLink {
  label: string;
  url: string;
  primary?: boolean;
}

export interface RouteOptionItem {
  mode: RouteMode;
  available: boolean;
  title: string;
  time: string;
  detail: string;
  fareText?: string;
  color: string;
  hops: string;
  confidence: Confidence;
  source: string;
  upcomingTrips: RouteUpcomingTrip[];
  bookingLinks?: BookingLink[];
  navigationUrl?: string;
  path?: [number, number][];
  corridorEventsCount?: number;
  corridorCamerasCount?: number;
  steps?: RouteStep[];
}

export interface MultiModalRouteResult {
  status: DataStatus;
  source: string;
  updatedAt: string;
  fetchedAt?: string;
  tdxConfigured?: boolean;
  resolvedOrigin?: string;
  resolvedDestination?: string;
  originCoords?: [number, number];
  destCoords?: [number, number];
  distanceKm?: number;
  options: RouteOptionItem[];
  note?: string;
}


