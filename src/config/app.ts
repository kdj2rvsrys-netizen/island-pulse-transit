export const APP_NAME = '島嶼路網';
export const BRAND_NAME = 'Island Pulse';
export const MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
export const DEMO_UPDATED_AT = '2026-10-14 09:42';
export const NAV_ITEMS = [
  { id: 'map', label: '交通地圖', short: '地圖', icon: 'map' },
  { id: 'events', label: '道路交通', short: '事件', icon: 'alert' },
  { id: 'transit', label: '大眾運輸', short: '運輸', icon: 'train' },
  { id: 'routes', label: '跨運具搜尋', short: '路線', icon: 'route' },
  { id: 'settings', label: '設定', short: '設定', icon: 'settings' },
] as const;
