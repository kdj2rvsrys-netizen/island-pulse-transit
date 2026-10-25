import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { MultiModalRouteResult, RouteMode, RouteOptionItem } from '../../types/transit';
import { MAP_ATTRIBUTION, MAP_TILE_URL } from '../../config/app';
import { DataBadge } from '../../components/DataBadge';
import { Icon } from '../../components/Icon';
import { PageHeading } from '../../components/PageHeading';
import { transportService } from '../../services/transportService';

const ALL_ROUTE_MODES: RouteMode[] = ['高鐵', '台鐵', '自駕', '捷運', '公車', '航班'];

const HUB_SUGGESTIONS = [
  '南港車站',
  '臺北車站',
  '台北 101',
  '板橋車站',
  '基隆車站',
  '桃園高鐵站',
  '桃園機場',
  '新竹高鐵站',
  '新竹科學園區',
  '苗栗車站',
  '臺中車站',
  '日月潭',
  '彰化車站',
  '雲林高鐵站',
  '嘉義車站',
  '阿里山',
  '臺南車站',
  '左營站',
  '高雄車站',
  '駁二藝術特區',
  '屏東車站',
  '墾丁',
  '宜蘭車站',
  '花蓮車站',
  '臺東車站',
];

const CORRIDOR_PRESETS = [
  { label: '臺北 ↔ 左營', from: '臺北車站', to: '左營站' },
  { label: '臺北 ↔ 臺中', from: '臺北車站', to: '臺中車站' },
  { label: '台北 101 ↔ 新竹竹科', from: '台北 101', to: '新竹科學園區' },
  { label: '臺北 ↔ 花蓮', from: '臺北車站', to: '花蓮車站' },
  { label: '板橋 ↔ 臺南', from: '板橋車站', to: '臺南車站' },
];

function getInitialDepartAt() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

