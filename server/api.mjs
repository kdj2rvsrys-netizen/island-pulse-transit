import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatCorridorMetric, getCorridorMetric } from './route-data.mjs';
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

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || process.env.API_PORT || 8788);
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
const TDX_DISK_CACHE_DIR = resolve(process.cwd(), '.cache');
const TDX_DISK_CACHE_FILE = resolve(TDX_DISK_CACHE_DIR, 'tdx-cache.json');

let cameraCache;
let cameraPending;
let roadEventCache;
let roadEventPending;
let tdxTokenCache;
const transitCache = new Map();
const tdxRawCache = new Map();
let tdxRequestChain = Promise.resolve();

function loadDiskCache() {
  try {
    if (!existsSync(TDX_DISK_CACHE_FILE)) return;
    const parsed = JSON.parse(readFileSync(TDX_DISK_CACHE_FILE, 'utf-8'));
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'object' && v.cachedAt) tdxRawCache.set(k, v);
      }
    }
  } catch {
    // Ignore disk cache load errors
  }
}
loadDiskCache();

function saveDiskCache() {
  try {
    if (!existsSync(TDX_DISK_CACHE_DIR)) mkdirSync(TDX_DISK_CACHE_DIR, { recursive: true });
    const obj = Object.fromEntries(tdxRawCache.entries());
    writeFileSync(TDX_DISK_CACHE_FILE, JSON.stringify(obj), 'utf-8');
  } catch {
    // Ignore disk cache save errors
  }
}

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
    console.error('[pbs-road-events] official source request failed', error);
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

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function getTaiwanNow() {
  const tw = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  return {
    date: tw.slice(0, 10),
    time: tw.slice(11, 16),
    dateTime: `${tw.slice(0, 10)} ${tw.slice(11, 16)}`,
  };
}

async function fetchTdxJson(url, { forceRefresh = false, cacheMs = 1800000 } = {}) {
  const existing = tdxRawCache.get(url);
  if (!forceRefresh && existing && Date.now() - existing.cachedAt < cacheMs) {
    return existing.data;
  }

  const runRequest = async () => {
    const hit = tdxRawCache.get(url);
    if (!forceRefresh && hit && Date.now() - hit.cachedAt < cacheMs) return hit.data;

    const token = await getTdxAccessToken();
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await sleep(1200 * attempt);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      lastStatus = res.status;
      if (res.ok) {
        const data = await res.json();
        tdxRawCache.set(url, { data, cachedAt: Date.now() });
        saveDiskCache();
        await sleep(300);
        return data;
      }
      if (res.status !== 429 && res.status < 500) break;
    }
    if (hit) return hit.data;
    throw new Error(`TDX API 回應 ${lastStatus}`);
  };

  const resultPromise = tdxRequestChain.then(runRequest, runRequest);
  tdxRequestChain = resultPromise.then(() => undefined, () => undefined);
  return resultPromise;
}

const THSR_STATIONS = [
  { id: '0990', name: '南港', coords: [25.0531, 121.6071], km: 0 },
  { id: '1000', name: '台北', coords: [25.0478, 121.517], km: 9 },
  { id: '1010', name: '板橋', coords: [25.0143, 121.4638], km: 17 },
  { id: '1020', name: '桃園', coords: [25.0133, 121.2148], km: 49 },
  { id: '1030', name: '新竹', coords: [24.8084, 121.0403], km: 79 },
  { id: '1035', name: '苗栗', coords: [24.6054, 120.8253], km: 112 },
  { id: '1040', name: '台中', coords: [24.1121, 120.6156], km: 165 },
  { id: '1043', name: '彰化', coords: [23.8743, 120.5747], km: 194 },
  { id: '1047', name: '雲林', coords: [23.7362, 120.4165], km: 218 },
  { id: '1050', name: '嘉義', coords: [23.4593, 120.3231], km: 251 },
  { id: '1060', name: '台南', coords: [22.9248, 120.2857], km: 313 },
  { id: '1070', name: '左營', coords: [22.6874, 120.3075], km: 345 },
];

