import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { RoadEvent, SpeedCamera } from '../../types/transit';
import { eventLabels } from '../../data/demo';
import { MAP_ATTRIBUTION, MAP_TILE_URL } from '../../config/app';

const colors: Record<RoadEvent['kind'], string> = { incident: '#d64545', roadwork: '#d9822b', closure: '#7a3e9d', congestion: '#b58b00', 'speed-camera': '#2864b4' };
const shapes: Record<RoadEvent['kind'], string> = { incident: '!', roadwork: '⚒', closure: '×', congestion: '≋', 'speed-camera': '⌁' };
function Recenter({ focus }: { focus?: [number, number] }) {
  const map = useMap();
  useEffect(() => { if (focus) map.flyTo(focus, Math.max(map.getZoom(), 13), { duration: 0.65 }); }, [focus, map]);
  return null;
}
function MapZoomControls() {
  const map = useMap();
  return <div className="map-zoom-controls" aria-label="地圖縮放控制"><button aria-label="放大地圖" onClick={() => map.zoomIn()}>＋</button><button aria-label="縮小地圖" onClick={() => map.zoomOut()}>−</button></div>;
}
function MarkerIcon({ kind, selected }: { kind: RoadEvent['kind']; selected: boolean }) {
  return L.divIcon({ className: `event-marker ${selected ? 'selected' : ''}`, html: `<span style="--marker:${colors[kind]}">${shapes[kind]}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] });
}
function ClusterIcon(kind: RoadEvent['kind'], count: number) {
  return L.divIcon({ className: 'event-marker camera-cluster', html: `<span style="--marker:${colors[kind]}">${count}</span>`, iconSize: [40, 40], iconAnchor: [20, 20] });
}
function UserLocationIcon() {
  return L.divIcon({ className: 'user-location-marker', html: '<span title="目前位置"/>', iconSize: [24, 24], iconAnchor: [12, 12] });
}

function RoadEventLayer({ events, selectedId, onSelect }: { events: RoadEvent[]; selectedId?: string; onSelect: (event: RoadEvent) => void }) {
  const map = useMap();
  const [mapRevision, setMapRevision] = useState(0);
  useMapEvents({ moveend: () => setMapRevision((value) => value + 1), zoomend: () => setMapRevision((value) => value + 1) });
  const visibleGroups = useMemo(() => {
    void mapRevision;
    const bounds = map.getBounds().pad(0.12);
    const zoom = map.getZoom();
    const grid = zoom < 10 ? 0.12 : zoom < 12 ? 0.045 : zoom < 14 ? 0.014 : 0;
    const groups = new Map<string, RoadEvent[]>();
    for (const event of events) {
      if (!bounds.contains(event.coordinates)) continue;
      const key = grid && selectedId !== event.id
        ? `${event.kind}:${Math.round(event.coordinates[0] / grid)},${Math.round(event.coordinates[1] / grid)}`
        : `single:${event.id}`;
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    return [...groups.values()].map((members) => ({
      members,
      center: [
        members.reduce((sum, item) => sum + item.coordinates[0], 0) / members.length,
        members.reduce((sum, item) => sum + item.coordinates[1], 0) / members.length,
      ] as [number, number],
    }));
  }, [events, map, mapRevision, selectedId]);

  return <>{visibleGroups.map(({ members, center }) => {
    if (members.length > 1) {
      const first = members[0];
      const label = eventLabels[first.kind];
      return <Marker key={`evt-cluster-${first.id}`} position={center} icon={ClusterIcon(first.kind, members.length)} keyboard title={`${members.length} 筆${label}事件，點按放大`} alt={`${members.length} 筆${label}事件聚合標記`} eventHandlers={{ click: () => map.flyTo(center, Math.min(17, map.getZoom() + 2), { duration: 0.5 }) }}>
        <Tooltip direction="top">{members.length} 筆{label}・點按放大</Tooltip>
      </Marker>;
    }
    const event = members[0];
    return <Marker key={event.id} position={event.coordinates} icon={MarkerIcon({ kind: event.kind, selected: selectedId === event.id })} keyboard title={`${eventLabels[event.kind]}：${event.location}`} alt={`${eventLabels[event.kind]}：${event.location}`} eventHandlers={{ click: () => onSelect(event) }}>
      <Tooltip direction="top" offset={[0, -8]}>{event.subKind ?? eventLabels[event.kind]}・{event.location}</Tooltip>
    </Marker>;
  })}</>;
}

function CameraLayer({ cameras, selectedId, onSelect }: { cameras: SpeedCamera[]; selectedId?: string; onSelect: (event: RoadEvent) => void }) {
  const map = useMap();
  const [mapRevision, setMapRevision] = useState(0);
  useMapEvents({ moveend: () => setMapRevision((value) => value + 1), zoomend: () => setMapRevision((value) => value + 1) });
  const visibleCameras = useMemo(() => {
    void mapRevision;
    const bounds = map.getBounds().pad(0.1);
    const zoom = map.getZoom();
    const grid = zoom < 11 ? 0.1 : zoom < 13 ? 0.035 : zoom < 15 ? 0.01 : zoom < 17 ? 0.003 : 0;
    const groups = new Map<string, SpeedCamera[]>();
    for (const camera of cameras) {
      if (!bounds.contains(camera.coordinates)) continue;
      const key = grid && selectedId !== camera.id ? `${Math.round(camera.coordinates[0] / grid)},${Math.round(camera.coordinates[1] / grid)}` : camera.id;
      groups.set(key, [...(groups.get(key) ?? []), camera]);
    }
    return [...groups.values()].map((members) => ({
      members,
      center: [members.reduce((sum, camera) => sum + camera.coordinates[0], 0) / members.length, members.reduce((sum, camera) => sum + camera.coordinates[1], 0) / members.length] as [number, number],
    }));
  }, [cameras, map, mapRevision, selectedId]);
  return <>{visibleCameras.map(({ members, center }) => {
    if (members.length > 1) return <Marker key={`cluster-${members[0].id}`} position={center} icon={ClusterIcon('speed-camera', members.length)} keyboard title={`${members.length} 個官方測速設置點，點按放大`} alt={`${members.length} 個官方測速設置點聚合標記`} eventHandlers={{ click: () => map.flyTo(center, Math.min(18, map.getZoom() + 2), { duration: 0.5 }) }}><Tooltip direction="top">{members.length} 個測速設置點・點按放大</Tooltip></Marker>;
    const camera = members[0];
    return <Marker key={camera.id} position={camera.coordinates} icon={MarkerIcon({ kind: 'speed-camera', selected: selectedId === camera.id })} keyboard title={`官方測速設置點：${camera.road}`} alt={`官方測速設置點：${camera.road}`} eventHandlers={{ click: () => onSelect({ id: camera.id, kind: 'speed-camera', subKind: camera.datasetId === '13940' ? '國道測速 13940' : '測速設置點 7320', title: camera.name, location: camera.road, direction: camera.direction, description: `${camera.limitKph ? `資料所列速限 ${camera.limitKph} 公里/小時。` : ''}${camera.authority ? `管理機關：${camera.authority}。` : ''}官方設置點資料，非即時且不定期更新；請以現場標誌及交通規則為準。`, severity: 'low', coordinates: camera.coordinates, observedAt: camera.meta.updatedAt, meta: camera.meta }) }}>
      <Tooltip direction="top">官方設置點{camera.limitKph ? `・速限 ${camera.limitKph}` : ''}</Tooltip>
    </Marker>;
  })}</>;
}

export function MapView({ events, cameras, layers, selectedId, onSelect, focus, userLocation }: {
  events: RoadEvent[]; cameras: SpeedCamera[]; layers: Record<RoadEvent['kind'], boolean>;
  selectedId?: string; onSelect: (event: RoadEvent) => void; focus?: [number, number]; userLocation?: [number, number];
}) {
  const visibleEvents = useMemo(() => events.filter((event) => layers[event.kind]), [events, layers]);
  return <MapContainer center={[25.0478, 121.5319]} zoom={12} minZoom={7} maxZoom={18} scrollWheelZoom className="leaflet-map" zoomControl={false}>
    <Recenter focus={focus} />
    <MapZoomControls />
    <TileLayer attribution={MAP_ATTRIBUTION} url={MAP_TILE_URL} />
    {userLocation && <Marker position={userLocation} icon={UserLocationIcon()} title="你的目前位置" alt="你的目前位置"><Tooltip direction="top">你的目前位置</Tooltip></Marker>}
    <RoadEventLayer events={visibleEvents} selectedId={selectedId} onSelect={onSelect} />
    {layers['speed-camera'] && <CameraLayer cameras={cameras} selectedId={selectedId} onSelect={onSelect} />}
  </MapContainer>;
}
