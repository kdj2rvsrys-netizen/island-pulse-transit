import { useEffect, useState } from 'react';
import type { DataStatus } from '../types/transit';
import { APP_NAME, BRAND_NAME, NAV_ITEMS } from '../config/app';
import { useLocalPreference } from '../hooks/useLocalPreference';
import { Icon } from '../components/Icon';
import { MapPage } from '../features/map/MapPage';
import { EventsPage } from '../features/events/EventsPage';
import { TransitPage } from '../features/transit/TransitPage';
import { RoutesPage } from '../features/routes/RoutesPage';
import { SettingsPage } from '../features/settings/SettingsPage';

type Page = typeof NAV_ITEMS[number]['id'];
function getPage(): Page {
  const page = window.location.hash.replace('#', '').split('?')[0] as Page;
  return NAV_ITEMS.some((item) => item.id === page) ? page : 'map';
}
export function App() {
  const [page, setPage] = useState<Page>(getPage);
  const [status, setStatus] = useState<DataStatus>('available');
  const [locatedCoords, setLocatedCoords] = useState<[number, number] | undefined>();
  const [theme, setTheme] = useLocalPreference<'light' | 'dark'>('island-pulse-theme', 'light');
  useEffect(() => {
    const onHash = () => setPage(getPage());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const navigate = (next: string) => { window.location.hash = next; setPage(next as Page); };
  const active = NAV_ITEMS.find((item) => item.id === page)!;
  return <div className={`app-shell ${page === 'map' ? 'page-map' : ''}`}>
    <a className="skip-link" href="#main-content">跳至主要內容</a>
    <aside className="desktop-sidebar">
      <button className="brand-lockup" onClick={() => navigate('map')} aria-label={`${APP_NAME}首頁`}><span className="brand-mark"><span/></span><span className="brand-text"><b>{APP_NAME}</b><small>{BRAND_NAME}</small></span></button>
      <div className="sidebar-label">工作區</div>
      <nav className="primary-nav" aria-label="主要導覽">{NAV_ITEMS.map((item) => <button key={item.id} className={page === item.id ? 'nav-active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{item.id === 'events' && <i className="nav-count">LIVE</i>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="region-card"><div className="region-spark"><span/><span/><span/><span/><span/></div><div><small>目前範圍</small><b>台灣全區</b></div><Icon name="chevron" size={15}/></div><div className="demo-sidebar-note"><span/>官方資料 + DEMO</div><div className="sidebar-user"><span className="avatar-mark">島</span><span><b>訪客模式</b><small>偏好儲存於本機</small></span><button className="icon-button" aria-label="開啟設定" onClick={() => navigate('settings')}><Icon name="settings" size={17}/></button></div></div>
    </aside>
    <main id="main-content" className="main-area">
      <header className="topbar"><div className="mobile-brand"><span className="brand-mark"><span/></span><b>{APP_NAME}</b></div><div className="breadcrumb"><span>Island Pulse</span><Icon name="chevron" size={14}/><b>{active.label}</b></div><div className="topbar-right"><span className="demo-indicator"><i/>官方路況・測速清冊</span><button className="topbar-icon" aria-label={`切換為${theme === 'light' ? '深色' : '淺色'}主題`} title="切換主題" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={19}/></button><button className="topbar-profile" onClick={() => navigate('settings')} aria-label="設定"><span>島</span></button></div></header>
      <div className="page-content" key={page}>{page === 'map' ? <MapPage status={status} setStatus={setStatus} navigate={navigate} onLocateSuccess={setLocatedCoords}/> : page === 'events' ? <EventsPage status={status} setStatus={setStatus}/> : page === 'transit' ? <TransitPage/> : page === 'routes' ? <RoutesPage/> : <SettingsPage theme={theme} setTheme={setTheme} locatedCoords={locatedCoords}/>}</div>
    </main>
    <nav className="mobile-nav" aria-label="主要導覽">{NAV_ITEMS.map((item) => <button key={item.id} className={page === item.id ? 'mobile-nav-active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} size={20}/><span>{item.short}</span></button>)}</nav>
  </div>;
}