const HUB_DIRECTORY = [
  { keys: ['台北 101', '信義區', '世貿'], label: '台北 101（經臺北車站）', hubName: '臺北車站', coords: [25.0339, 121.5645], stationCoords: [25.0478, 121.517], thsrId: '1000', traId: '1000', metroOp: 'TRTC', busCity: 'Taipei', airport: 'TSA' },
  { keys: ['內湖', '南港展覽館', '南港'], label: '南港', hubName: '南港車站', coords: [25.0531, 121.6071], stationCoords: [25.0531, 121.6071], thsrId: '0990', traId: '0980', metroOp: 'TRTC', busCity: 'Taipei', airport: 'TSA' },
  { keys: ['台北', '臺北', '北車', '西門', '淡水', '士林', '北投'], label: '臺北', hubName: '臺北車站', coords: [25.0478, 121.517], stationCoords: [25.0478, 121.517], thsrId: '1000', traId: '1000', metroOp: 'TRTC', busCity: 'Taipei', airport: 'TSA' },
  { keys: ['板橋', '新北', '新莊', '中和', '永和', '三重', '土城'], label: '板橋', hubName: '板橋車站', coords: [25.0143, 121.4638], stationCoords: [25.0143, 121.4638], thsrId: '1010', traId: '1020', metroOp: 'TRTC', busCity: 'NewTaipei', airport: 'TSA' },
  { keys: ['基隆', '九份', '瑞芳'], label: '基隆', hubName: '基隆車站', coords: [25.1317, 121.7386], stationCoords: [25.1317, 121.7386], thsrId: null, traId: '0900', metroOp: null, busCity: 'Keelung', airport: 'TSA' },
  { keys: ['桃園機場', '桃機', '中壢', '桃園'], label: '桃園', hubName: '桃園高鐵／火車站', coords: [25.0133, 121.2148], stationCoords: [25.0133, 121.2148], thsrId: '1020', traId: '1080', metroOp: 'TYMC', busCity: 'Taoyuan', airport: 'TPE' },
  { keys: ['竹科', '新竹科學園區', '竹北', '新竹'], label: '新竹', hubName: '新竹高鐵／火車站', coords: [24.8084, 121.0403], stationCoords: [24.8084, 121.0403], thsrId: '1030', traId: '1210', metroOp: null, busCity: 'Hsinchu', airport: 'TPE' },
  { keys: ['苗栗', '竹南'], label: '苗栗', hubName: '苗栗車站', coords: [24.6054, 120.8253], stationCoords: [24.6054, 120.8253], thsrId: '1035', traId: '3160', metroOp: null, busCity: 'Taichung', airport: 'RMQ' },
  { keys: ['日月潭', '南投', '逢甲', '台中', '臺中'], label: '臺中', hubName: '臺中車站／高鐵台中站', coords: [24.1368, 120.685], stationCoords: [24.1121, 120.6156], thsrId: '1040', traId: '3300', metroOp: 'TMRT', busCity: 'Taichung', airport: 'RMQ' },
  { keys: ['彰化', '員林', '鹿港'], label: '彰化', hubName: '彰化車站', coords: [24.0816, 120.5385], stationCoords: [24.0816, 120.5385], thsrId: '1043', traId: '3360', metroOp: null, busCity: 'Taichung', airport: 'RMQ' },
  { keys: ['雲林', '斗六', '虎尾'], label: '雲林/斗六', hubName: '斗六／高鐵雲林站', coords: [23.7118, 120.5416], stationCoords: [23.7362, 120.4165], thsrId: '1047', traId: '3470', metroOp: null, busCity: 'Tainan', airport: 'RMQ' },
  { keys: ['阿里山', '嘉義'], label: '嘉義', hubName: '嘉義車站', coords: [23.4791, 120.4411], stationCoords: [23.4791, 120.4411], thsrId: '1050', traId: '4080', metroOp: null, busCity: 'Tainan', airport: 'KHH' },
  { keys: ['安平', '台南', '臺南'], label: '臺南', hubName: '臺南車站', coords: [22.9971, 120.2126], stationCoords: [22.9971, 120.2126], thsrId: '1060', traId: '4220', metroOp: null, busCity: 'Tainan', airport: 'KHH' },
  { keys: ['駁二', '小港', '左營', '新左營', '高雄'], label: '左營/高雄', hubName: '高鐵左營／新左營站', coords: [22.6397, 120.302], stationCoords: [22.6874, 120.3075], thsrId: '1070', traId: '4340', metroOp: 'KRTC', busCity: 'Kaohsiung', airport: 'KHH' },
  { keys: ['墾丁', '恆春', '潮州', '屏東'], label: '屏東', hubName: '屏東車站', coords: [22.6692, 120.4862], stationCoords: [22.6692, 120.4862], thsrId: null, traId: '5000', metroOp: null, busCity: 'Kaohsiung', airport: 'KHH' },
  { keys: ['礁溪', '羅東', '蘇澳', '宜蘭'], label: '宜蘭', hubName: '宜蘭車站', coords: [24.7545, 121.7582], stationCoords: [24.7545, 121.7582], thsrId: null, traId: '7190', metroOp: null, busCity: 'Taipei', airport: 'TSA' },
  { keys: ['太魯閣', '花蓮'], label: '花蓮', hubName: '花蓮車站', coords: [23.9927, 121.6012], stationCoords: [23.9927, 121.6012], thsrId: null, traId: '7000', metroOp: null, busCity: 'Taipei', airport: 'TSA' },
  { keys: ['知本', '池上', '玉里', '台東', '臺東'], label: '臺東', hubName: '臺東車站', coords: [22.7932, 121.1231], stationCoords: [22.7932, 121.1231], thsrId: null, traId: '6000', metroOp: null, busCity: 'Kaohsiung', airport: 'KHH' },
];

function resolveHub(input = '') {
  const raw = String(input).trim();
  const cleaned = raw.replace(/臺/g, '台').replace(/(高鐵站|火車站|車站|機場|站|市|縣)$/g, '');
  if (!cleaned) return null;
  return (
    HUB_DIRECTORY.find((hub) => hub.keys.some((k) => {
      const nk = k.replace(/臺/g, '台');
      return nk === cleaned || raw.replace(/臺/g, '台').includes(nk) || cleaned.includes(nk);
    }))
    || null
  );
}

