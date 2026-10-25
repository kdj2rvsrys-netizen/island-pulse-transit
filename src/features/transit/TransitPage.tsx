import { useEffect, useMemo, useState } from 'react';
import { demoTrips, transportModes } from '../../data/demo';
import type { Mode, TransitTrip } from '../../types/transit';
import { DataBadge } from '../../components/DataBadge';
import { Icon } from '../../components/Icon';
import { PageHeading } from '../../components/PageHeading';
import { transportService, type DatasetResult } from '../../services/transportService';

const modeIcons: Record<Mode, string> = { '高鐵': 'train', '台鐵': 'train', '捷運': 'train', '公車': 'bus', '航班': 'plane' };
const modeColors: Record<Mode, string> = { '高鐵': 'mode-thsr', '台鐵': 'mode-tra', '捷運': 'mode-metro', '公車': 'mode-bus', '航班': 'mode-air' };

const THSR_STATIONS = [
  { id: 'all', label: '全線班次' },
  { id: '0990', label: '南港' },
  { id: '1000', label: '台北' },
  { id: '1010', label: '板橋' },
  { id: '1020', label: '桃園' },
  { id: '1030', label: '新竹' },
  { id: '1035', label: '苗栗' },
  { id: '1040', label: '台中' },
  { id: '1043', label: '彰化' },
  { id: '1047', label: '雲林' },
  { id: '1050', label: '嘉義' },
  { id: '1060', label: '台南' },
  { id: '1070', label: '左營' },
];

const TRA_STATIONS = [
  { id: 'all', label: '全線即時看板' },
  { id: '0900', label: '基隆' },
  { id: '0980', label: '南港' },
  { id: '1000', label: '臺北' },
  { id: '1020', label: '板橋' },
  { id: '1080', label: '桃園' },
  { id: '1100', label: '中壢' },
  { id: '1210', label: '新竹' },
  { id: '3160', label: '苗栗' },
  { id: '3300', label: '臺中' },
  { id: '3360', label: '彰化' },
  { id: '3470', label: '斗六' },
  { id: '4080', label: '嘉義' },
  { id: '4220', label: '臺南' },
  { id: '4340', label: '新左營' },
  { id: '4400', label: '高雄' },
  { id: '5000', label: '屏東' },
  { id: '7190', label: '宜蘭' },
  { id: '7000', label: '花蓮' },
  { id: '6000', label: '臺東' },
];

const METRO_OPERATORS = [
  { id: 'TRTC', label: '台北捷運 (TRTC)' },
  { id: 'KRTC', label: '高雄捷運 (KRTC)' },
  { id: 'TYMC', label: '桃園機場捷運 (TYMC)' },
  { id: 'TMRT', label: '台中捷運 (TMRT)' },
];

const BUS_CITIES = [
  { id: 'Taipei', label: '台北市' },
  { id: 'NewTaipei', label: '新北市' },
  { id: 'Taoyuan', label: '桃園市' },
  { id: 'Taichung', label: '台中市' },
  { id: 'Tainan', label: '台南市' },
  { id: 'Kaohsiung', label: '高雄市' },
  { id: 'Keelung', label: '基隆市' },
  { id: 'Hsinchu', label: '新竹市' },
];

const AIRPORTS = [
  { id: 'TPE', label: '桃園國際機場 (TPE)' },
  { id: 'TSA', label: '臺北松山機場 (TSA)' },
  { id: 'KHH', label: '高雄國際機場 (KHH)' },
  { id: 'RMQ', label: '臺中國際機場 (RMQ)' },
];

