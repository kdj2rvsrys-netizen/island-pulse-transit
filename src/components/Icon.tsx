import type { SVGProps } from 'react';

const paths: Record<string, React.ReactNode> = {
  map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15m6-12v15"/></>,
  alert: <><path d="M10.3 3.9 2.6 17.2a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></>,
  train: <><rect x="4" y="3" width="16" height="14" rx="3"/><path d="M8 21h8m-4-4v4m-4-9h8M8 7h8"/></>,
  route: <><circle cx="6" cy="19" r="3"/><path d="M9 19h5a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h8"/><circle cx="18" cy="3" r="2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.7-1.4-2.4L5 15a8 8 0 0 1 0-2l-1.5-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.7 1.4 2.4L19.4 13a8 8 0 0 1 0 2Z"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5m-18 5 9 5 9-5"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  close: <><path d="m18 6-12 12M6 6l12 12"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  moon: <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4"/></>,
  camera: <><path d="M14 5h-4L8 8H4a2 2 0 0 0-2 2v9h20v-9a2 2 0 0 0-2-2h-4z"/><circle cx="12" cy="13" r="3"/></>,
  car: <><path d="m5 11 1.5-5h11l1.5 5m-15 0h18v7h-3v-2H6v2H3z"/><circle cx="7" cy="14" r="1"/><circle cx="17" cy="14" r="1"/></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2m2 0h2M9 11h2m2 0h2M9 15h2m2 0h2m-5 6v-3h2v3"/></>,
  plane: <><path d="m2 16 20-6-20-6 4 6-4 6Zm4-6h11"/></>,
  bus: <><rect x="4" y="3" width="16" height="16" rx="3"/><path d="M4 11h16M8 7h.01M16 7h.01M8 19v2m8-2v2"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></>,
  arrow: <><path d="M5 12h14m-7-7 7 7-7 7"/></>,
  plus: <><path d="M12 5v14m-7-7h14"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9h.01"/></>,
};

export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{paths[name] ?? paths.info}</svg>;
}