function calcDurationMinutes(dep = '', arr = '') {
  const [dh, dm] = dep.split(':').map(Number);
  const [ah, am] = arr.split(':').map(Number);
  if (!Number.isFinite(dh) || !Number.isFinite(dm) || !Number.isFinite(ah) || !Number.isFinite(am)) return null;
  let diff = (ah * 60 + am) - (dh * 60 + dm);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function formatDuration(minutes) {
  if (minutes === null || minutes <= 0) return '依班表';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`;
}

function haversineKm([lat1, lng1], [lat2, lng2]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateThsrFare(originThsrId, destThsrId) {
  const s1 = THSR_STATIONS.find((s) => s.id === originThsrId);
  const s2 = THSR_STATIONS.find((s) => s.id === destThsrId);
  if (!s1 || !s2) return '依高鐵公告票價';
  const dist = Math.abs(s1.km - s2.km);
  const std = Math.max(40, Math.round((dist * 4.32) / 5) * 5);
  const free = Math.max(35, Math.round((std * 0.968) / 5) * 5);
  return `標準車廂約 NT$${std.toLocaleString()}・自由座約 NT$${free.toLocaleString()}`;
}

function estimateTraFare(originCoords, destCoords) {
  const distKm = Math.max(10, haversineKm(originCoords, destCoords) * 1.22);
  const tzeChiang = Math.round(distKm * 2.27);
  const local = Math.round(distKm * 1.46);
  return `自強號約 NT$${tzeChiang.toLocaleString()}・區間車約 NT$${local.toLocaleString()}`;
}

async function fetchDrivingRoute(originCoords, destCoords) {
  const straightKm = haversineKm(originCoords, destCoords);
  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${originCoords[1]},${originCoords[0]};${destCoords[1]},${destCoords[0]}?overview=simplified&geometries=geojson&steps=true`;
    const res = await fetch(osrmUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const json = await res.json();
      const route = json?.routes?.[0];
      if (route) {
        const distanceKm = Math.max(1, Math.round((route.distance / 1000) * 10) / 10);
        const durationMinutes = Math.max(5, Math.round(route.duration / 60));
        const coords = Array.isArray(route.geometry?.coordinates)
          ? route.geometry.coordinates.map(([lng, lat]) => [Number(lat.toFixed(5)), Number(lng.toFixed(5))])
          : [originCoords, destCoords];
        const legs = Array.isArray(route.legs?.[0]?.steps) ? route.legs[0].steps : [];
        const roadNames = [...new Set(legs.map((step) => step.name || step.ref).filter((n) => n && n.length > 1))].slice(0, 5);
        return { distanceKm, durationMinutes, path: coords, roadNames, hasRoadGeometry: coords.length >= 2 };
      }
    }
  } catch {
    // Fallback to estimated road metrics if OSRM is unreachable
  }
  const distanceKm = Math.max(2, Math.round(straightKm * 1.28 * 10) / 10);
  const durationMinutes = Math.max(8, Math.round((distanceKm / 72) * 60));
  return {
    distanceKm,
    durationMinutes,
    path: [],
    roadNames: [],
    hasRoadGeometry: false,
    note: 'OSRM 暫時無法提供道路路徑；下列距離與時間僅為粗略推估。',
  };
}

async function countCorridorAlerts(path = []) {
  if (path.length < 2) return { events: getCorridorMetric({ status: 'error' }, 0), cameras: getCorridorMetric({ status: 'error' }, 0) };
  const samplePoints = path.filter((_, idx) => idx % Math.max(1, Math.floor(path.length / 18)) === 0 || idx === path.length - 1);
  const [eventsResult, camerasResult] = await Promise.all([
    roadEventCache?.result ? Promise.resolve(roadEventCache.result) : getRoadEvents(),
    cameraCache?.result ? Promise.resolve(cameraCache.result) : getSpeedCameras(),
  ]);
  const activeEvents = (eventsResult.data || []).filter((e) => !e.cleared);
  const cameras = camerasResult.data || [];

  let eventsCount = 0;
  for (const ev of activeEvents) {
    if (samplePoints.some((pt) => haversineKm(pt, ev.coordinates) <= 3.5)) eventsCount += 1;
  }
  let camerasCount = 0;
  for (const cam of cameras) {
    if (samplePoints.some((pt) => haversineKm(pt, cam.coordinates) <= 2.2)) camerasCount += 1;
  }
  return {
    events: getCorridorMetric(eventsResult, eventsCount),
    cameras: getCorridorMetric(camerasResult, camerasCount),
  };
}