export function TransitPage() {
  const [mode, setMode] = useState<Mode>('高鐵');
  const [query, setQuery] = useState('');
  const [thsrStation, setThsrStation] = useState('all');
  const [traStation, setTraStation] = useState('all');
  const [metroOperator, setMetroOperator] = useState('TRTC');
  const [busCity, setBusCity] = useState('Taipei');
  const [busRoute, setBusRoute] = useState('');
  const [airport, setAirport] = useState('TPE');
  const [refreshTick, setRefreshTick] = useState(0);
  const [selected, setSelected] = useState<TransitTrip | undefined>();
  const [previewDemo, setPreviewDemo] = useState(true);
  const [tripResult, setTripResult] = useState<DatasetResult<TransitTrip>>({ data: [], status: 'loading', source: '交通部 TDX 運輸資料流通服務平臺', updatedAt: '', confidence: 'scheduled' });

  useEffect(() => {
    let active = true;
    const station = mode === '高鐵' ? thsrStation : mode === '台鐵' ? traStation : 'all';
    transportService.getTrips(mode, {
      station,
      operator: metroOperator,
      city: busCity,
      route: busRoute,
      airport,
      refresh: refreshTick > 0,
    }).then((result) => {
      if (!active) return;
      setTripResult(result);
      if (result.status === 'available' || result.status === 'empty') setPreviewDemo(false);
    }).catch((error: unknown) => {
      if (active) setTripResult({ data: [], status: 'error', source: '交通部 TDX 運輸資料流通服務平臺', updatedAt: '', confidence: 'scheduled', note: error instanceof Error ? error.message : '無法連接大眾運輸服務。' });
    });
    return () => { active = false; };
  }, [mode, thsrStation, traStation, metroOperator, busCity, busRoute, airport, refreshTick]);

  const isUnavailable = tripResult.status === 'unavailable' || tripResult.status === 'error';
  const showingDemo = isUnavailable && previewDemo;
  const sourceTrips = useMemo(() => (showingDemo ? demoTrips.filter((trip) => trip.mode === mode) : tripResult.data), [showingDemo, mode, tripResult.data]);
  const normalizedQuery = query.trim().toLowerCase();
  const rows = useMemo(() => sourceTrips.filter((trip) => `${trip.route} ${trip.origin} ${trip.destination} ${trip.status}`.toLowerCase().includes(normalizedQuery)), [sourceTrips, normalizedQuery]);

  return <div className="content-page"><PageHeading eyebrow={showingDemo ? 'TRANSIT NETWORK / DEMO PREVIEW' : 'TRANSIT NETWORK / TDX'} title="大眾運輸" description="依運具、縣市、車站或機場瀏覽即時到離站與班次資訊。" action={<DataBadge status={showingDemo ? 'available' : tripResult.status} confidence={showingDemo ? 'demo' : tripResult.confidence}/>}/>
    <div className="demo-callout"><Icon name="info"/><span>{tripResult.status === 'unavailable' ? <><b>尚未設定 TDX 伺服器憑證</b>・在 <code>.env</code> 設定 <code>TDX_CLIENT_ID</code> 與 <code>TDX_CLIENT_SECRET</code> 後即可啟用真實班次。</> : showingDemo ? <><b>目前為 Demo 示意班次</b>・非實際營運狀態。</> : <><b>已連接 TDX 運輸服務</b>・來源：{tripResult.source}（共 {rows.length} 筆）</>}</span>{isUnavailable && <label><input type="checkbox" checked={previewDemo} onChange={(e) => setPreviewDemo(e.target.checked)}/> 預覽 Demo 示意班次</label>}</div>
    <div className="mode-tabs" role="tablist" aria-label="運輸類別">{transportModes.map((item) => <button role="tab" aria-selected={mode === item} className={mode === item ? 'active' : ''} key={item} onClick={() => { setMode(item); setSelected(undefined); }}><Icon name={modeIcons[item]}/>{item}</button>)}</div>
    <div className="transit-intro"><div className={`mode-emblem ${modeColors[mode]}`}><Icon name={modeIcons[mode]} size={24}/></div><div><h2>{mode}資訊</h2><p>{mode === '高鐵' ? '城際高速鐵路・可依停靠站篩選當日班表' : mode === '台鐵' ? '環島鐵路・可依主要車站查看即時列車看板與誤點' : mode === '捷運' ? '都會捷運・可切換北捷、高捷、桃捷、中捷首末班車' : mode === '公車' ? '市區客運・可切換縣市與輸入路線號碼查詢預估到站' : '國內外航線・可切換桃園、松山、高雄、台中機場航班'}</p></div><span className="demo-chip">{showingDemo ? 'DEMO PREVIEW' : tripResult.status === 'available' ? 'TDX LIVE' : 'TDX SYNC'}</span></div>

    <div className="filter-toolbar">
      <label className="search-field"><Icon name="search"/><span className="sr-only">搜尋站點或路線</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="在結果中篩選站名、車次或狀態"/></label>
      {mode === '高鐵' && (
        <label className="select-field">停靠車站
          <select value={thsrStation} onChange={(e) => setThsrStation(e.target.value)}>
            {THSR_STATIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      )}
      {mode === '台鐵' && (
        <label className="select-field">車站看板
          <select value={traStation} onChange={(e) => setTraStation(e.target.value)}>
            {TRA_STATIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      )}
      {mode === '捷運' && (
        <label className="select-field">營運系統
          <select value={metroOperator} onChange={(e) => setMetroOperator(e.target.value)}>
            {METRO_OPERATORS.map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
          </select>
        </label>
      )}
      {mode === '公車' && (
        <>
          <label className="select-field">縣市
            <select value={busCity} onChange={(e) => setBusCity(e.target.value)}>
              {BUS_CITIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="select-field">指定路線
            <input
              type="text"
              value={busRoute}
              onChange={(e) => setBusRoute(e.target.value)}
              placeholder="如 307、紅30（選填）"
              style={{ width: 140, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
            />
          </label>
        </>
      )}
      {mode === '航班' && (
        <label className="select-field">出發機場
          <select value={airport} onChange={(e) => setAirport(e.target.value)}>
            {AIRPORTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
      )}
      <button type="button" className="button-secondary" onClick={() => setRefreshTick((v) => v + 1)}>
        <Icon name="refresh" size={15}/>重新整理
      </button>
    </div>

    <div className="transit-search-row"><span className="updated-line"><Icon name="clock" size={15}/>{showingDemo ? '示意更新時間 09:42' : `資料更新：${tripResult.updatedAt || '同步中'}`}</span></div>
    {selected && <div className="trip-detail"><div className="trip-route-line"><span>{selected.origin}</span><i/><span>{selected.destination}</span></div><div><b>{selected.route}</b><small>{selected.departure} 出發・{selected.arrival} 抵達（{selected.status}）</small></div><p>{showingDemo ? '此行程僅為版面示範，非實際班表或即時狀態。' : `資料來源：${selected.meta.source}`}</p><button className="icon-button" aria-label="關閉班次詳情" onClick={() => setSelected(undefined)}><Icon name="close"/></button></div>}
    {!showingDemo && isUnavailable ? <div className="state-panel"><div className="state-symbol"><Icon name="info"/></div><h3>尚未啟用 TDX 即時班次服務</h3><p>{tripResult.note ?? '請在伺服器端設定 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET，或開啟上方「預覽 Demo 示意班次」檢視版面。'}</p><button className="button-secondary" onClick={() => setPreviewDemo(true)}>開啟 Demo 示意預覽</button></div> : <div className="trip-list">{rows.length ? rows.map((trip) => <button className={`trip-row ${selected?.id === trip.id ? 'trip-active' : ''}`} key={trip.id} onClick={() => setSelected(trip)}><span className="trip-time">{trip.departure}<small>{mode === '公車' ? '預估' : mode === '捷運' ? '首班' : '出發'}</small></span><span className="trip-route"><b>{trip.route}</b><span>{trip.origin}<i/>{trip.destination}</span></span><span className="trip-arrival">{trip.arrival}<small>{showingDemo ? '預計抵達示意' : mode === '捷運' ? '末班' : mode === '公車' ? '更新時間' : '預計抵達'}</small></span><span className="trip-status">{trip.status}</span><Icon name="chevron" size={17}/></button>) : <div className="state-panel compact-state"><h3>沒有符合條件的班次</h3><p>請嘗試切換車站、縣市或調整搜尋關鍵字。</p></div>}</div>}
    <div className="source-note"><Icon name="info" size={16}/><span><b>資料狀態：{showingDemo ? 'Demo 示意（待設定 TDX 金鑰）' : tripResult.source}</b>・{showingDemo ? '目前顯示介面示意班次，未代表實際營運資訊。' : tripResult.note ?? '由伺服器端代理讀取 TDX 標準 API。'}</span></div>
  </div>;
}

