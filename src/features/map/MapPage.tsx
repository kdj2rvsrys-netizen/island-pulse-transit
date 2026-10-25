import { useEffect, useMemo, useState } from 'react';
import { demoEvents, eventLabels, severityLabels } from '../../data/demo';
import type { DataStatus, EventKind, RoadEvent, SpeedCamera } from '../../types/transit';
import { DataBadge } from '../../components/DataBadge';
import { Icon } from '../../components/Icon';
import { MapView } from './MapView';
import { transportService, type DatasetResult } from '../../services/transportService';

const defaults: Record<EventKind, boolean> = { incident: true, roadwork: true, closure: true, congestion: true, 'speed-camera': true };
const eventIcons: Record<EventKind, string> = { incident: 'alert', roadwork: 'building', closure: 'close', congestion: 'car', 'speed-camera': 'camera' };
const legendShapes: Record<EventKind, string> = { incident: '!', roadwork: '⚒', closure: '×', congestion: '≋', 'speed-camera': '⌁' };
const statusOptions: { value: DataStatus; label: string }[] = [
  { value: 'available', label: '資料正常（官方即時）' }, { value: 'loading', label: '載入中示意' }, { value: 'empty', label: '無資料示意' }, { value: 'stale', label: '資料過期示意' }, { value: 'error', label: '連線錯誤示意' },
];
const places: { name: string; coordinates: [number, number] }[] = [
  { name: '臺北車站', coordinates: [25.0478, 121.517] }, { name: '台北 101', coordinates: [25.0339, 121.5645] },
  { name: '板橋車站', coordinates: [25.0143, 121.4638] }, { name: '桃園高鐵站', coordinates: [25.0133, 121.2148] },
  { name: '臺中車站', coordinates: [24.1368, 120.685] }, { name: '高雄車站', coordinates: [22.6397, 120.302] },
];
const formatDataTime = (value: string) => {
  if (!value) return '未提供';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'short', hour12: false }).format(date);
};

function isActiveRecentEvent(event: RoadEvent, latestDay: string) {
  if (event.cleared) return false;
  if (!latestDay || !event.updatedAt) return true;
  return event.updatedAt.startsWith(latestDay);
}