async function getTransitTrips(mode = '高鐵', options = {}) {
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

  const station = options.station || 'all';
  const operator = options.operator || 'TRTC';
  const city = options.city || 'Taipei';
  const routeKeyword = (options.route || '').trim();
  const airport = options.airport || 'TPE';
  const forceRefresh = options.refresh === '1' || options.refresh === 'true';

  const cacheKey = `${mode}:${station}:${operator}:${city}:${routeKeyword}:${airport}`;
  const cached = transitCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt < 120000) return cached.result;

  try {
    const { date: today, dateTime: twDateTime } = getTaiwanNow();
    const metroLineNamesByOp = {
      TRTC: { BL: '板南線', R: '淡水信義線', G: '松山新店線', O: '中和新蘆線', BR: '文湖線', Y: '環狀線' },
      KRTC: { R: '高捷紅線', O: '高捷橘線', C: '高雄輕軌' },
      TYMC: { A: '機場捷運線' },
      TMRT: { G: '中捷綠線' },
    };
    const operatorNames = {
      TRTC: '台北捷運',
      KRTC: '高雄捷運',
      TYMC: '桃園機場捷運',
      TMRT: '台中捷運',
      NTMC: '新北捷運',
    };
    const cityNames = {
      Taipei: '台北市',
      NewTaipei: '新北市',
      Taoyuan: '桃園市',
      Taichung: '台中市',
      Tainan: '台南市',
      Kaohsiung: '高雄市',
      Keelung: '基隆市',
      Hsinchu: '新竹市',
    };
    const airportNames = {
      TPE: '桃園國際機場 (TPE)',
      TSA: '臺北松山機場 (TSA)',
      KHH: '高雄國際機場 (KHH)',
      RMQ: '臺中國際機場 (RMQ)',
    };

    let url;
    if (mode === '高鐵') {
      url = `${TDX_API_BASE}/v2/Rail/THSR/DailyTimetable/TrainDate/${today}?$top=160&$format=JSON`;
    } else if (mode === '台鐵') {
      url = station !== 'all'
        ? `${TDX_API_BASE}/v2/Rail/TRA/LiveBoard/Station/${encodeURIComponent(station)}?$top=60&$format=JSON`
        : `${TDX_API_BASE}/v2/Rail/TRA/LiveBoard?$top=80&$format=JSON`;
    } else if (mode === '捷運') {
      url = `${TDX_API_BASE}/v2/Rail/Metro/FirstLastTimetable/${encodeURIComponent(operator)}?$top=80&$format=JSON`;
    } else if (mode === '公車') {
      const routeSegment = routeKeyword ? `/${encodeURIComponent(routeKeyword)}` : '';
      url = `${TDX_API_BASE}/v2/Bus/EstimatedTimeOfArrival/City/${encodeURIComponent(city)}${routeSegment}?$filter=EstimateTime%20gt%200&$top=60&$format=JSON`;
    } else {
      url = `${TDX_API_BASE}/v2/Air/FIDS/Airport/Departure/${encodeURIComponent(airport)}?$top=60&$format=JSON`;
    }

    let raw = await fetchTdxJson(url, { forceRefresh });
    const fetchedAt = new Date().toISOString();
    let list = Array.isArray(raw) ? raw : [];
    let isTraDailyFallback = false;

    if (mode === '台鐵' && station !== 'all') {
      const currentTime = twDateTime.slice(11, 16);
      list = list.filter((item) => String(item.ScheduledDepartureTime || '').slice(0, 5) >= currentTime);
    }

    if (mode === '台鐵' && station !== 'all' && list.length === 0) {
      const fallbackUrl = `${TDX_API_BASE}/v2/Rail/TRA/DailyTimetable/Station/${encodeURIComponent(station)}/${today}?$top=50&$format=JSON`;
      const fallbackRaw = await fetchTdxJson(fallbackUrl, { forceRefresh });
      if (Array.isArray(fallbackRaw) && fallbackRaw.length > 0) {
        const currentTime = twDateTime.slice(11, 16);
        list = fallbackRaw.filter((item) => String(item.DepartureTime || '').slice(0, 5) >= currentTime);
        isTraDailyFallback = true;
      }
    }

    if (mode === '高鐵' && station !== 'all') {
      list = list.filter((item) => Array.isArray(item.StopTimes) && item.StopTimes.some((s) => s.StationID === station));
    }

    const data = list.slice(0, 60).map((item, idx) => {
      if (mode === '高鐵') {
        const info = item.DailyTrainInfo || {};
        const stops = Array.isArray(item.StopTimes) ? item.StopTimes : [];
        const selectedStop = station !== 'all' ? stops.find((s) => s.StationID === station) : null;
        const first = selectedStop || stops[0] || {};
        const last = stops[stops.length - 1] || {};
        return {
          id: `thsr-${info.TrainNo || idx}-${station}`,
          mode: '高鐵',
          route: `高鐵 ${info.TrainNo || ''} 次`,
          origin: first.StationName?.Zh_tw || info.StartingStationName?.Zh_tw || '起點站',
          destination: last.StationName?.Zh_tw || info.EndingStationName?.Zh_tw || '終點站',
          departure: first.DepartureTime || first.ArrivalTime || '00:00',
          arrival: last.ArrivalTime || first.DepartureTime || '00:00',
          status: info.Direction === 0 ? '南下定期班次' : '北上定期班次',
          meta: { source: '交通部 TDX・台灣高鐵每日時刻表 v2', updatedAt: today, fetchedAt, status: 'available', confidence: 'scheduled' },
        };
      }
      if (mode === '台鐵') {
        if (isTraDailyFallback) {
          return {
            id: `tra-sched-${item.TrainNo || idx}-${station}-${idx}`,
            mode: '台鐵',
            route: `${item.TrainTypeName?.Zh_tw || '列車'} ${item.TrainNo || ''} 次`,
            origin: item.StationName?.Zh_tw || '指定車站',
            destination: item.EndingStationName?.Zh_tw || '終點站',
            departure: (item.DepartureTime || item.ArrivalTime || '').slice(0, 5) || '--:--',
            arrival: null,
            status: '當日定期班表',
            delayMinutes: 0,
            meta: { source: '交通部 TDX・台鐵車站每日時刻表 v2（離峰時段自動切換）', updatedAt: today, fetchedAt, status: 'available', confidence: 'scheduled' },
          };
        }
        const delay = Number(item.DelayTime || 0);
        return {
          id: `tra-${item.TrainNo || idx}-${item.StationID || idx}-${idx}`,
          mode: '台鐵',
          route: `${item.TrainTypeName?.Zh_tw || '列車'} ${item.TrainNo || ''} 次`,
          origin: item.StationName?.Zh_tw || '目前車站',
          destination: item.EndingStationName?.Zh_tw || '終點站',
          departure: (item.ScheduledDepartureTime || '').slice(0, 5) || '--:--',
          arrival: null,
          status: delay > 0 ? `晚 ${delay} 分` : '準點',
          delayMinutes: delay,
          meta: { source: '交通部 TDX・台鐵車站即時看板 v2', updatedAt: item.UpdateTime?.slice(0, 16) || twDateTime, fetchedAt, status: 'available', confidence: 'live' },
        };
      }
      if (mode === '捷運') {
        const lineCode = item.LineID || item.LineNo || '';
        const opLabel = operatorNames[operator] || operator;
        const opLines = metroLineNamesByOp[operator] || {};
        const lineLabel = opLines[lineCode] ? `${opLines[lineCode]} (${lineCode})` : lineCode ? `${opLabel} ${lineCode}` : opLabel;
        return {
          id: `metro-${operator}-${item.StationID || idx}-${item.DestinationStaionID || idx}-${idx}`,
          mode: '捷運',
          route: `${lineLabel}・${item.StationID || ''}`.replace(/・$/, ''),
          origin: item.StationName?.Zh_tw || '捷運站',
          destination: item.DestinationStationName?.Zh_tw || item.TripHeadSign || '終點站',
          departure: item.FirstTrainTime || '06:00',
          arrival: item.LastTrainTime || '24:00',
          status: `${opLabel}・首末班車`,
          meta: { source: `交通部 TDX・${opLabel}首末班車時刻表 v2`, updatedAt: item.UpdateTime?.slice(0, 10) || today, fetchedAt, status: 'available', confidence: 'scheduled' },
        };
      }
      if (mode === '公車') {
        const estMin = typeof item.EstimateTime === 'number' ? Math.max(1, Math.round(item.EstimateTime / 60)) : null;
        const cityName = cityNames[city] || city;
        return {
          id: `bus-${city}-${item.RouteUID || idx}-${item.StopUID || idx}-${idx}`,
          mode: '公車',
          route: `${cityName}公車 ${item.RouteName?.Zh_tw || ''}`.trim(),
          origin: item.StopName?.Zh_tw || '候車站位',
          destination: item.Direction === 1 ? '返程方向' : '去程方向',
          departure: estMin !== null ? (estMin <= 1 ? '進站中' : `約 ${estMin} 分`) : '營運中',
          arrival: (item.UpdateTime || '').slice(11, 16) || '即時推算',
          status: estMin !== null && estMin <= 2 ? '即將進站' : '正常營運',
          meta: { source: `交通部 TDX・${cityName}公車預估到站 v2`, updatedAt: (item.UpdateTime || twDateTime).slice(0, 16).replace('T', ' '), fetchedAt, status: 'available', confidence: 'live' },
        };
      }
      if (mode === '航班') {
        return {
          id: `air-${airport}-${item.FlightNumber || idx}-${idx}`,
          mode: '航班',
          route: `${item.AirlineID || ''} ${item.FlightNumber || ''}`.trim(),
          origin: item.DepartureAirportID || airport,
          destination: item.ArrivalAirportID || '目的地',
          departure: (item.EstimatedDepartureTime || item.ActualDepartureTime || item.ScheduleDepartureTime || '').slice(11, 16) || '--:--',
          arrival: null,
          status: item.DepartureRemark || '準時／時刻表',
          meta: { source: `交通部 TDX・${airportNames[airport] || airport}即時航班 v2`, updatedAt: (item.UpdateTime || today).slice(0, 16).replace('T', ' '), fetchedAt, status: 'available', confidence: 'live' },
        };
      }
      return {
        id: `tdx-${mode}-${idx}`,
        mode,
        route: item.RouteName?.Zh_tw || item.LineName?.Zh_tw || `${mode}路線`,
        origin: item.StopName?.Zh_tw || item.StationName?.Zh_tw || '站點',
        destination: item.DestinationStationName?.Zh_tw || '往終點站',
        departure: item.FirstTrainTime || '營運中',
        arrival: item.LastTrainTime || '依班距',
        status: 'TDX 資料',
        meta: { source: `交通部 TDX・${mode}公開資料 v2`, updatedAt: today, fetchedAt, status: 'available', confidence: 'live' },
      };
    });

    if (mode === '高鐵' || mode === '台鐵') {
      data.sort((a, b) => a.departure.localeCompare(b.departure));
    }

    const result = {
      data,
      status: data.length ? 'available' : 'empty',
      source: `交通部 TDX・${mode}公開資料服務`,
      updatedAt: twDateTime,
      fetchedAt,
      confidence: mode === '高鐵' || mode === '捷運' || isTraDailyFallback ? 'scheduled' : 'live',
      tdxConfigured: true,
    };
    transitCache.set(cacheKey, { result, cachedAt: Date.now() });
    return result;
  } catch {
    if (cached) return { ...cached.result, status: 'stale', note: 'TDX 連線暫時異常，顯示快取資料。' };
    const fetchedAt = new Date().toISOString();
    return {
      data: [],
      status: 'error',
      source: `交通部 TDX・${mode}公開資料服務`,
      updatedAt: '',
      fetchedAt,
      confidence: 'scheduled',
      tdxConfigured: true,
      note: 'TDX 目前無法連線，且沒有可用快取資料；未顯示推測班次。請稍後重試。',
    };
  }
}

