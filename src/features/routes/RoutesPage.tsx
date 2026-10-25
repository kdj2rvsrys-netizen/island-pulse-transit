import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { transportModes } from '../../data/demo';
import type { Mode, MultiModalRouteResult, RouteOptionItem } from '../../types/transit';
import { DataBadge } from '../../components/DataBadge';
import { Icon } from '../../components/Icon';
import { PageHeading } from '../../components/PageHeading';
import { transportService } from '../../services/transportService';

const HUB_SUGGESTIONS = [
  '南港車站',
  '臺北車站',
  '板橋車站',
  '基隆車站',
  '桃園高鐵站',
  '新竹高鐵站',
  '苗栗車站',
  '臺中車站',
  '彰化車站',
  '雲林高鐵站',
  '嘉義車站',
  '臺南車站',
  '左營站',
  '高雄車站',
  '屏東車站',
  '宜蘭車站',
  '花蓮車站',
  '臺東車站',
];

const CORRIDOR_PRESETS = [
  { label: '臺北 ↔ 左營', from: '臺北車站', to: '左營站' },
  { label: '臺北 ↔ 臺中', from: '臺北車站', to: '臺中車站' },
  { label: '臺北 ↔ 新竹', from: '臺北車站', to: '新竹高鐵站' },
  { label: '臺北 ↔ 花蓮', from: '臺北車站', to: '花蓮車站' },
  { label: '板橋 ↔ 臺南', from: '板橋車站', to: '臺南車站' },
];