export function MapPage({ status, setStatus, navigate, onLocateSuccess }: {
  status: DataStatus;
  setStatus: (status: DataStatus) => void;
  navigate: (page: string) => void;
  onLocateSuccess?: (coords: [number, number]) => void;
}) {
  const [layers, setLayers] = useState(defaults);
  const eventParam = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('event');
  const [selected, setSelected] = useState<RoadEvent | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<[number, number] | undefined>();
  const [userLocation, setUserLocation] = useState<[number, number] | undefined>();
  const [locationNotice, setLocationNotice] = useState<string | undefined>();
  const [showLayers, setShowLayers] = useState(false);
  const [includeCleared, setIncludeCleared] = useState(false);
  const [useDemoEvents, setUseDemoEvents] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [eventResult, setEventResult] = useState<DatasetResult<RoadEvent>>({ data: [], status: 'loading', source: '內政部警政署警察廣播電臺・即時路況（資料集 15221）', updatedAt: '', confidence: 'official-live' });
  const [cameraResult, setCameraResult] = useState<DatasetResult<SpeedCamera>>({ data: [], status: 'loading', source: '內政部警政署・政府資料開放平臺（資料集 7320 & 13940）', updatedAt: '', confidence: 'official-static' });
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    transportService.getRoadEvents().then((result) => {
      if (!active) return;
      setEventResult(result);
      if (eventParam) {
        const target = result.data.find((event) => event.id === eventParam) ?? demoEvents.find((event) => event.id === eventParam);
        if (target) {
          setSelected(target);
          setFocus(target.coordinates);
        }
      }
    }).catch((error: unknown) => {
      if (active) setEventResult({ data: [], status: 'error', source: '內政部警政署警察廣播電臺・即時路況（資料集 15221）', updatedAt: '', confidence: 'official-live', note: error instanceof Error ? error.message : '無法連接警廣即時路況服務。' });
    });
    transportService.getSpeedCameras().then((result) => {
      if (active) setCameraResult(result);
    }).catch((error: unknown) => {
      if (active) setCameraResult({ data: [], status: 'error', source: '內政部警政署・政府資料開放平臺（資料集 7320 & 13940）', updatedAt: '', confidence: 'official-static', note: error instanceof Error ? error.message : '無法連接資料服務。' });
    });
    return () => { active = false; };
  }, [reloadTick, eventParam]);

  const rawEvents = useDemoEvents ? demoEvents : eventResult.data;
  const latestDay = useMemo(() => rawEvents.reduce((max, item) => {
    const day = item.updatedAt?.slice(0, 10) ?? '';
    return day > max ? day : max;
  }, ''), [rawEvents]);

  const activeEvents = useMemo(() => {
    if (useDemoEvents || includeCleared) return rawEvents;
    const filtered = rawEvents.filter((item) => isActiveRecentEvent(item, latestDay));
    return filtered.length > 0 ? filtered : rawEvents.filter((item) => !item.cleared);
  }, [rawEvents, useDemoEvents, includeCleared, latestDay]);

  const activeSelected = useMemo(() => {
    if (selected === null) return undefined;
    if (selected) return selected;
    if (eventParam) {
      const target = rawEvents.find((event) => event.id === eventParam) ?? demoEvents.find((event) => event.id === eventParam);
      if (target) return target;
    }
    return activeEvents[0];
  }, [selected, eventParam, rawEvents, activeEvents]);

  const normalizedQuery = query.trim().toLowerCase();
  const matchingEvents = useMemo(
    () => (normalizedQuery ? activeEvents.filter((event) => `${event.title} ${event.subKind ?? ''} ${event.location} ${event.direction} ${event.description}`.toLowerCase().includes(normalizedQuery)) : []),
    [activeEvents, normalizedQuery],
  );
  const matchingPlaces = useMemo(
    () => (normalizedQuery ? places.filter((place) => place.name.toLowerCase().includes(normalizedQuery)) : []),
    [normalizedQuery],
  );
  const matchingCameras = useMemo(
    () => (normalizedQuery ? cameraResult.data.filter((cam) => `${cam.road} ${cam.city ?? ''} ${cam.region ?? ''} ${cam.direction}`.toLowerCase().includes(normalizedQuery)).slice(0, 3) : []),
    [cameraResult.data, normalizedQuery],
  );

  const effectiveStatus: DataStatus = status !== 'available' ? status : useDemoEvents ? 'available' : eventResult.status;
  const effectiveConfidence = useDemoEvents ? 'demo' : eventResult.confidence;
  const mapEvents = effectiveStatus === 'empty' || effectiveStatus === 'error' || effectiveStatus === 'loading' ? [] : activeEvents;

  const selectEvent = (event: RoadEvent) => {
    setSelected(event);
    setFocus(event.coordinates);
    setQuery('');
  };
  const selectCamera = (cam: SpeedCamera) => {
    selectEvent({
      id: cam.id,
      kind: 'speed-camera',
      subKind: cam.datasetId === '13940' ? '國道測速 13940' : '測速設置點 7320',
      title: cam.name,
      location: cam.road,
      direction: cam.direction,
      description: `${cam.limitKph ? `資料所列速限 ${cam.limitKph} 公里/小時。` : ''}${cam.authority ? `管理機關：${cam.authority}。` : ''}官方設置點資料，非即時且不定期更新；請以現場標誌及交通規則為準。`,
      severity: 'low',
      coordinates: cam.coordinates,
      observedAt: cam.meta.updatedAt,
      meta: cam.meta,
    });
  };
  const handleSearchEnter = () => {
    if (matchingPlaces[0]) {
      setFocus(matchingPlaces[0].coordinates);
      setQuery('');
    } else if (matchingEvents[0]) {
      selectEvent(matchingEvents[0]);
    } else if (matchingCameras[0]) {
      selectCamera(matchingCameras[0]);
    }
  };
  const locate = () => {
    if (!navigator.geolocation) {
      setLocationNotice('此瀏覽器不支援定位，請使用搜尋框或手動平移地圖。');
      return;
    }
    setLocationNotice('正在取得目前位置…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const pos: [number, number] = [coords.latitude, coords.longitude];
        setUserLocation(pos);
        setFocus(pos);
        setLocationNotice(undefined);
        onLocateSuccess?.(pos);
      },
      () => {
        setLocationNotice('無法取得定位權限或訊號。你仍可搜尋道路、車站或手動移動地圖。');
      },
      { timeout: 7000 },
    );
  };

  return <div className="map-workspace">
    <h1 className="sr-only">交通地圖</h1>
    <section className="map-stage" aria-label="台灣交通地圖">
      <MapView events={mapEvents} cameras={cameraResult.data} layers={layers} selectedId={activeSelected?.id} onSelect={selectEvent} focus={focus} userLocation={userLocation} />
      <div className="map-search"><Icon name="search"/><input aria-label="搜尋地點或事件" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋地點、國道省道、事件或測速路段" onKeyDown={(e) => { if (e.key === 'Enter') handleSearchEnter(); }} /><kbd>Enter</kbd>{query && <button className="icon-button" aria-label="清除搜尋" onClick={() => setQuery('')}><Icon name="close" size={17}/></button>}</div>
      {normalizedQuery && <div className="search-results">
        {matchingPlaces.map((place) => <button key={place.name} onClick={() => { setFocus(place.coordinates); setQuery(''); }}><Icon name="pin" size={17}/><span><b>{place.name}</b><small>預設地標・飛往座標</small></span><Icon name="chevron" size={16}/></button>)}
        {matchingEvents.slice(0, 4).map((event) => <button key={event.id} onClick={() => selectEvent(event)}><span className={`kind-dot kind-${event.kind}`}>{legendShapes[event.kind]}</span><span><b>{event.location}</b><small>{event.subKind ?? eventLabels[event.kind]}・{event.title}</small></span><Icon name="chevron" size={16}/></button>)}
        {matchingCameras.map((cam) => <button key={cam.id} onClick={() => selectCamera(cam)}><span className="kind-dot kind-speed-camera">⌁</span><span><b>{cam.road}</b><small>官方測速點{cam.limitKph ? `・速限 ${cam.limitKph}` : ''}</small></span><Icon name="chevron" size={16}/></button>)}
        {!matchingPlaces.length && !matchingEvents.length && !matchingCameras.length && <p>沒有符合的地點、即時道路事件或測速路段</p>}
      </div>}
      <div className="map-top-tools"><DataBadge status={effectiveStatus} confidence={effectiveConfidence}/><button className="icon-button" aria-label="定位到目前位置" title="使用目前位置" onClick={locate}><Icon name="pin"/></button><button className={`icon-button ${showLayers ? 'is-active' : ''}`} aria-label="開啟圖層" aria-expanded={showLayers} title="地圖圖層" onClick={() => setShowLayers(!showLayers)}><Icon name="layers"/></button></div>
      {showLayers && <div className="layer-popover">
        <div className="popover-title"><b>地圖圖層與篩選</b><button className="icon-button" aria-label="關閉圖層" onClick={() => setShowLayers(false)}><Icon name="close" size={16}/></button></div>
        {(Object.keys(layers) as EventKind[]).map((kind) => <label className="layer-toggle" key={kind}><input type="checkbox" checked={layers[kind]} onChange={(e) => setLayers({ ...layers, [kind]: e.target.checked })}/><span className={`kind-dot kind-${kind}`}><Icon name={eventIcons[kind]} size={14}/></span><span>{eventLabels[kind]}</span><small>{kind === 'speed-camera' ? cameraResult.data.length : activeEvents.filter((event) => event.kind === kind).length}</small></label>)}
        <label className="layer-toggle"><input type="checkbox" checked={includeCleared} onChange={(e) => setIncludeCleared(e.target.checked)}/><span>包含已排除／近期歷史事件</span><small>{rawEvents.length}</small></label>
        <label className="layer-toggle"><input type="checkbox" checked={useDemoEvents} onChange={(e) => setUseDemoEvents(e.target.checked)}/><span>改用 Demo 道路事件示意</span></label>
        <div className="legend-foot">道路事件：{useDemoEvents ? 'Demo' : '警廣即時 (15221)'}・測速：官方清冊 (7320+13940)</div>
      </div>}
      <div className="map-legend" aria-label="地圖圖例"><b>路況圖例</b><span><i className="kind-dot kind-incident">!</i>事故</span><span><i className="kind-dot kind-roadwork">⚒</i>施工</span><span><i className="kind-dot kind-closure">×</i>封路/管制</span><span><i className="kind-dot kind-congestion">≋</i>壅塞</span><span><i className="kind-dot kind-speed-camera">⌁</i>測速</span></div>
      <div className="map-status-strip"><span><i className="status-led"/>測速點 <b>{cameraResult.status === 'loading' ? '載入中' : cameraResult.status === 'available' ? `${cameraResult.data.length} 處 (${cameraResult.updatedAt.slice(0, 10)})` : cameraResult.status === 'empty' ? '無資料' : cameraResult.status === 'stale' ? '資料過期' : '連線錯誤'}</b></span><span>道路事件：{useDemoEvents ? 'Demo' : `警廣即時 (${activeEvents.length} 筆)`}</span><select aria-label="切換道路事件資料狀態示意" value={status} onChange={(e) => setStatus(e.target.value as DataStatus)}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
    </section>
    <aside className={`map-side-panel ${sheetExpanded ? 'sheet-expanded' : ''}`}>
      <div className="sheet-grabber" role="button" tabIndex={0} aria-label="展開或收合附近資訊" onClick={() => setSheetExpanded(!sheetExpanded)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSheetExpanded(!sheetExpanded); }}><span/></div>
      <div className="side-panel-head"><div><p className="eyebrow">{useDemoEvents ? 'DEMO 示範範圍' : '台灣全區・警廣即時路況'}</p><h2>附近動態 <span className="count-pill">{mapEvents.length}</span></h2></div><button className="text-action" onClick={() => navigate('events')}>全部事件 <Icon name="arrow" size={15}/></button></div>
      {locationNotice && <div className="inline-state"><Icon name="pin" size={16}/><span>{locationNotice}</span><button onClick={() => setLocationNotice(undefined)}>關閉</button></div>}
      {effectiveStatus === 'loading' && <div className="inline-state"><span className="spinner"/>正在同步官方即時路況資料…</div>}
      {effectiveStatus === 'empty' && <div className="inline-state"><Icon name="info"/>目前範圍沒有可顯示事件。<button onClick={() => { setStatus('available'); setIncludeCleared(true); }}>顯示全部紀錄</button></div>}
      {effectiveStatus === 'error' && <div className="inline-state error-state"><Icon name="info"/>道路事件載入失敗，未影響測速圖層。<button onClick={() => { setStatus('available'); setReloadTick((v) => v + 1); }}>重試</button><button onClick={() => { setUseDemoEvents(true); setStatus('available'); }}>改看 Demo</button></div>}
      {effectiveStatus === 'stale' && <div className="stale-banner"><Icon name="clock" size={15}/>資料已過期・最後更新 {eventResult.updatedAt || '08:12'}</div>}
      {effectiveStatus !== 'empty' && effectiveStatus !== 'error' && effectiveStatus !== 'loading' && <>
        {activeSelected && <div className="selected-event-card"><div className={`event-icon kind-${activeSelected.kind}`}><Icon name={eventIcons[activeSelected.kind]} size={19}/></div><div className="selected-event-copy"><div className="selected-meta"><span>{activeSelected.subKind ?? eventLabels[activeSelected.kind]}</span><span className={`severity severity-${activeSelected.severity}`}>{severityLabels[activeSelected.severity]}</span>{activeSelected.cleared && <span className="severity">已排除</span>}<button className="icon-button close-detail" aria-label="關閉事件詳情" onClick={() => setSelected(null)}><Icon name="close" size={16}/></button></div><b>{activeSelected.title}</b><p>{activeSelected.location}</p><small>{activeSelected.direction}・通報時間 {activeSelected.observedAt}{activeSelected.authority ? `・${activeSelected.authority}` : ''}</small><p className="selected-description">{activeSelected.description}</p><div className="event-demo-note">{activeSelected.meta.confidence === 'official-static' ? `${activeSelected.meta.source}・非即時資料` : activeSelected.meta.confidence === 'official-live' ? `${activeSelected.meta.source}・更新於 ${activeSelected.updatedAt ?? activeSelected.observedAt}` : 'Demo 資料・非即時資訊'}</div></div></div>}
        <div className="event-list-heading"><b>即時事件與路況</b><button className="icon-button" aria-label="重新整理路況資料" onClick={() => { setReloadTick((v) => v + 1); }}><Icon name="refresh" size={16}/></button></div>
        <div className="nearby-list">{activeEvents.slice(0, 12).map((event) => <button className={`nearby-row ${activeSelected?.id === event.id ? 'selected-row' : ''}`} key={event.id} onClick={() => selectEvent(event)}><span className={`event-icon kind-${event.kind}`}><Icon name={eventIcons[event.kind]} size={17}/></span><span className="nearby-copy"><b>{event.location}</b><small><span className={`kind-text kind-text-${event.kind}`}>{event.subKind ?? eventLabels[event.kind]}</span>・{event.title}</small></span><span className="nearby-time">{event.observedAt}</span></button>)}</div>
      </>}
      <div className="side-data-foot"><Icon name="info" size={15}/><span><b>測速設置點（{cameraResult.data.length} 處）・{cameraResult.status === 'available' ? '官方資料 7320+13940 正常' : cameraResult.status === 'loading' ? '載入中' : cameraResult.status === 'stale' ? '來源中斷，使用上次資料' : cameraResult.status === 'empty' ? '目前無資料' : '官方來源錯誤'}</b><small>測速目錄更新：{formatDataTime(cameraResult.updatedAt)}・本機取得：{formatDataTime(cameraResult.fetchedAt ?? '')}</small><small>道路事件來源：{useDemoEvents ? 'Island Pulse Demo' : `警廣即時路況 15221（更新：${eventResult.updatedAt || '同步中'}）`}。{cameraResult.note ?? ''}</small>{cameraResult.status === 'error' && <button className="text-action" onClick={() => setReloadTick((count) => count + 1)}>重試</button>}</span></div>
    </aside>
  </div>;
}
