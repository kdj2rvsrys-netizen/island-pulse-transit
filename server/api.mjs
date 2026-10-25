import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  extractCsvFromZipBuffer,
  mergeSpeedCameras,
  normalizeHighwaySpeedCameras,
  normalizePbsRoadEvents,
  normalizeSpeedCameras,
} from './csv.mjs';

function loadEnvFile() {
  try {
    const envPath = resolve(process.cwd(), '.env');
    if (!existsSync(envPath)) return;
    const lines = readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // Ignore .env read errors
  }
}
loadEnvFile();

const HOST = '127.0.0.1';
const PORT = Number(process.env.API_PORT || 8788);
const METADATA_7320_URL = 'https://data.gov.tw/api/v2/rest/dataset/7320';
const METADATA_13940_URL = 'https://data.gov.tw/api/v2/rest/dataset/13940';
const METADATA_15221_URL = 'https://data.gov.tw/api/v2/rest/dataset/15221';
const TRUSTED_DOWNLOAD_PREFIXES = [
  'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/',
  'https://www.tgos.tw/tgos/VirtualDir/Product/',
  'https://rtr.pbs.gov.tw/NMP103_PbsWS/resources/roadData/opendata',
];
const CAMERA_CACHE_MS = 60 * 60 * 1000;
const ROAD_EVENTS_CACHE_MS = 90 * 1000;
const TDX_TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TDX_API_BASE = 'https://tdx.transportdata.tw/api/basic';

let cameraCache;
let cameraPending;
let roadEventCache;
let roadEventPending;
let tdxTokenCache;
const transitCache = new Map();

