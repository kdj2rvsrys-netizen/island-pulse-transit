import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { transportModes } from '../../data/demo';
import type { Mode } from '../../types/transit';
import { Icon } from '../../components/Icon';
import { PageHeading } from '../../components/PageHeading';

export function RoutesPage() {
  const [from, setFrom] = useState('臺北車站');
  const [to, setTo] = useState('左營站');
  const [departAt, setDepartAt] = useState('2026-10-25T10:00');
  const [modes, setModes] = useState<Mode[]>(['高鐵', '台鐵', '公車']);
  const [submittedRoute, setSubmittedRoute] = useState<{ from: string; to: string; departAt: string }>({ from: '臺北車站', to: '左營站', departAt: '2026-10-25T10:00' });
  const [selected, setSelected] = useState<string | undefined>();
  const swap = () => { setFrom(to); setTo(from); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedRoute({ from: from.trim() || '臺北車站', to: to.trim() || '左營站', departAt });
    setSelected(undefined);
  };
  const toggle = (mode: Mode) => setModes((current) => current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode]);

  const suggestions = useMemo(() => {
    const origin = submittedRoute.from;
    const dest = submittedRoute.to;
    return [
      { mode: '高鐵' as Mode, title: `高鐵城際直達・${origin} → ${dest}`, time: '1 小時 49 分', detail: `${origin} → ${dest}・示意票價 NT$1,490`, color: '#0c817a', hops: '直達' },
      { mode: '台鐵' as Mode, title: `台鐵自強號・${origin} → ${dest}`, time: '2 小時 25 分', detail: `${origin} → ${dest}・示意票價 NT$650`, color: '#da8a2c', hops: '直達' },
      { mode: '捷運' as Mode, title: `都會捷運轉乘・${origin} → ${dest}`, time: '42 分', detail: `${origin} → ${dest}・示意票價 NT$50`, color: '#4d6b9e', hops: '1 次轉乘' },
      { mode: '公車' as Mode, title: `幹線公車／國道客運・${origin} → ${dest}`, time: '2 小時 50 分', detail: `${origin} → ${dest}・示意票價 NT$580`, color: '#5175a4', hops: '1 次轉乘' },
      { mode: '航班' as Mode, title: `國內外航線接駁・${origin} → ${dest}`, time: '1 小時 15 分', detail: `${origin} → ${dest}・示意票價 NT$2,100`, color: '#4074b3', hops: '機場轉乘' },
    ];
  }, [submittedRoute]);

  return <div className="content-page routes-page"><PageHeading eyebrow="MULTI-MODAL JOURNEY / DEMO" title="跨運具搜尋" description="比較不同交通方式的行程資訊（Phase 5 規劃功能預覽）。"/>
    <div className="route-banner"><div className="route-banner-mark"><Icon name="route" size={25}/></div><div><b>一趟旅程，多種走法</b><p>輸入起訖點，看看不同運具的 Demo 行程結構。</p></div><span>路線規劃 Demo</span></div>
    <form className="route-form" onSubmit={submit}><div className="route-fields"><label className="route-field"><span>出發地</span><div><Icon name="pin"/><input required value={from} onChange={(e) => setFrom(e.target.value)} aria-label="出發地"/></div></label><button type="button" className="swap-button" aria-label="交換起點與終點" onClick={swap}><Icon name="refresh"/></button><label className="route-field"><span>目的地</span><div><Icon name="pin"/><input required value={to} onChange={(e) => setTo(e.target.value)} aria-label="目的地"/></div></label></div>
      <label className="route-field depart-field"><span>出發時間</span><input type="datetime-local" value={departAt} onChange={(e) => setDepartAt(e.target.value)}/></label>
      <fieldset className="mode-checks"><legend>比較運具</legend>{transportModes.map((mode) => <label key={mode}><input type="checkbox" checked={modes.includes(mode)} onChange={() => toggle(mode)}/><span className="custom-check"><Icon name="check" size={13}/></span>{mode}</label>)}</fieldset>
      <button type="submit" className="button-primary search-route-button"><Icon name="search"/>搜尋示意路線</button>
    </form>
    <div className="route-results-head"><div><p className="eyebrow">SUGGESTED ROUTES</p><h2>{submittedRoute.from} → {submittedRoute.to}</h2></div><span>出發：{submittedRoute.departAt.replace('T', ' ')}（Demo 示意）</span></div>
    <div className="route-results">{suggestions.filter((item) => modes.includes(item.mode)).map((item, index) => <button key={item.title} className={`route-result ${selected === item.title ? 'route-selected' : ''}`} onClick={() => setSelected(item.title)}><span className="route-index" style={{ '--route-color': item.color } as React.CSSProperties}>{index + 1}</span><span className="route-result-main"><b>{item.title}</b><small>{item.detail}</small></span><span className="route-duration">{item.time}<small>{item.hops}</small></span><Icon name="chevron" size={17}/></button>)}{modes.length === 0 && <div className="state-panel compact-state"><h3>請至少選擇一種運具</h3></div>}</div>
    {selected && <div className="route-selection"><Icon name="check"/>已選擇「{selected}」示意結果。行程詳情仍為 Demo。</div>}
    <div className="route-disclaimer"><Icon name="info"/><div><b>尚未串接真實路線規劃服務</b><p>結果、時間、票價及轉乘方式均為 Demo 假資料，不可用於實際出行決策。</p></div></div>
  </div>;
}