async function getMultiModalRoutes({ from = '臺北車站', to = '左營站', departAt = '' }) {
  const originHub = resolveHub(from);
  const destHub = resolveHub(to);
  if (!originHub || !destHub) {
    return {
      status: 'error', source: 'Island Pulse 地點查詢', updatedAt: '', fetchedAt: new Date().toISOString(), options: [],
      note: `無法辨識「${!originHub ? from : to}」。請從建議地點選擇縣市、車站或已支援地點。`,
    };
  }
  const normalizePlace = (value) => String(value).trim().replace(/臺/g, '台').replace(/(高鐵站|火車站|車站|機場|站|市|縣)$/g, '');
  if (normalizePlace(from) === normalizePlace(to)) {
    return {
      status: 'error', source: 'Island Pulse 地點查詢', updatedAt: '', fetchedAt: new Date().toISOString(), options: [],
      note: '起點與目的地相同，請輸入不同地點。',
    };
  }
  const clientId = process.env.TDX_CLIENT_ID?.trim();
  const clientSecret = process.env.TDX_CLIENT_SECRET?.trim();
  const fetchedAt = new Date().toISOString();
  const twNow = getTaiwanNow();
  const datePart = (departAt && departAt.slice(0, 10)) || twNow.date;
  const timePart = (departAt && departAt.slice(11, 16)) || twNow.time;

  const tdxConfigured = Boolean(clientId && clientSecret);

  const originCoords = originHub.coords;
  const destCoords = destHub.coords;
  const transitGoogleUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=transit`;
  const drivingGoogleUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=driving`;

  const drivingRoute = await fetchDrivingRoute(originCoords, destCoords);
  const corridorAlerts = await countCorridorAlerts(drivingRoute.path);
  const options = [];

  // 1. 高鐵 (THSR OD — reuses cached full-day timetable first to save TDX quota!)
  const thsrBookings = [
    { label: '高鐵網路訂票系統', url: 'https://irs.thsrc.com.tw/IMINT/', primary: true },
    { label: '高鐵時刻表與票價查詢', url: 'https://www.thsrc.com.tw/ArticleContent/a3b630bb-1066-4352-a1ef-58c7b4e8ef7c' },
  ];
  if (!tdxConfigured) {
    options.push({ mode: '高鐵', available: false, title: '尚無法查詢高鐵班次', time: '需要 TDX 憑證', detail: '此線上服務尚未設定 TDX 憑證；請直接查詢高鐵官方班表。', color: '#0c817a', hops: '班次未查證', confidence: 'estimated', source: '交通部 TDX 憑證未設定', upcomingTrips: [], bookingLinks: thsrBookings, navigationUrl: transitGoogleUrl });
  } else if (originHub?.thsrId && destHub?.thsrId && originHub.thsrId !== destHub.thsrId) {
    const thsrFare = estimateThsrFare(originHub.thsrId, destHub.thsrId);
    const s1 = THSR_STATIONS.find((s) => s.id === originHub.thsrId);
    const s2 = THSR_STATIONS.find((s) => s.id === destHub.thsrId);

    try {
      const fullDayUrl = `${TDX_API_BASE}/v2/Rail/THSR/DailyTimetable/TrainDate/${datePart}?$top=160&$format=JSON`;
      const raw = await fetchTdxJson(fullDayUrl);
      const list = Array.isArray(raw) ? raw : [];
      const mapped = [];
      for (const item of list) {
        const stops = Array.isArray(item.StopTimes) ? item.StopTimes : [];
        const oStop = stops.find((s) => s.StationID === originHub.thsrId);
        const dStop = stops.find((s) => s.StationID === destHub.thsrId);
        if (oStop && dStop && Number(oStop.StopSequence) < Number(dStop.StopSequence)) {
          const dep = oStop.DepartureTime || oStop.ArrivalTime || '';
          const arr = dStop.ArrivalTime || dStop.DepartureTime || '';
          const mins = calcDurationMinutes(dep, arr);
          if (dep) {
            mapped.push({
              trainNo: `高鐵 ${item.DailyTrainInfo?.TrainNo || ''} 次`,
              origin: oStop.StationName?.Zh_tw || s1?.name || originHub.label,
              destination: dStop.StationName?.Zh_tw || s2?.name || destHub.label,
              departure: dep,
              arrival: arr,
              durationMinutes: mins,
              durationText: formatDuration(mins),
            });
          }
        }
      }
      mapped.sort((a, b) => a.departure.localeCompare(b.departure));

      const afterTime = mapped.filter((t) => t.departure >= timePart);
      const upcoming = (afterTime.length > 0 ? afterTime : mapped).slice(0, 8);
      const first = upcoming[0];
      if (first) {
        options.push({
          mode: '高鐵',
          available: true,
          title: `${first.trainNo}・高鐵${first.origin}站 → 高鐵${first.destination}站`,
          time: first.durationText,
          detail: `${first.departure} 發車 → ${first.arrival} 抵達・當日共 ${mapped.length} 班直達列車`,
          fareText: thsrFare,
          color: '#0c817a',
          hops: '高鐵直達',
          confidence: 'scheduled',
          source: '交通部 TDX・台灣高鐵每日時刻表 v2',
          upcomingTrips: upcoming,
          bookingLinks: thsrBookings,
          navigationUrl: transitGoogleUrl,
          steps: [
            { stepNo: 1, vehicle: '市區接駁／步行', instruction: `由「${from}」前往高鐵${first.origin}站`, detail: '建議預留 15–20 分鐘進站驗票與候車', duration: '約 15 分' },
            { stepNo: 2, vehicle: first.trainNo, instruction: `搭乘 ${first.trainNo}（高鐵${first.origin}站 → 高鐵${first.destination}站）`, detail: `${first.departure} 出發 → ${first.arrival} 抵達・${thsrFare}`, duration: first.durationText },
            { stepNo: 3, vehicle: '出站轉乘／步行', instruction: `由高鐵${first.destination}站前往「${to}」`, detail: '可於高鐵站轉乘都會捷運、台鐵或市區客運抵達目的地', duration: '約 15 分' },
          ],
        });
      } else {
        throw new Error('無直達班次');
      }
    } catch (error) {
      options.push({
        mode: '高鐵',
        available: false,
        title: `高鐵班次暫時無法確認・${s1?.name || originHub.label} → ${s2?.name || destHub.label}`,
        time: '請查官方班表',
        detail: error instanceof Error ? error.message : 'TDX 尚未提供可確認的班次資料。',
        color: '#0c817a',
        hops: '班次未確認',
        confidence: 'estimated',
        source: '交通部 TDX 班表查詢失敗',
        upcomingTrips: [],
        bookingLinks: thsrBookings,
        navigationUrl: transitGoogleUrl,
      });
    }
  } else {
    options.push({
      mode: '高鐵',
      available: false,
      title: `高鐵未直達（${from} → ${to}）`,
      time: '需轉乘台鐵',
      detail: '起點或終點位於西部高鐵走廊外（如宜蘭／花蓮／臺東、基隆或屏東），建議搭乘台鐵城際列車或由高鐵南港／左營站轉乘台鐵。',
      fareText: '區間外需搭配台鐵轉乘',
      color: '#0c817a',
      hops: '非高鐵直達區間',
      confidence: 'scheduled',
      source: '交通部 TDX・台灣高鐵路網檢核',
      upcomingTrips: [],
      bookingLinks: thsrBookings,
      navigationUrl: transitGoogleUrl,
      steps: [
        { stepNo: 1, vehicle: '路網說明', instruction: `「${from} → ${to}」無高鐵直達車站`, detail: '建議改選下方「台鐵」直達方案，或搭乘高鐵至南港／左營站轉乘台鐵', duration: '需轉乘' },
      ],
    });
  }

  // 2. 台鐵 (TRA OD)
  const traBookings = [
    { label: '台鐵個人訂票系統', url: 'https://www.railway.gov.tw/tra-tip-web/tip/tip001/tip121/query', primary: true },
    { label: '台鐵列車時刻／票價查詢', url: 'https://www.railway.gov.tw/tra-tip-web/tip/tip001/tip112/gobytime' },
  ];
  const traFare = estimateTraFare(originCoords, destCoords);
  if (!tdxConfigured) {
    options.push({ mode: '台鐵', available: false, title: '尚無法查詢台鐵班次', time: '需要 TDX 憑證', detail: '此線上服務尚未設定 TDX 憑證；請直接查詢台鐵官方班表。', color: '#da8a2c', hops: '班次未查證', confidence: 'estimated', source: '交通部 TDX 憑證未設定', upcomingTrips: [], bookingLinks: traBookings, navigationUrl: transitGoogleUrl });
  } else if (originHub?.traId && destHub?.traId && originHub.traId !== destHub.traId) {
    try {
      const traUrl = `${TDX_API_BASE}/v2/Rail/TRA/DailyTimetable/OD/${originHub.traId}/to/${destHub.traId}/${datePart}?$format=JSON`;
      const raw = await fetchTdxJson(traUrl);
      const list = Array.isArray(raw) ? raw : [];
      const mapped = list
        .map((item) => {
          const dep = (item.OriginStopTime?.DepartureTime || '').slice(0, 5);
          const arr = (item.DestinationStopTime?.ArrivalTime || '').slice(0, 5);
          const mins = calcDurationMinutes(dep, arr);
          const rawType = item.DailyTrainInfo?.TrainTypeName?.Zh_tw || '列車';
          const shortType = rawType.replace(/\(.*?\)/g, '').trim() || rawType;
          return {
            trainNo: `${shortType} ${item.DailyTrainInfo?.TrainNo || ''} 次`,
            origin: item.OriginStopTime?.StationName?.Zh_tw || originHub.label,
            destination: item.DestinationStopTime?.StationName?.Zh_tw || destHub.label,
            departure: dep,
            arrival: arr,
            durationMinutes: mins,
            durationText: formatDuration(mins),
          };
        })
        .filter((t) => t.departure)
        .sort((a, b) => a.departure.localeCompare(b.departure));

      const afterTime = mapped.filter((t) => t.departure >= timePart);
      const upcoming = (afterTime.length > 0 ? afterTime : mapped).slice(0, 8);
      const first = upcoming[0];
      if (first) {
        options.push({
          mode: '台鐵',
          available: true,
          title: `${first.trainNo}・台鐵${first.origin}站 → 台鐵${first.destination}站`,
          time: first.durationText,
          detail: `${first.departure} 發車 → ${first.arrival} 抵達・當日共 ${mapped.length} 班台鐵列車`,
          fareText: traFare,
          color: '#da8a2c',
          hops: '台鐵直達',
          confidence: 'scheduled',
          source: '交通部 TDX・台鐵 OD 每日時刻表 v2',
          upcomingTrips: upcoming,
          bookingLinks: traBookings,
          navigationUrl: transitGoogleUrl,
          steps: [
            { stepNo: 1, vehicle: '市區接駁／進站', instruction: `由「${from}」前往台鐵${first.origin}站`, detail: '可使用電子票證（悠遊卡／一卡通）或對號座車票進站（EMU3000／普悠瑪／太魯閣須先購票）', duration: '約 10–15 分' },
            { stepNo: 2, vehicle: first.trainNo, instruction: `搭乘 ${first.trainNo}（台鐵${first.origin}站 → 台鐵${first.destination}站）`, detail: `${first.departure} 出發 → ${first.arrival} 抵達・${traFare}`, duration: first.durationText },
            { stepNo: 3, vehicle: '出站步行／轉乘', instruction: `由台鐵${first.destination}站前往「${to}」`, detail: '出站後可轉乘市區公車、YouBike 或步行前往目的地', duration: '約 10–15 分' },
          ],
        });
      } else {
        throw new Error('無直達班次');
      }
    } catch (error) {
      options.push({
        mode: '台鐵',
        available: false,
        title: `台鐵班次暫時無法確認・${originHub.label} → ${destHub.label}`,
        time: '請查官方班表',
        detail: error instanceof Error ? error.message : 'TDX 尚未提供可確認的班次資料。',
        color: '#da8a2c',
        hops: '班次未確認',
        confidence: 'estimated',
        source: '交通部 TDX 班表查詢失敗',
        upcomingTrips: [],
        bookingLinks: traBookings,
        navigationUrl: transitGoogleUrl,
      });
    }
  }

  // 3. 自駕／汽車導航 (Driving Navigation with OSRM + Live Corridor Alerts)
  const tollEst = drivingRoute.distanceKm > 25 ? Math.round(Math.max(0, drivingRoute.distanceKm - 20) * 1.2) : 0;
  const fuelEst = Math.round(drivingRoute.distanceKm * 2.4);
  const corridorEvents = formatCorridorMetric('即時路況', corridorAlerts.events);
  const corridorCameras = formatCorridorMetric('測速點', corridorAlerts.cameras);
  options.push({
    mode: '自駕',
    available: true,
    title: `${drivingRoute.hasRoadGeometry ? '自駕路徑' : '自駕概略估算'}・${from} → ${to}（約 ${drivingRoute.distanceKm} 公里）`,
    time: formatDuration(drivingRoute.durationMinutes),
    detail: `${drivingRoute.hasRoadGeometry ? `途經：${drivingRoute.roadNames.join(' → ') || '主要道路'}` : drivingRoute.note}・沿線${corridorEvents}、${corridorCameras}`,
    fareText: `預估油資約 NT$${fuelEst}・eTag 國道通行費約 NT$${tollEst}`,
    color: '#2563eb',
    hops: `${drivingRoute.distanceKm} km`,
    confidence: 'estimated',
    source: `OSRM 道路路徑估時；警廣路況狀態：${corridorAlerts.events.status}；官方測速清冊狀態：${corridorAlerts.cameras.status}`,
    upcomingTrips: [],
    bookingLinks: [
      { label: '開啟 Google Maps 語音導航', url: drivingGoogleUrl, primary: true },
      { label: '高公局 1968 即時路況', url: 'https://1968.freeway.gov.tw/' },
    ],
    navigationUrl: drivingGoogleUrl,
    path: drivingRoute.hasRoadGeometry ? drivingRoute.path : undefined,
    corridorEventsCount: corridorAlerts.events.count ?? undefined,
    corridorCamerasCount: corridorAlerts.cameras.count ?? undefined,
    corridorEventsStatus: corridorAlerts.events.status,
    corridorEventsUpdatedAt: corridorAlerts.events.updatedAt,
    corridorCamerasStatus: corridorAlerts.cameras.status,
    corridorCamerasUpdatedAt: corridorAlerts.cameras.updatedAt,
    steps: [
      { stepNo: 1, vehicle: '出發上路', instruction: `由「${from}」出發匯入主幹道路`, detail: `總里程約 ${drivingRoute.distanceKm} 公里，預估行車時間 ${formatDuration(drivingRoute.durationMinutes)}`, duration: '起點出發' },
      { stepNo: 2, vehicle: '主要行駛路段', instruction: drivingRoute.hasRoadGeometry ? `行駛 ${drivingRoute.roadNames.join(' → ') || '主要道路'}` : '請在 Google 地圖開啟可導航路徑', detail: `沿線${corridorEvents}、${corridorCameras}`, duration: formatDuration(drivingRoute.durationMinutes) },
      { stepNo: 3, vehicle: '抵達目的地', instruction: `抵達「${to}」周邊停車與下客區`, detail: `預估油資 NT$${fuelEst}、國道 eTag 通行費約 NT$${tollEst}`, duration: '抵達終點' },
    ],
  });

  // These modes are external route searches until this app can calculate their real itineraries.
  const externalTransitOption = (mode, color) => ({
    mode,
    available: false,
    title: `${mode}路線由外部服務查詢`,
    time: '尚無可靠估時',
    detail: '目前沒有可核對的起訖路線、班次與轉乘資料；開啟 Google 地圖查看可用方案。',
    color,
    hops: '外部查詢',
    confidence: 'estimated',
    source: 'Google 地圖外部路線查詢',
    upcomingTrips: [],
    bookingLinks: [],
    navigationUrl: transitGoogleUrl,
  });
  options.push(externalTransitOption('捷運', '#4d6b9e'));
  options.push(externalTransitOption('公車', '#5175a4'));
  options.push({
    mode: '航班',
    available: false,
    title: '航班行程由業者班表查詢',
    time: '尚無可靠估時',
    detail: '此頁尚未將航班時刻、票價與機場接駁串成完整行程。',
    color: '#4074b3',
    hops: '業者查詢',
    confidence: 'estimated',
    source: '航班與機場接駁尚未整合',
    upcomingTrips: [],
    bookingLinks: [
      { label: '立榮航空', url: 'https://www.uniair.com.tw/' },
      { label: '華信航空', url: 'https://www.mandarin-airlines.com/' },
    ],
  });

  return {
    status: 'available',
    source: `${tdxConfigured ? '交通部 TDX OD 班表＋' : ''}OSRM 導航引擎＋警廣路況狀態`,
    updatedAt: `${datePart} ${timePart}`,
    fetchedAt,
    tdxConfigured,
    note: `${tdxConfigured ? 'TDX 班表查詢已啟用' : 'TDX 憑證尚未設定；高鐵／台鐵班次不可用'}。行車路徑與估時為 OSRM 計算；沿線道路事件及測速點分別依來源狀態顯示，並非即時車速或導航指示。`,
    resolvedOrigin: originHub?.label || from,
    resolvedDestination: destHub?.label || to,
    originCoords,
    destCoords,
    distanceKm: drivingRoute.distanceKm,
    options,
  };
}

