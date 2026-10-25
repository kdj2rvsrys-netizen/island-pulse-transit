import { useEffect, useMemo, useState } from 'react';
import { demoTrips, transportModes } from '../../data/demo';
import type { Mode, TransitTrip } from '../../types/transit';
import { DataBadge } from '../../components/DataBadge';
import { Icon } from '../../components/Icon';
import { PageHeading } from '../../components/PageHeading';
import { transportService, type DatasetResult } from '../../services/transportService';

const modeIcons: Record<Mode, string> = { '高鐵': 'train', '台鐵': 'train', '捷運': 'train', '公車': 'bus', '航班': 'plane' };
const modeColors: Record<Mode, string> = { '高鐵': 'mode-thsr', '台鐵': 'mode-tra', '捷運': 'mode-metro', '公車': 'mode-bus', '航班': 'mode-air' };
export function TransitPage() {
  const [mode, setMode] = useState<Mode>('高鐵');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TransitTrip | undefined>();
  const [previewDemo, setPreviewDemo] = useState(true);
  const [tripResult, setTripResult] = useState<DatasetResult<TransitTrip>>({ data: [], status: 'loading', source: '交通部 TDX 運輸資料流通服務平臺', updatedAt: '', confidence: 'scheduled' });

  useEffect(() => {
    let active = true;
    transportService.getTrips(mode).then((result) => {
      if (!active) return;
      setTripResult(result);
      if (result.status === 'available') setPreviewDemo(false);
    }).catch((error: unknown) => {
      if (active) setTripResult({ data: [], status: 'error', source: '交通部 TDX 運輸資料流通服務平臺', updatedAt: '', confidence: 'scheduled', note: error instanceof Error ? error.message : '無法連接大眾運輸服務。' });
    });
    return () => { active = false; };
  }, [mode]);

  const isUnavailable = tripResult.status === 'unavailable' || tripResult.status === 'error';
  const showingDemo = isUnavailable && previewDemo;
  const sourceTrips = useMemo(() => (showingDemo ? demoTrips.filter((trip) => trip.mode === mode) : tripResult.data), [showingDemo, mode, tripResult.data]);
  const normalizedQuery = query.trim().toLowerCase();
  const rows = useMemo(() => sourceTrips.filter((trip) => `${trip.route} ${trip.origin} ${trip.destination}`.toLowerCase().includes(normalizedQuery)), [sourceTrips, normalizedQuery]);

  return <div className="content-page"><PageHeading eyebrow={showingDemo ? 'TRANSIT NETWORK / DEMO PREVIEW' : 'TRANSIT NETWORK / TDX'} title="大眾運輸" description="依運具瀏覽站點、路線與班次資訊。" action={<DataBadge status={showingDemo ? 'available' : tripResult.status} confidence={showingDemo ? 'demo' : tripResult.confidence}/>}/>
    <div className="demo-callout"><Icon name="info"/><span>{tripResult.status === 'unavailable' ? <><b>尚未設定 TDX 伺服器憑證</b>・在 <code>.env</code> 設定 <code>TDX_CLIENT_ID</code> 與 <code>TDX_CLIENT_SECRET</code> 後即可啟用真實班次。</> : showingDemo ? <><b>目前為 Demo 示意班次</b>・非實際營運狀態。</> : <><b>已連接 TDX 運輸服務</b>・來源：{tripResult.source}</>}</span>{isUnavailable && <label><input type="checkbox" checked={previewDemo} onChange={(e) => setPreviewDemo(e.target.checked)}/> 預覽 Demo 示意班次</label>}</div>
    <div className="mode-tabs" role="tablist" aria-label="運輸類別">{transportModes.map((item) => <button role="tab" aria-selected={mode === item} className={mode === item ? 'active' : ''} key={item} onClick={() => { setMode(item); setSelected(undefined); }}><Icon name={modeIcons[item]}/>{item}</button>)}</div>
    <div className="transit-intro"><div className={`mode-emblem ${modeColors[mode]}`}><Icon name={modeIcons[mode]} size={24}/></div><div><h2>{mode}資訊</h2><p>{mode === '高鐵' ? '城際高速鐵路・班次與路線概覽' : mode === '台鐵' ? '環島鐵路・車站與列車即時看板概覽' : mode === '捷運' ? '都會捷運・首末班車與到站資訊概覽' : mode === '公車' ? '市區與公路客運・路線預估到站概覽' : '國內外航線・即時航班狀態概覽'}</p></div><span className="demo-chip">{showingDemo ? 'DEMO PREVIEW' : tripResult.status === 'available' ? 'TDX LIVE' : 'TDX PENDING'}</span></div>
    <div className="transit-search-row"><label className="search-field"><Icon name="search"/><span className="sr-only">搜尋站點或路線</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋站點、路線或班次"/></label><span className="updated-line"><Icon name="clock" size={15}/>{showingDemo ? '示意更新時間 09:42' : `資料更新：${tripResult.updatedAt || '尚未同步'}`}</span></div>
    {selected && <div className="trip-detail"><div className="trip-route-line"><span>{selected.origin}</span><i/><span>{selected.destination}</span></div><div><b>{selected.route}</b><small>{selected.departure} 出發・{selected.arrival} 抵達</small></div><p>{showingDemo ? '此行程僅為版面示範，非實際班表或即時狀態。' : `資料來源：${selected.meta.source}`}</p><button className="icon-button" aria-label="關閉班次詳情" onClick={() => setSelected(undefined)}><Icon name="close"/></button></div>}
    {!showingDemo && isUnavailable ? <div className="state-panel"><div className="state-symbol"><Icon name="info"/></div><h3>尚未啟用 TDX 即時班次服務</h3><p>{tripResult.note ?? '請在伺服器端設定 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET，或開啟上方「預覽 Demo 示意班次」檢視版面。'}</p><button className="button-secondary" onClick={() => setPreviewDemo(true)}>開啟 Demo 示意預覽</button></div> : <div className="trip-list">{rows.length ? rows.map((trip) => <button className={`trip-row ${selected?.id === trip.id ? 'trip-active' : ''}`} key={trip.id} onClick={() => setSelected(trip)}><span className="trip-time">{trip.departure}<small>出發</small></span><span className="trip-route"><b>{trip.route}</b><span>{trip.origin}<i/>{trip.destination}</span></span><span className="trip-arrival">{trip.arrival}<small>{showingDemo ? '預計抵達示意' : '預計抵達'}</small></span><span className="trip-status">{trip.status}</span><Icon name="chevron" size={17}/></button>) : <div className="state-panel compact-state"><h3>沒有符合的班次</h3><p>調整搜尋關鍵字，或切換其他運具。</p></div>}</div>}
    <div className="source-note"><Icon name="info" size={16}/><span><b>資料狀態：{showingDemo ? 'Demo 示意（待設定 TDX 金鑰）' : tripResult.source}</b>・{showingDemo ? '目前顯示介面示意班次，未代表實際營運資訊。' : tripResult.note ?? '由伺服器端代理讀取 TDX 標準 API。'}</span></div>
  </div>;
}