function EndpointIcon(label: string, color: string) {
  return L.divIcon({
    className: 'event-marker selected',
    html: `<span style="--marker:${color};font-size:12px;font-weight:700">${label}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function FitRouteBounds({ path }: { path: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (path.length >= 2) {
      const bounds = L.latLngBounds(path);
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13 });
    }
  }, [map, path]);
  return null;
}

export function RoutesPage() {
  const [from, setFrom] = useState('臺北車站');
  const [to, setTo] = useState('左營站');
  const [departAt, setDepartAt] = useState(getInitialDepartAt);
  const [modes, setModes] = useState<RouteMode[]>(['高鐵', '台鐵', '自駕', '捷運', '公車', '航班']);
  const [submittedRoute, setSubmittedRoute] = useState<{ from: string; to: string; departAt: string }>(() => ({
    from: '臺北車站',
    to: '左營站',
    departAt: getInitialDepartAt(),
  }));
  const [selectedMode, setSelectedMode] = useState<RouteMode>('高鐵');
  const [selectedTripIdx, setSelectedTripIdx] = useState(0);
  const [previewDemo, setPreviewDemo] = useState(false);
  const [routeResult, setRouteResult] = useState<MultiModalRouteResult>({
    status: 'loading',
    source: '交通部 TDX・城際鐵路 OD 時刻表與多運具整合',
    updatedAt: '',
    options: [],
  });

  useEffect(() => {
    let active = true;
    transportService.getRoutes(submittedRoute.from, submittedRoute.to, submittedRoute.departAt).then((res) => {
      if (!active) return;
      setRouteResult(res);
      setSelectedTripIdx(0);
    }).catch((error: unknown) => {
      if (active) {
        setRouteResult({
          status: 'error',
          source: '交通部 TDX',
          updatedAt: '',
          options: [],
          note: error instanceof Error ? error.message : '無法查詢跨運具路線。',
        });
      }
    });
    return () => { active = false; };
  }, [submittedRoute]);

  const swap = () => {
    setFrom(to);
    setTo(from);
    setSubmittedRoute((curr) => ({ ...curr, from: to.trim() || curr.to, to: from.trim() || curr.from }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedRoute({ from: from.trim() || '臺北車站', to: to.trim() || '左營站', departAt });
  };

  const applyPreset = (presetFrom: string, presetTo: string) => {
    setFrom(presetFrom);
    setTo(presetTo);
    setSubmittedRoute({ from: presetFrom, to: presetTo, departAt });
  };

  const toggle = (mode: RouteMode) => setModes((current) => current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode]);

  const demoFallbackOptions: RouteOptionItem[] = useMemo(() => {
    const origin = submittedRoute.from;
    const dest = submittedRoute.to;
    return [
      { mode: '高鐵', available: true, title: `高鐵城際直達・${origin} → ${dest}`, time: '1 小時 49 分', detail: `${origin} → ${dest}・Demo 示意班表`, fareText: '標準車廂約 NT$1,490', color: '#0c817a', hops: '直達', confidence: 'demo', source: 'Island Pulse Demo', upcomingTrips: [] },
      { mode: '台鐵', available: true, title: `台鐵自強號・${origin} → ${dest}`, time: '2 小時 25 分', detail: `${origin} → ${dest}・Demo 示意班表`, fareText: '自強號約 NT$843', color: '#da8a2c', hops: '直達', confidence: 'demo', source: 'Island Pulse Demo', upcomingTrips: [] },
      { mode: '自駕', available: true, title: `自駕道路導航・${origin} → ${dest}`, time: '3 小時 50 分', detail: `${origin} → ${dest}・國道 1 號走廊`, fareText: '預估油資＋通行費', color: '#2563eb', hops: '國道導航', confidence: 'demo', source: 'Island Pulse Demo', upcomingTrips: [] },
      { mode: '捷運', available: true, title: `都會捷運轉乘・${origin} → ${dest}`, time: '42 分', detail: `${origin} → ${dest}・Demo 示意`, fareText: '單程 NT$20–65', color: '#4d6b9e', hops: '1 次轉乘', confidence: 'demo', source: 'Island Pulse Demo', upcomingTrips: [] },
      { mode: '公車', available: true, title: `幹線公車／國道客運・${origin} → ${dest}`, time: '4 小時 15 分', detail: `${origin} → ${dest}・Demo 示意`, fareText: '客運約 NT$580', color: '#5175a4', hops: '國道客運', confidence: 'demo', source: 'Island Pulse Demo', upcomingTrips: [] },
      { mode: '航班', available: true, title: `國內外航線接駁・${origin} → ${dest}`, time: '1 小時 15 分', detail: `${origin} → ${dest}・Demo 示意`, fareText: '單程約 NT$2,100', color: '#4074b3', hops: '機場轉乘', confidence: 'demo', source: 'Island Pulse Demo', upcomingTrips: [] },
    ];
  }, [submittedRoute]);

  const isLiveTdx = routeResult.status === 'available' && routeResult.options.some((item) => item.mode !== '自駕' && item.confidence === 'scheduled');
  const demoModes = new Set(['高鐵', '台鐵', '捷運', '公車', '航班']);
  const activeOptions = previewDemo && routeResult.tdxConfigured === false
    ? [...routeResult.options.filter((item) => !demoModes.has(item.mode)), ...demoFallbackOptions.filter((item) => demoModes.has(item.mode))]
    : routeResult.options;
  const showingDemo = activeOptions.some((item) => item.confidence === 'demo');
  const filteredOptions = activeOptions.filter((item) => modes.includes(item.mode));
  const selectedOption = filteredOptions.find((item) => item.mode === selectedMode) ?? filteredOptions[0];

  const activeTrip = selectedOption?.upcomingTrips?.[selectedTripIdx] ?? selectedOption?.upcomingTrips?.[0];
  const activeSteps = !selectedOption?.steps?.length
    ? []
    : !activeTrip
      ? selectedOption.steps
      : selectedOption.steps.map((step) => {
          if (step.stepNo === 2 && (selectedOption.mode === '高鐵' || selectedOption.mode === '台鐵')) {
            return {
              ...step,
              vehicle: activeTrip.trainNo,
              instruction: `搭乘 ${activeTrip.trainNo}（${activeTrip.origin}站 → ${activeTrip.destination}站）`,
              detail: `${activeTrip.departure} 發車 → ${activeTrip.arrival} 抵達・${selectedOption.fareText ?? ''}`,
              duration: activeTrip.durationText,
            };
          }
          return step;
        });

  const routePath: [number, number][] =
    selectedOption?.path && selectedOption.path.length >= 2
      ? selectedOption.path
      : routeResult.originCoords && routeResult.destCoords
        ? [routeResult.originCoords, routeResult.destCoords]
        : [[25.0478, 121.517], [22.6874, 120.3075]];
  const googleTransitUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(submittedRoute.from)}&destination=${encodeURIComponent(submittedRoute.to)}&travelmode=transit`;
  const googleDrivingUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(submittedRoute.from)}&destination=${encodeURIComponent(submittedRoute.to)}&travelmode=driving`;

  return <div className="content-page routes-page">
    <PageHeading
      eyebrow={isLiveTdx ? 'ROUTE OPTIONS / OFFICIAL SCHEDULE + ROAD ESTIMATE' : 'ROUTE OPTIONS / VERIFIED DATA STATUS'}
      title="路線規劃與跨運具導航"
      description="查詢可驗證的城際班次、自駕道路估算，或開啟外部地圖規劃捷運與公車路線。"
      action={<DataBadge status={routeResult.status} confidence={isLiveTdx ? 'scheduled' : routeResult.status === 'unavailable' ? 'demo' : 'estimated'}/>}
    />
    <div className="route-banner">
      <div className="route-banner-mark"><Icon name="route" size={25}/></div>
      <div>
        <b>{routeResult.resolvedOrigin && routeResult.resolvedDestination ? `行程：${routeResult.resolvedOrigin} → ${routeResult.resolvedDestination}` : '比較已查證的行程資訊'}</b>
        <p>{isLiveTdx ? '班次只列出查到的官方時刻；開車時間是道路路徑估算，不含即時壅塞。其他運具會標示是否由外部服務查詢。' : '僅顯示可查證的資料；沒有班次資料時可開啟外部地圖，或選擇預覽明確標示的 Demo。'}</p>
      </div>
      <span>{isLiveTdx ? '官方班表＋估算路徑' : '資料狀態透明'}</span>
    </div>

    <div className="mode-tabs" aria-label="熱門交通走廊快捷選擇">
      {CORRIDOR_PRESETS.map((preset) => (
        <button
          key={preset.label}
          type="button"
          className={submittedRoute.from === preset.from && submittedRoute.to === preset.to ? 'active' : ''}
          onClick={() => applyPreset(preset.from, preset.to)}
        >
          <Icon name="pin" size={14}/>{preset.label}
        </button>
      ))}
    </div>

    <datalist id="taiwan-hubs">
      {HUB_SUGGESTIONS.map((hub) => <option key={hub} value={hub}/>)}
    </datalist>

    <form className="route-form" onSubmit={submit}>
      <div className="route-fields">
        <label className="route-field">
          <span>出發地</span>
          <div><Icon name="pin"/><input list="taiwan-hubs" required value={from} onChange={(e) => setFrom(e.target.value)} aria-label="出發地" placeholder="如：臺北車站、台北 101、板橋"/></div>
        </label>
        <button type="button" className="swap-button" aria-label="交換起點與終點" onClick={swap}><Icon name="refresh"/></button>
        <label className="route-field">
          <span>目的地</span>
          <div><Icon name="pin"/><input list="taiwan-hubs" required value={to} onChange={(e) => setTo(e.target.value)} aria-label="目的地" placeholder="如：左營站、花蓮車站、竹科"/></div>
        </label>
      </div>
      <label className="route-field depart-field"><span>出發時間</span><input type="datetime-local" value={departAt} onChange={(e) => setDepartAt(e.target.value)}/></label>
      <fieldset className="mode-checks"><legend>比較運具與導航模式</legend>{ALL_ROUTE_MODES.map((mode) => <label key={mode}><input type="checkbox" checked={modes.includes(mode)} onChange={() => toggle(mode)}/><span className="custom-check"><Icon name="check" size={13}/></span>{mode}</label>)}</fieldset>
      <button type="submit" className="button-primary search-route-button"><Icon name="search"/>規劃路線與查詢班次</button>
    </form>

    <div className="route-results-head">
      <div><p className="eyebrow">ROUTE COMPARISON</p><h2>{submittedRoute.from} → {submittedRoute.to}</h2></div>
      <span>出發：{submittedRoute.departAt.replace('T', ' ')}（{isLiveTdx ? '含官方班表' : showingDemo ? '含 Demo 示意' : '目前查詢結果'}）</span>
    </div>

    {routeResult.tdxConfigured === false && (
      <div className="demo-callout route-demo-controls">
        <Icon name="info"/>
        <span><b>尚未設定 TDX 憑證</b>・目前沒有可驗證的本機班次資料；Demo 僅供介面預覽。</span>
        <label><input type="checkbox" checked={previewDemo} onChange={(event) => setPreviewDemo(event.target.checked)}/> 預覽 Demo 示意方案</label>
      </div>
    )}

    <div className="route-results">
      {filteredOptions.map((item, index) => (
        <button
          key={item.mode}
          className={`route-result ${selectedOption?.mode === item.mode ? 'route-selected' : ''}`}
          onClick={() => { setSelectedMode(item.mode); setSelectedTripIdx(0); }}
        >
          <span className="route-index" style={{ '--route-color': item.color } as React.CSSProperties}>{index + 1}</span>
          <span className="route-result-main">
            <b>{item.title}</b>
            <small>{item.detail}</small>
            {item.fareText && <small style={{ color: 'var(--accent)', fontWeight: 600 }}>{item.fareText}</small>}
          </span>
          <span className="route-duration">{item.time}<small>{item.hops}</small></span>
          <Icon name="chevron" size={17}/>
        </button>
      ))}
      {filteredOptions.length === 0 && modes.length > 0 && (
        <div className="state-panel compact-state">
          <h3>{routeResult.status === 'error' ? '路線查詢失敗' : '目前沒有可驗證的班次方案'}</h3>
          <p>{routeResult.note ?? '可以直接交由外部地圖查詢大眾運輸或開車路線。'}</p>
          <div className="route-external-links">
            <a className="button-secondary" href={googleTransitUrl} target="_blank" rel="noreferrer">在 Google 地圖查大眾運輸</a>
            <a className="button-secondary" href={googleDrivingUrl} target="_blank" rel="noreferrer">在 Google 地圖查開車路線</a>
          </div>
        </div>
      )}
      {modes.length === 0 && <div className="state-panel compact-state"><h3>請至少選擇一種運具或導航模式</h3></div>}
    </div>

    {routeResult.status === 'error' && <div className="state-panel" role="alert"><div className="state-symbol state-error"><Icon name="info"/></div><h3>無法規劃這組起訖地點</h3><p>{routeResult.note ?? '請檢查起點與目的地，並選擇建議地點後重試。'}</p></div>}

    {selectedOption && (
      <div className="trip-detail" style={{ marginTop: 16, flexDirection: 'column', alignItems: 'stretch', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <span className="eyebrow">{selectedOption.mode} 導航與轉乘方案</span>
            <h3 style={{ margin: '4px 0 0' }}>{selectedOption.title}</h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {selectedOption.bookingLinks?.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className={link.primary ? 'button-primary' : 'button-secondary'}
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, fontSize: 14, fontWeight: 600 }}
              >
                <Icon name="arrow" size={15}/>{link.label}
              </a>
            ))}
            {selectedOption.navigationUrl && (
              <a
                href={selectedOption.navigationUrl}
                target="_blank"
                rel="noreferrer"
                className="button-secondary"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, fontSize: 14, fontWeight: 600 }}
              >
                <Icon name="pin" size={15}/>Google Maps 實景導航
              </a>
            )}
          </div>
        </div>

        {/* 互動式路線軌跡地圖 */}
        {selectedOption.path && selectedOption.path.length >= 2 && <div style={{ height: 270, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', position: 'relative' }}>
          <MapContainer center={routePath[0]} zoom={9} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
            <TileLayer attribution={MAP_ATTRIBUTION} url={MAP_TILE_URL}/>
            <FitRouteBounds path={routePath}/>
            <Polyline positions={routePath} pathOptions={{ color: selectedOption.color || '#0c817a', weight: 5, opacity: 0.88 }}/>
            <Marker position={routePath[0]} icon={EndpointIcon('起', '#0c817a')}>
              <Tooltip direction="top" permanent>出發：{submittedRoute.from}</Tooltip>
            </Marker>
            <Marker position={routePath[routePath.length - 1]} icon={EndpointIcon('終', '#d64545')}>
              <Tooltip direction="top" permanent>目的：{submittedRoute.to}</Tooltip>
            </Marker>
          </MapContainer>
        </div>}

        {/* 分段搭乘與導航步驟 (Step-by-Step) */}
        {!selectedOption.available && <div className="state-panel compact-state"><h3>此方案尚未在本站規劃</h3><p>{selectedOption.detail}</p></div>}

        {activeSteps.length > 0 && (
          <div>
            <b style={{ display: 'block', marginBottom: 8 }}>分段搭乘與導航步驟（Step-by-Step）</b>
            <div className="trip-list">
              {activeSteps.map((step) => (
                <div className="trip-row" key={step.stepNo} style={{ cursor: 'default' }}>
                  <span className="trip-time">步驟 {step.stepNo}<small>{step.vehicle}</small></span>
                  <span className="trip-route">
                    <b>{step.instruction}</b>
                    <span>{step.detail}</span>
                  </span>
                  <span className="trip-status">{step.duration}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 接續班次選擇表 */}
        {selectedOption.upcomingTrips.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <b>當日接續真實班次（點選可切換上方搭乘步驟）</b>
              <span className="demo-chip">共顯示 {selectedOption.upcomingTrips.length} 班</span>
            </div>
            <div className="trip-list">
              {selectedOption.upcomingTrips.map((trip, idx) => (
                <button
                  type="button"
                  className={`trip-row ${selectedTripIdx === idx ? 'trip-active' : ''}`}
                  key={`${trip.trainNo}-${trip.departure}`}
                  onClick={() => setSelectedTripIdx(idx)}
                >
                  <span className="trip-time">{trip.departure}<small>出發</small></span>
                  <span className="trip-route"><b>{trip.trainNo}</b><span>{trip.origin}<i/>{trip.destination}</span></span>
                  <span className="trip-arrival">{trip.arrival}<small>抵達</small></span>
                  <span className="trip-status">{trip.durationText}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <p style={{ margin: 0, fontSize: 13, opacity: 0.82 }}>
          資料來源：{selectedOption.source}・{selectedOption.fareText ? `票價／費用估算：${selectedOption.fareText}` : ''}
        </p>
      </div>
    )}

    <div className="route-disclaimer">
      <Icon name="info"/>
      <div>
          <b>{isLiveTdx ? '班次資料來源：交通部 TDX' : routeResult.status === 'error' ? '路線查詢未完成' : routeResult.tdxConfigured === false && !previewDemo ? 'TDX 班次不可用' : showingDemo ? '目前顯示 Demo 示意資料' : '路線資料說明'}</b>
          <p>{isLiveTdx ? '高鐵與台鐵僅在取得當日官方班表時才顯示班次；自駕時間為 OSRM 路徑估算，不代表即時交通。未接入完整轉乘規劃的運具會引導至外部地圖，不提供推測票價或班次。' : routeResult.status === 'error' ? (routeResult.note ?? '請修正起訖地點後重試。') : routeResult.tdxConfigured === false && !previewDemo ? 'TDX 憑證未設定。自駕道路估算仍可使用；高鐵、台鐵班次需查詢官方班表，或勾選 Demo 預覽檢視示意畫面。' : showingDemo ? 'Demo 資料只供介面預覽，不代表實際班次、行車時間或票價。' : '運具卡片會標明本站查詢、外部地圖引導或目前不可用。'} </p>
      </div>
    </div>
  </div>;
}