export function createApiServer({ serveClient = false } = {}) {
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
      const options = {
        station: reqUrl.searchParams.get('station') || 'all',
        operator: reqUrl.searchParams.get('operator') || 'TRTC',
        city: reqUrl.searchParams.get('city') || 'Taipei',
        route: reqUrl.searchParams.get('route') || '',
        airport: reqUrl.searchParams.get('airport') || 'TPE',
        refresh: reqUrl.searchParams.get('refresh') || '',
      };
      try {
        const result = await getTransitTrips(mode, options);
        response.writeHead(result.status === 'error' ? 502 : 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(result));
      } catch {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ data: [], status: 'error', source: '交通部 TDX', updatedAt: '', fetchedAt: '', confidence: 'scheduled', note: '無法處理大眾運輸查詢。' }));
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/routes') {
      const from = reqUrl.searchParams.get('from') || '臺北車站';
      const to = reqUrl.searchParams.get('to') || '左營站';
      const departAt = reqUrl.searchParams.get('departAt') || '';
      try {
        const result = await getMultiModalRoutes({ from, to, departAt });
        response.writeHead(result.status === 'error' ? 400 : 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(result));
      } catch {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ status: 'error', source: '交通部 TDX', updatedAt: '', fetchedAt: '', options: [], note: '無法處理跨運具路線查詢。' }));
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/status') {
      const tdxConfigured = Boolean(process.env.TDX_CLIENT_ID?.trim() && process.env.TDX_CLIENT_SECRET?.trim());
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: true, tdxConfigured, thsrStations: THSR_STATIONS }));
      return;
    }

    if (serveClient && (request.method === 'GET' || request.method === 'HEAD') && !pathname.startsWith('/api/')) {
      const clientRoot = resolve(process.cwd(), 'dist');
      let relativePath;
      try { relativePath = decodeURIComponent(pathname).replace(/^[/\\]+/, ''); }
      catch {
        response.writeHead(400);
        response.end();
        return;
      }
      let clientFile = resolve(clientRoot, relativePath || 'index.html');
      if (!clientFile.startsWith(`${clientRoot}/`) && !clientFile.startsWith(`${clientRoot}\\`) && clientFile !== resolve(clientRoot, 'index.html')) {
        response.writeHead(403);
        response.end();
        return;
      }
      if (!existsSync(clientFile) || !statSync(clientFile).isFile()) {
        clientFile = resolve(clientRoot, 'index.html');
      }
      if (!existsSync(clientFile)) {
        response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('網站尚未建置，請先執行 npm run build');
        return;
      }
      const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
      response.writeHead(200, { 'Content-Type': mimeTypes[extname(clientFile)] || 'application/octet-stream', 'Cache-Control': clientFile.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
      response.end(request.method === 'HEAD' ? undefined : readFileSync(clientFile));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  createApiServer({ serveClient: true }).listen(PORT, HOST, () => console.log(`Island Pulse web server listening on ${HOST}:${PORT}`));
}