function getInitialDepartAt() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function RoutesPage() {
  const [from, setFrom] = useState('臺北車站');
  const [to, setTo] = useState('左營站');
  const [departAt, setDepartAt] = useState(getInitialDepartAt);
  const [modes, setModes] = useState<Mode[]>(['高鐵', '台鐵', '捷運', '公車']);
  const [submittedRoute, setSubmittedRoute] = useState<{ from: string; to: string; departAt: string }>(() => ({
    from: '臺北車站',
    to: '左營站',
    departAt: getInitialDepartAt(),
  }));
  const [selectedMode, setSelectedMode] = useState<Mode | undefined>('高鐵');
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

  const toggle = (mode: Mode) => setModes((current) => current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode]);

  const demoFallbackOptions: RouteOptionItem[] = useMemo(() => {
    const origin = submittedRoute.from;
    const dest = submittedRoute.to;
    return [
      { mode: '高鐵', available: true, title: `高鐵城際直達・${origin} → ${dest}`, time: '1 小時 49 分', detail: `${origin} → ${dest}・Demo 示意班表`, color: '#0c817a', hops: '直達', confidence: 'demo', source: 'Island Pulse Demo', upcomingTrips: [] },
      { mode: '台鐵', available: true, title: `台鐵自強號・${origin} → ${dest}`, time: '2 小時 25 分', detail: `${origin} → ${dest}・Demo 示意班表`, color: '#da8a2c', hops: '直達', confidence: 'demo', source: 'Island Pulse Demo', upcomingTrips: [] },
      { mode: '捷運', available: true, title: `都會捷運轉乘・${origin} → ${dest}`, time: '42 分', detail: `${origin} → ${dest}・Demo 示意`, color: '#4d6b9e', hops: '1 次轉乘', confidence: 'demo', source: 'Island Pulse Demo', upcomingTrips: [] },
      { mode: '公車', available: true, title: `幹線公車／國道客運・${origin} → ${dest}`, time: '2 小時 50 分', detail: `${origin} → ${dest}・Demo 示意`, color: '#5175a4', hops: '1 次轉乘', confidence: 'demo', source: 'Island Pulse Demo', upcomingTrips: [] },
      { mode: '航班', available: true, title: `國內外航線接駁・${origin} → ${dest}`, time: '1 小時 15 分', detail: `${origin} → ${dest}・Demo 示意`, color: '#4074b3', hops: '機場轉乘', confidence: 'demo', source: 'Island Pulse Demo', upcomingTrips: [] },
    ];
  }, [submittedRoute]);

  const isLiveTdx = routeResult.status === 'available' && routeResult.options.length > 0;
  const activeOptions = isLiveTdx ? routeResult.options : demoFallbackOptions;
  const filteredOptions = activeOptions.filter((item) => modes.includes(item.mode));
  const selectedOption = filteredOptions.find((item) => item.mode === selectedMode) ?? filteredOptions[0];

  return <div className="content-page routes-page">
    <PageHeading
      eyebrow={isLiveTdx ? 'MULTI-MODAL JOURNEY / TDX OD LIVE' : 'MULTI-MODAL JOURNEY / DEMO'}
      title="跨運具搜尋"
      description="輸入起訖城市或車站，即時比對 TDX 高鐵、台鐵真實 OD 班次與轉乘建議。"
      action={<DataBadge status={routeResult.status === 'loading' ? 'loading' : 'available'} confidence={isLiveTdx ? 'scheduled' : 'demo'}/>}
    />
    <div className="route-banner">
      <div className="route-banner-mark"><Icon name="route" size={25}/></div>
      <div>
        <b>{isLiveTdx ? `已連線 TDX 起訖時刻表（${routeResult.resolvedOrigin} → ${routeResult.resolvedDestination}）` : '一趟旅程，多種走法'}</b>
        <p>{isLiveTdx ? '點按下方高鐵或台鐵方案可展開指定時間後的真實接續車次與發車／抵達時刻。' : '輸入起訖點比較不同運具的行程結構。'}</p>
      </div>
      <span>{isLiveTdx ? 'TDX OD 真實班表' : '路線預覽'}</span>
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
          <div><Icon name="pin"/><input list="taiwan-hubs" required value={from} onChange={(e) => setFrom(e.target.value)} aria-label="出發地" placeholder="如：臺北車站、板橋、臺中"/></div>
        </label>
        <button type="button" className="swap-button" aria-label="交換起點與終點" onClick={swap}><Icon name="refresh"/></button>
        <label className="route-field">
          <span>目的地</span>
          <div><Icon name="pin"/><input list="taiwan-hubs" required value={to} onChange={(e) => setTo(e.target.value)} aria-label="目的地" placeholder="如：左營站、花蓮車站、臺南"/></div>
        </label>
      </div>
      <label className="route-field depart-field"><span>出發時間</span><input type="datetime-local" value={departAt} onChange={(e) => setDepartAt(e.target.value)}/></label>
      <fieldset className="mode-checks"><legend>比較運具</legend>{transportModes.map((mode) => <label key={mode}><input type="checkbox" checked={modes.includes(mode)} onChange={() => toggle(mode)}/><span className="custom-check"><Icon name="check" size={13}/></span>{mode}</label>)}</fieldset>
      <button type="submit" className="button-primary search-route-button"><Icon name="search"/>查詢跨運具班次</button>
    </form>

    <div className="route-results-head">
      <div><p className="eyebrow">SUGGESTED ROUTES</p><h2>{submittedRoute.from} → {submittedRoute.to}</h2></div>
      <span>出發：{submittedRoute.departAt.replace('T', ' ')}（{isLiveTdx ? 'TDX 真實班表' : 'Demo 示意'}）</span>
    </div>

    <div className="route-results">
      {filteredOptions.map((item, index) => (
        <button
          key={item.mode}
          className={`route-result ${selectedOption?.mode === item.mode ? 'route-selected' : ''}`}
          onClick={() => setSelectedMode(item.mode)}
        >
          <span className="route-index" style={{ '--route-color': item.color } as React.CSSProperties}>{index + 1}</span>
          <span className="route-result-main">
            <b>{item.title}</b>
            <small>{item.detail}</small>
          </span>
          <span className="route-duration">{item.time}<small>{item.hops}</small></span>
          <Icon name="chevron" size={17}/>
        </button>
      ))}
      {modes.length === 0 && <div className="state-panel compact-state"><h3>請至少選擇一種運具</h3></div>}
    </div>

    {selectedOption && (
      <div className="trip-detail" style={{ marginTop: 14, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b>{selectedOption.mode}方案詳情・{selectedOption.title}</b>
          <span className="demo-chip">{selectedOption.upcomingTrips.length > 0 ? `接續 ${selectedOption.upcomingTrips.length} 班車` : selectedOption.hops}</span>
        </div>
        <p style={{ margin: 0 }}>{selectedOption.detail}（來源：{selectedOption.source}）</p>
        {selectedOption.upcomingTrips.length > 0 && (
          <div className="trip-list" style={{ marginTop: 6 }}>
            {selectedOption.upcomingTrips.map((trip) => (
              <div className="trip-row" key={`${trip.trainNo}-${trip.departure}`} style={{ cursor: 'default' }}>
                <span className="trip-time">{trip.departure}<small>出發</small></span>
                <span className="trip-route"><b>{trip.trainNo}</b><span>{trip.origin}<i/>{trip.destination}</span></span>
                <span className="trip-arrival">{trip.arrival}<small>抵達</small></span>
                <span className="trip-status">{trip.durationText}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )}

    <div className="route-disclaimer">
      <Icon name="info"/>
      <div>
        <b>{isLiveTdx ? '資料來源：交通部 TDX 運輸資料流通服務平臺' : '尚未連接 TDX 路線查詢'}</b>
        <p>{isLiveTdx ? '高鐵與台鐵顯示當日官方 OD 班表與實際行車歷時；跨縣市轉乘捷運、市區公車或航班請預留站間步行與候車時間。' : '目前顯示 Demo 示意資料。'}</p>
      </div>
    </div>
  </div>;
}

