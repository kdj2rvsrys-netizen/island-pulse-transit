import { useEffect, useMemo, useState } from 'react';
import { demoEvents, eventLabels, severityLabels } from '../../data/demo';
import type { DataStatus, EventKind, RoadEvent, Severity } from '../../types/transit';
import { DataBadge } from '../../components/DataBadge';
import { Icon } from '../../components/Icon';
import { PageHeading } from '../../components/PageHeading';
import { transportService, type DatasetResult } from '../../services/transportService';

const kinds: EventKind[] = ['incident', 'roadwork', 'closure', 'congestion'];
export function EventsPage({ status, setStatus }: { status: DataStatus; setStatus: (status: DataStatus) => void }) {
  const [kind, setKind] = useState<EventKind | 'all'>('all');
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [query, setQuery] = useState('');
  const [includeCleared, setIncludeCleared] = useState(false);
  const [useDemo, setUseDemo] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const [eventResult, setEventResult] = useState<DatasetResult<RoadEvent>>({ data: [], status: 'loading', source: '內政部警政署警察廣播電臺・即時路況（資料集 15221）', updatedAt: '', confidence: 'official-live' });

  useEffect(() => {
    let active = true;
    transportService.getRoadEvents().then((result) => { if (active) setEventResult(result); }).catch((error: unknown) => {
      if (active) setEventResult({ data: [], status: 'error', source: '內政部警政署警察廣播電臺・即時路況（資料集 15221）', updatedAt: '', confidence: 'official-live', note: error instanceof Error ? error.message : '無法連接警廣即時路況服務。' });
    });
    return () => { active = false; };
  }, [reloadCount]);

  const rawEvents = useDemo ? demoEvents : eventResult.data;
  const latestDay = useMemo(() => rawEvents.reduce((max, item) => {
    const day = item.updatedAt?.slice(0, 10) ?? '';
    return day > max ? day : max;
  }, ''), [rawEvents]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => rawEvents.filter((event) => {
    if (!useDemo && !includeCleared) {
      if (event.cleared) return false;
      if (latestDay && event.updatedAt && !event.updatedAt.startsWith(latestDay)) return false;
    }
    return (kind === 'all' || event.kind === kind)
      && (severity === 'all' || event.severity === severity)
      && `${event.title} ${event.subKind ?? ''} ${event.location} ${event.description}`.toLowerCase().includes(normalizedQuery);
  }), [rawEvents, useDemo, includeCleared, latestDay, kind, severity, normalizedQuery]);

  const effectiveStatus: DataStatus = status !== 'available' ? status : useDemo ? 'available' : eventResult.status;
  const effectiveConfidence = useDemo ? 'demo' : eventResult.confidence;

  return <div className="content-page"><PageHeading eyebrow={useDemo ? 'ROAD CONDITIONS / DEMO' : 'LIVE ROAD CONDITIONS / OFFICIAL'} title="道路交通" description="查看全國即時道路事件、施工管制、影響方向與資料來源狀態。" action={<DataBadge status={effectiveStatus} confidence={effectiveConfidence}/>}/>
    <div className="demo-callout"><Icon name="info"/><span>{useDemo ? <><b>目前顯示 Demo 假資料</b>・並未反映當下實際路況。</> : <><b>已串接警廣即時路況（資料集 15221）</b>・{eventResult.note ?? '預設過濾已排除與過期紀錄。'}</>}</span><label>資料來源 <select value={useDemo ? 'demo' : 'official'} onChange={(e) => setUseDemo(e.target.value === 'demo')}><option value="official">警廣官方即時 (15221)</option><option value="demo">Demo 示範資料</option></select></label><label>狀態測試 <select value={status} onChange={(e) => setStatus(e.target.value as DataStatus)}><option value="available">正常顯示</option><option value="loading">載入中示意</option><option value="empty">無資料示意</option><option value="stale">資料過期示意</option><option value="error">載入錯誤示意</option></select></label></div>
    <div className="filter-toolbar"><label className="search-field"><Icon name="search"/><span className="sr-only">搜尋事件</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋道路、國道省道或路況說明"/></label><label className="select-field">事件類型<select value={kind} onChange={(e) => setKind(e.target.value as EventKind | 'all')}><option value="all">全部類型</option>{kinds.map((item) => <option key={item} value={item}>{eventLabels[item]}</option>)}</select></label><label className="select-field">嚴重程度<select value={severity} onChange={(e) => setSeverity(e.target.value as Severity | 'all')}><option value="all">全部程度</option><option value="high">嚴重</option><option value="medium">中度</option><option value="low">輕微</option></select></label>{!useDemo && <label className="select-field"><input type="checkbox" checked={includeCleared} onChange={(e) => setIncludeCleared(e.target.checked)}/>包含已排除／近期紀錄</label>}</div>
    {effectiveStatus === 'loading' ? <div className="state-panel"><span className="spinner"/><h3>正在同步即時道路事件</h3><p>保留既有畫面結構，等待官方開放資料回應。</p><button className="button-primary" onClick={() => setStatus('available')}>略過等待</button></div> : effectiveStatus === 'error' || effectiveStatus === 'unavailable' ? <div className="state-panel"><div className="state-symbol state-error"><Icon name="info"/></div><h3>暫時無法取得道路事件</h3><p>{eventResult.note ?? '請重試連線，或先切換檢視 Demo 示範資料。'}</p><div style={{ display: 'flex', gap: 10 }}><button className="button-primary" onClick={() => { setStatus('available'); setReloadCount((v) => v + 1); }}><Icon name="refresh" size={16}/>重試連線</button><button className="button-secondary" onClick={() => { setUseDemo(true); setStatus('available'); }}>改看 Demo 資料</button></div></div> : effectiveStatus === 'empty' || filtered.length === 0 ? <div className="state-panel"><div className="state-symbol"><Icon name="search"/></div><h3>沒有符合條件的事件</h3><p>目前篩選範圍沒有可用資料，可嘗試放寬條件或包含已排除事件。</p><button className="button-secondary" onClick={() => { setKind('all'); setSeverity('all'); setQuery(''); setIncludeCleared(true); setStatus('available'); }}>清除篩選並顯示全部</button></div> : <>
      {effectiveStatus === 'stale' && <div className="stale-banner full-banner"><Icon name="clock" size={16}/>資料已過期・最後更新 {eventResult.updatedAt || '08:12'}<button onClick={() => { setStatus('available'); setReloadCount((v) => v + 1); }}>重新同步</button></div>}
      <div className="results-summary"><b>共 {filtered.length} 筆{useDemo ? '示範' : '即時'}事件</b><span>最後更新：{useDemo ? '2026-10-14 09:42' : eventResult.updatedAt || '同步中'}・來源：{useDemo ? 'Island Pulse Demo' : eventResult.source}</span></div>
      <div className="event-table">{filtered.slice(0, 80).map((event) => <article className="event-card" key={event.id}><div className={`event-icon kind-${event.kind}`}><Icon name={event.kind === 'incident' ? 'alert' : event.kind === 'roadwork' ? 'building' : event.kind === 'closure' ? 'close' : 'car'}/></div><div className="event-card-main"><div className="event-card-tags"><span className={`kind-text kind-text-${event.kind}`}>{event.subKind ? `${eventLabels[event.kind]}・${event.subKind}` : eventLabels[event.kind]}</span><span className={`severity severity-${event.severity}`}>{severityLabels[event.severity]}</span>{event.cleared && <span className="severity">已排除</span>}</div><h2>{event.title}</h2><p>{event.location} — {event.description}</p><small>{event.direction}・通報時間 {event.observedAt}{event.authority ? `・${event.authority}` : ''}</small></div><div className="event-card-side"><DataBadge confidence={event.meta.confidence}/><span><Icon name="clock" size={14}/>{event.expectedClearance ? `預計 ${event.expectedClearance}` : event.updatedAt ? `更新 ${event.updatedAt.slice(11, 16)}` : '持續觀察'}</span><button className="button-secondary" onClick={() => { window.location.hash = `#map?event=${encodeURIComponent(event.id)}`; }}>在地圖查看<Icon name="arrow" size={15}/></button></div></article>)}</div>
    </>}
  </div>;
}