export function findDownloadUrl(value) {
  if (typeof value === 'string') {
    return TRUSTED_DOWNLOAD_PREFIXES.some((prefix) => value.startsWith(prefix)) ? value : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return value.map(findDownloadUrl).find(Boolean);
  for (const [key, item] of Object.entries(value)) {
    if (/download|resource|url/i.test(key)) {
      const found = findDownloadUrl(item);
      if (found) return found;
    }
  }
  for (const item of Object.values(value)) {
    const found = findDownloadUrl(item);
    if (found) return found;
  }
  return undefined;
}

function findUpdatedAt(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return value.map(findUpdatedAt).find(Boolean);
  for (const [key, item] of Object.entries(value)) {
    if (/modifiedDate|updatedAt|updateTime|lastModified/i.test(key) && typeof item === 'string' && item.trim()) return item;
  }
  for (const item of Object.values(value)) {
    const found = findUpdatedAt(item);
    if (found) return found;
  }
  return undefined;
}

async function fetchOfficialCameras() {
  const metadataResponse = await fetch(METADATA_7320_URL, { signal: AbortSignal.timeout(15000) });
  if (!metadataResponse.ok) throw new Error(`資料集目錄回應 ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  const downloadUrl = findDownloadUrl(metadata);
  if (!downloadUrl) throw new Error('官方目錄未提供可驗證的測速資料下載位置');
  const updatedAt7320 = findUpdatedAt(metadata) ?? '官方目錄未提供更新時間';
  const csvResponse = await fetch(downloadUrl, { signal: AbortSignal.timeout(20000) });
  if (!csvResponse.ok) throw new Error(`測速資料下載回應 ${csvResponse.status}`);
  const csv = await csvResponse.text();
  const fetchedAt = new Date().toISOString();
  const cameras7320 = normalizeSpeedCameras(csv, { updatedAt: updatedAt7320, fetchedAt });

  let merged = cameras7320;
  let supplementNote = '';
  try {
    const meta13940Res = await fetch(METADATA_13940_URL, { signal: AbortSignal.timeout(12000) });
    if (meta13940Res.ok) {
      const meta13940 = await meta13940Res.json();
      const zipUrl = findDownloadUrl(meta13940);
      const updatedAt13940 = findUpdatedAt(meta13940) ?? updatedAt7320;
      if (zipUrl) {
        const zipRes = await fetch(encodeURI(zipUrl), { signal: AbortSignal.timeout(15000) });
        if (zipRes.ok) {
          const zipBuf = Buffer.from(await zipRes.arrayBuffer());
          const csv13940 = extractCsvFromZipBuffer(zipBuf);
          const cameras13940 = normalizeHighwaySpeedCameras(csv13940, { updatedAt: updatedAt13940, fetchedAt });
          merged = mergeSpeedCameras(cameras7320, cameras13940);
          const added = merged.length - cameras7320.length;
          if (added > 0) supplementNote = `已整併國道資料集 13940（去重補齊 ${added} 處國道點位）。`;
        }
      }
    }
  } catch {
    supplementNote = '國道補充資料集（13940）暫無法連線，目前顯示全國資料集 7320。';
  }

  return {
    data: merged,
    status: merged.length ? 'available' : 'empty',
    source: '內政部警政署・政府資料開放平臺（資料集 7320 & 13940）',
    updatedAt: updatedAt7320,
    fetchedAt,
    confidence: 'official-static',
    note: `非即時資料；資料集標示不定期更新。${supplementNote}請以現場標誌及交通規則為準。`,
  };
}

async function getSpeedCameras() {
  if (cameraCache && Date.now() - cameraCache.cachedAt < CAMERA_CACHE_MS) return cameraCache.result;
  if (!cameraPending) {
    cameraPending = fetchOfficialCameras()
      .then((result) => { cameraCache = { result, cachedAt: Date.now() }; return result; })
      .finally(() => { cameraPending = undefined; });
  }
  try { return await cameraPending; }
  catch (error) {
    if (cameraCache) return { ...cameraCache.result, status: 'stale', note: `官方來源目前無法更新；顯示上次成功取得的資料。${cameraCache.result.note}` };
    return { data: [], status: 'error', source: '內政部警政署・政府資料開放平臺（資料集 7320 & 13940）', updatedAt: '', fetchedAt: '', confidence: 'official-static', note: error instanceof Error ? error.message : '官方來源暫時無法連線。' };
  }
}

async function fetchPbsRoadEvents() {
  let resourceUrl = 'https://rtr.pbs.gov.tw/NMP103_PbsWS/resources/roadData/opendata';
  try {
    const metaRes = await fetch(METADATA_15221_URL, { signal: AbortSignal.timeout(8000) });
    if (metaRes.ok) {
      const meta = await metaRes.json();
      const found = findDownloadUrl(meta);
      if (found) resourceUrl = found;
    }
  } catch {
    // Use verified official PBS endpoint
  }
  const response = await fetch(resourceUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`警廣即時路況回應 ${response.status}`);
  const payload = await response.json();
  const fetchedAt = new Date().toISOString();
  const rawItems = Array.isArray(payload?.result) ? payload.result : Array.isArray(payload) ? payload : [];
  const data = normalizePbsRoadEvents(rawItems, { fetchedAt });
  const latestMod = data.reduce((max, item) => (item.updatedAt && item.updatedAt > max ? item.updatedAt : max), '') || fetchedAt.slice(0, 16).replace('T', ' ');

  return {
    data,
    status: data.length ? 'available' : 'empty',
    source: '內政部警政署警察廣播電臺・即時路況（資料集 15221）',
    updatedAt: latestMod,
    fetchedAt,
    confidence: 'official-live',
    note: '與警廣即時路況查詢網頁至多有 1 分鐘時間差；每次取得最新通報紀錄。',
  };
}

async function getRoadEvents() {
  if (roadEventCache && Date.now() - roadEventCache.cachedAt < ROAD_EVENTS_CACHE_MS) return roadEventCache.result;
  if (!roadEventPending) {
    roadEventPending = fetchPbsRoadEvents()
      .then((result) => { roadEventCache = { result, cachedAt: Date.now() }; return result; })
      .finally(() => { roadEventPending = undefined; });
  }
  try { return await roadEventPending; }
  catch (error) {
    if (roadEventCache) {
      return { ...roadEventCache.result, status: 'stale', note: `警廣即時路況來源暫時中斷；顯示上次快取資料。${roadEventCache.result.note}` };
    }
    return {
      data: [],
      status: 'error',
      source: '內政部警政署警察廣播電臺・即時路況（資料集 15221）',
      updatedAt: '',
      fetchedAt: '',
      confidence: 'official-live',
      note: error instanceof Error ? error.message : '警廣即時路況來源暫時無法連線。',
    };
  }
}

async function getTdxAccessToken() {
  const clientId = process.env.TDX_CLIENT_ID?.trim();
  const clientSecret = process.env.TDX_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  if (tdxTokenCache && Date.now() < tdxTokenCache.expiresAt - 60000) return tdxTokenCache.token;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(TDX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`TDX OAuth2 授權失敗（HTTP ${res.status}）`);
  const json = await res.json();
  if (!json.access_token) throw new Error('TDX OAuth2 回應缺少 access_token');
  tdxTokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + Number(json.expires_in || 86400) * 1000,
  };
  return tdxTokenCache.token;
}

async function getTransitTrips(mode = '高鐵') {
  const clientId = process.env.TDX_CLIENT_ID?.trim();
  const clientSecret = process.env.TDX_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return {
      data: [],
      status: 'unavailable',
      source: '交通部 TDX 運輸資料流通服務平臺（尚未設定伺服器憑證）',
      updatedAt: '',
      fetchedAt: new Date().toISOString(),
      confidence: 'scheduled',
      tdxConfigured: false,
      note: '伺服器端尚未設定 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET 環境變數。設定後將自動啟用真實時刻與即時到離站查詢；目前可切換檢視介面 Demo 示意班次。',
    };
  }

  const cached = transitCache.get(mode);
  if (cached && Date.now() - cached.cachedAt < 120000) return cached.result;

  try {
    const token = await getTdxAccessToken();
    const today = new Date().toISOString().slice(0, 10);
    const endpointMap = {
      '高鐵': `${TDX_API_BASE}/v2/Rail/THSR/DailyTimetable/TrainDate/${today}?$top=30&$format=JSON`,
      '台鐵': `${TDX_API_BASE}/v2/Rail/TRA/LiveBoard?$top=30&$format=JSON`,
      '捷運': `${TDX_API_BASE}/v2/Rail/Metro/FirstLastTimetable/TRTC?$top=30&$format=JSON`,
      '公車': `${TDX_API_BASE}/v2/Bus/EstimatedTimeOfArrival/City/Taipei?$top=30&$format=JSON`,
      '航班': `${TDX_API_BASE}/v2/Air/FIDS/Airport/Departure/TPE?$top=30&$format=JSON`,
    };
    const url = endpointMap[mode] || endpointMap['高鐵'];
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`TDX ${mode} API 回應 ${res.status}`);
    const raw = await res.json();
    const fetchedAt = new Date().toISOString();
    const list = Array.isArray(raw) ? raw : [];
    const data = list.slice(0, 25).map((item, idx) => {
      if (mode === '高鐵') {
        const info = item.DailyTrainInfo || {};
        const stops = Array.isArray(item.StopTimes) ? item.StopTimes : [];
        const first = stops[0] || {};
        const last = stops[stops.length - 1] || {};
        return {
          id: `thsr-${info.TrainNo || idx}`,
          mode: '高鐵',
          route: `高鐵 ${info.TrainNo || ''} 次`,
          origin: first.StationName?.Zh_tw || info.StartingStationName?.Zh_tw || '起點站',
          destination: last.StationName?.Zh_tw || info.EndingStationName?.Zh_tw || '終點站',
          departure: first.DepartureTime || '00:00',
          arrival: last.ArrivalTime || first.DepartureTime || '00:00',
          status: '當日定期班表',
          meta: { source: '交通部 TDX・台灣高鐵每日時刻表 v2', updatedAt: today, fetchedAt, status: 'available', confidence: 'scheduled' },
        };
      }
      if (mode === '台鐵') {
        const delay = Number(item.DelayTime || 0);
        return {
          id: `tra-${item.TrainNo || idx}-${item.StationID || idx}`,
          mode: '台鐵',
          route: `${item.TrainTypeName?.Zh_tw || '列車'} ${item.TrainNo || ''} 次`,
          origin: item.StationName?.Zh_tw || '目前車站',
          destination: item.EndingStationName?.Zh_tw || '終點站',
          departure: (item.ScheduledDepartureTime || '').slice(0, 5) || '--:--',
          arrival: (item.ScheduledArrivalTime || '').slice(0, 5) || '--:--',
          status: delay > 0 ? `晚 ${delay} 分` : '準點',
          delayMinutes: delay,
          meta: { source: '交通部 TDX・台鐵車站即時看板 v2', updatedAt: item.UpdateTime?.slice(0, 16) || fetchedAt.slice(0, 16), fetchedAt, status: 'available', confidence: 'live' },
        };
      }
      if (mode === '航班') {
        return {
          id: `air-${item.FlightNumber || idx}`,
          mode: '航班',
          route: `${item.AirlineID || ''} ${item.FlightNumber || ''}`.trim(),
          origin: item.DepartureAirportID || 'TPE',
          destination: item.ArrivalAirportID || '目的地',
          departure: (item.ScheduleDepartureTime || '').slice(11, 16) || '--:--',
          arrival: (item.EstimatedDepartureTime || item.ActualDepartureTime || '').slice(11, 16) || '--:--',
          status: item.DepartureRemark || '時刻表',
          meta: { source: '交通部 TDX・航空即時航班資訊 v2', updatedAt: item.UpdateTime?.slice(0, 16) || today, fetchedAt, status: 'available', confidence: 'live' },
        };
      }
      return {
        id: `tdx-${mode}-${idx}`,
        mode,
        route: item.RouteName?.Zh_tw || item.LineName?.Zh_tw || `${mode}路線`,
        origin: item.StopName?.Zh_tw || item.StationName?.Zh_tw || '站點',
        destination: item.DestinationStationName?.Zh_tw || '往終點站',
        departure: item.FirstTrainTime || (item.EstimateTime ? `${Math.max(1, Math.round(item.EstimateTime / 60))} 分` : '營運中'),
        arrival: item.LastTrainTime || '依班距',
        status: 'TDX 資料',
        meta: { source: `交通部 TDX・${mode}公開資料 v2`, updatedAt: today, fetchedAt, status: 'available', confidence: 'live' },
      };
    });

    const result = {
      data,
      status: data.length ? 'available' : 'empty',
      source: `交通部 TDX・${mode}公開資料服務`,
      updatedAt: fetchedAt.slice(0, 16).replace('T', ' '),
      fetchedAt,
      confidence: mode === '高鐵' ? 'scheduled' : 'live',
      tdxConfigured: true,
    };
    transitCache.set(mode, { result, cachedAt: Date.now() });
    return result;
  } catch (error) {
    if (cached) return { ...cached.result, status: 'stale', note: 'TDX 連線暫時異常，顯示快取資料。' };
    return {
      data: [],
      status: 'error',
      source: `交通部 TDX・${mode}公開資料服務`,
      updatedAt: '',
      fetchedAt: new Date().toISOString(),
      confidence: 'live',
      tdxConfigured: true,
      note: error instanceof Error ? error.message : 'TDX 服務暫時無法連線。',
    };
  }
}

export function createApiServer() {
  return createServer(async (request, response) => {
    const reqUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);
    const pathname = reqUrl.pathname;

    if (request.method === 'GET' && pathname === '/api/speed-cameras') {
      try {
        const result = await getSpeedCameras();
        response.writeHead(result.status === 'error' ? 502 : 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(result));
      } catch {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ data: [], status: 'error', source: '內政部警政署・政府資料開放平臺（資料集 7320 & 13940）', updatedAt: '', fetchedAt: '', confidence: 'official-static', note: '無法處理官方測速資料。' }));
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/road-events') {
      try {
        const result = await getRoadEvents();
        response.writeHead(result.status === 'error' ? 502 : 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(result));
      } catch {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ data: [], status: 'error', source: '內政部警政署警察廣播電臺・即時路況（資料集 15221）', updatedAt: '', fetchedAt: '', confidence: 'official-live', note: '無法處理警廣即時路況資料。' }));
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/transit') {
      const mode = reqUrl.searchParams.get('mode') || '高鐵';
      try {
        const result = await getTransitTrips(mode);
        response.writeHead(result.status === 'error' ? 502 : 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(result));
      } catch {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ data: [], status: 'error', source: '交通部 TDX', updatedAt: '', fetchedAt: '', confidence: 'scheduled', note: '無法處理大眾運輸查詢。' }));
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/status') {
      const tdxConfigured = Boolean(process.env.TDX_CLIENT_ID?.trim() && process.env.TDX_CLIENT_SECRET?.trim());
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: true, tdxConfigured }));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  createApiServer().listen(PORT, HOST, () => console.log(`Island Pulse data API listening at http://${HOST}:${PORT}`));
}
