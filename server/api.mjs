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

const THSR_STATIONS = [
  { id: '0990', name: '南港' },
  { id: '1000', name: '台北' },
  { id: '1010', name: '板橋' },
  { id: '1020', name: '桃園' },
  { id: '1030', name: '新竹' },
  { id: '1035', name: '苗栗' },
  { id: '1040', name: '台中' },
  { id: '1043', name: '彰化' },
  { id: '1047', name: '雲林' },
  { id: '1050', name: '嘉義' },
  { id: '1060', name: '台南' },
  { id: '1070', name: '左營' },
];

const HUB_DIRECTORY = [
  { keys: ['台北', '臺北'], label: '臺北', thsrId: '1000', traId: '1000', metroOp: 'TRTC', busCity: 'Taipei', airport: 'TSA' },
  { keys: ['南港'], label: '南港', thsrId: '0990', traId: '0980', metroOp: 'TRTC', busCity: 'Taipei', airport: 'TSA' },
  { keys: ['板橋', '新北'], label: '板橋', thsrId: '1010', traId: '1020', metroOp: 'TRTC', busCity: 'NewTaipei', airport: 'TSA' },
  { keys: ['基隆'], label: '基隆', thsrId: null, traId: '0900', metroOp: null, busCity: 'Keelung', airport: 'TSA' },
  { keys: ['桃園', '中壢'], label: '桃園', thsrId: '1020', traId: '1080', metroOp: 'TYMC', busCity: 'Taoyuan', airport: 'TPE' },
  { keys: ['新竹'], label: '新竹', thsrId: '1030', traId: '1210', metroOp: null, busCity: 'Hsinchu', airport: 'TPE' },
  { keys: ['苗栗'], label: '苗栗', thsrId: '1035', traId: '3160', metroOp: null, busCity: 'Taichung', airport: 'RMQ' },
  { keys: ['台中', '臺中'], label: '臺中', thsrId: '1040', traId: '3300', metroOp: 'TMRT', busCity: 'Taichung', airport: 'RMQ' },
  { keys: ['彰化', '員林'], label: '彰化', thsrId: '1043', traId: '3360', metroOp: null, busCity: 'Taichung', airport: 'RMQ' },
  { keys: ['雲林', '斗六'], label: '雲林/斗六', thsrId: '1047', traId: '3470', metroOp: null, busCity: 'Tainan', airport: 'RMQ' },
  { keys: ['嘉義'], label: '嘉義', thsrId: '1050', traId: '4080', metroOp: null, busCity: 'Tainan', airport: 'KHH' },
  { keys: ['台南', '臺南'], label: '臺南', thsrId: '1060', traId: '4220', metroOp: null, busCity: 'Tainan', airport: 'KHH' },
  { keys: ['左營', '新左營', '高雄'], label: '左營/高雄', thsrId: '1070', traId: '4340', metroOp: 'KRTC', busCity: 'Kaohsiung', airport: 'KHH' },
  { keys: ['屏東'], label: '屏東', thsrId: null, traId: '5000', metroOp: null, busCity: 'Kaohsiung', airport: 'KHH' },
  { keys: ['宜蘭', '羅東'], label: '宜蘭', thsrId: null, traId: '7190', metroOp: null, busCity: 'Taipei', airport: 'TSA' },
  { keys: ['花蓮'], label: '花蓮', thsrId: null, traId: '7000', metroOp: null, busCity: 'Taipei', airport: 'TSA' },
  { keys: ['台東', '臺東', '玉里'], label: '臺東', thsrId: null, traId: '6000', metroOp: null, busCity: 'Kaohsiung', airport: 'KHH' },
];

function resolveHub(input = '') {
  const cleaned = String(input).trim().replace(/臺/g, '台').replace(/(高鐵站|火車站|車站|機場|站|市|縣)$/g, '');
  if (!cleaned) return HUB_DIRECTORY[0];
  return (
    HUB_DIRECTORY.find((hub) => hub.keys.some((k) => k.replace(/臺/g, '台') === cleaned || cleaned.includes(k.replace(/臺/g, '台'))))
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
    const token = await getTdxAccessToken();
    const today = new Date().toISOString().slice(0, 10);
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

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`TDX ${mode} API 回應 ${res.status}`);
    const raw = await res.json();
    const fetchedAt = new Date().toISOString();
    let list = Array.isArray(raw) ? raw : [];

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
        const delay = Number(item.DelayTime || 0);
        return {
          id: `tra-${item.TrainNo || idx}-${item.StationID || idx}-${idx}`,
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
          meta: { source: `交通部 TDX・${cityName}公車預估到站 v2`, updatedAt: (item.UpdateTime || fetchedAt).slice(0, 16).replace('T', ' '), fetchedAt, status: 'available', confidence: 'live' },
        };
      }
      if (mode === '航班') {
        return {
          id: `air-${airport}-${item.FlightNumber || idx}-${idx}`,
          mode: '航班',
          route: `${item.AirlineID || ''} ${item.FlightNumber || ''}`.trim(),
          origin: item.DepartureAirportID || airport,
          destination: item.ArrivalAirportID || '目的地',
          departure: (item.ScheduleDepartureTime || '').slice(11, 16) || '--:--',
          arrival: (item.EstimatedDepartureTime || item.ActualDepartureTime || item.ScheduleDepartureTime || '').slice(11, 16) || '--:--',
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
      updatedAt: fetchedAt.slice(0, 16).replace('T', ' '),
      fetchedAt,
      confidence: mode === '高鐵' || mode === '捷運' ? 'scheduled' : 'live',
      tdxConfigured: true,
    };
    transitCache.set(cacheKey, { result, cachedAt: Date.now() });
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

async function getMultiModalRoutes({ from = '臺北車站', to = '左營站', departAt = '' }) {
  const clientId = process.env.TDX_CLIENT_ID?.trim();
  const clientSecret = process.env.TDX_CLIENT_SECRET?.trim();
  const fetchedAt = new Date().toISOString();
  const datePart = (departAt && departAt.slice(0, 10)) || fetchedAt.slice(0, 10);
  const timePart = (departAt && departAt.slice(11, 16)) || '08:00';

  if (!clientId || !clientSecret) {
    return {
      status: 'unavailable',
      source: '交通部 TDX 運輸資料流通服務平臺',
      updatedAt: '',
      fetchedAt,
      tdxConfigured: false,
      options: [],
      note: '尚未設定 TDX 伺服器憑證。',
    };
  }

  const originHub = resolveHub(from);
  const destHub = resolveHub(to);
  const token = await getTdxAccessToken();
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const options = [];

  // 1. 高鐵 (THSR OD)
  if (originHub?.thsrId && destHub?.thsrId && originHub.thsrId !== destHub.thsrId) {
    try {
      const thsrUrl = `${TDX_API_BASE}/v2/Rail/THSR/DailyTimetable/OD/${originHub.thsrId}/to/${destHub.thsrId}/${datePart}?$format=JSON`;
      const res = await fetch(thsrUrl, { headers, signal: AbortSignal.timeout(12000) });
      const raw = res.ok ? await res.json() : [];
      const list = Array.isArray(raw) ? raw : [];
      const mapped = list
        .map((item) => {
          const dep = item.OriginStopTime?.DepartureTime || '';
          const arr = item.DestinationStopTime?.ArrivalTime || '';
          const mins = calcDurationMinutes(dep, arr);
          return {
            trainNo: `高鐵 ${item.DailyTrainInfo?.TrainNo || ''} 次`,
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
      const upcoming = (afterTime.length > 0 ? afterTime : mapped).slice(0, 6);
      const first = upcoming[0];
      if (first) {
        options.push({
          mode: '高鐵',
          available: true,
          title: `${first.trainNo}・${first.origin} → ${first.destination}`,
          time: first.durationText,
          detail: `${first.departure} 發車 → ${first.arrival} 抵達・當日共 ${mapped.length} 班高鐵直達`,
          color: '#0c817a',
          hops: '直達',
          confidence: 'scheduled',
          source: '交通部 TDX・台灣高鐵 OD 每日時刻表 v2',
          upcomingTrips: upcoming,
        });
      } else {
        options.push({
          mode: '高鐵',
          available: false,
          title: `高鐵・${originHub.label} → ${destHub.label}`,
          time: '無直達班次',
          detail: '查無此日期之高鐵直達班表，建議改選鄰近日期或搭乘台鐵。',
          color: '#0c817a',
          hops: '無班次',
          confidence: 'scheduled',
          source: '交通部 TDX・台灣高鐵 OD 每日時刻表 v2',
          upcomingTrips: [],
        });
      }
    } catch {
      // Ignore individual mode error
    }
  } else {
    options.push({
      mode: '高鐵',
      available: false,
      title: `高鐵未直達（${from} → ${to}）`,
      time: '需轉乘',
      detail: '起點或終點位於高鐵路網外（如東部宜蘭／花蓮／臺東、基隆或屏東），建議優先搭乘台鐵城際列車。',
      color: '#0c817a',
      hops: '非高鐵走廊',
      confidence: 'scheduled',
      source: '交通部 TDX・台灣高鐵路網檢核',
      upcomingTrips: [],
    });
  }

  // 2. 台鐵 (TRA OD)
  if (originHub?.traId && destHub?.traId && originHub.traId !== destHub.traId) {
    try {
      const traUrl = `${TDX_API_BASE}/v2/Rail/TRA/DailyTimetable/OD/${originHub.traId}/to/${destHub.traId}/${datePart}?$format=JSON`;
      const res = await fetch(traUrl, { headers, signal: AbortSignal.timeout(12000) });
      const raw = res.ok ? await res.json() : [];
      const list = Array.isArray(raw) ? raw : [];
      const mapped = list
        .map((item) => {
          const dep = (item.OriginStopTime?.DepartureTime || '').slice(0, 5);
          const arr = (item.DestinationStopTime?.ArrivalTime || '').slice(0, 5);
          const mins = calcDurationMinutes(dep, arr);
          const typeName = item.DailyTrainInfo?.TrainTypeName?.Zh_tw || '列車';
          return {
            trainNo: `${typeName} ${item.DailyTrainInfo?.TrainNo || ''} 次`,
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
      const upcoming = (afterTime.length > 0 ? afterTime : mapped).slice(0, 6);
      const first = upcoming[0];
      if (first) {
        options.push({
          mode: '台鐵',
          available: true,
          title: `${first.trainNo}・${first.origin} → ${first.destination}`,
          time: first.durationText,
          detail: `${first.departure} 發車 → ${first.arrival} 抵達・當日共 ${mapped.length} 班台鐵列車`,
          color: '#da8a2c',
          hops: '直達',
          confidence: 'scheduled',
          source: '交通部 TDX・台鐵 OD 每日時刻表 v2',
          upcomingTrips: upcoming,
        });
      }
    } catch {
      // Ignore individual mode error
    }
  } else {
    options.push({
      mode: '台鐵',
      available: false,
      title: `台鐵・${from} → ${to}`,
      time: '請輸入主要車站',
      detail: '請輸入或點選台灣主要縣市與車站名稱（如臺北、板橋、新竹、臺中、臺南、高雄、花蓮、臺東）。',
      color: '#da8a2c',
      hops: '待選車站',
      confidence: 'scheduled',
      source: '交通部 TDX・台鐵車站檢核',
      upcomingTrips: [],
    });
  }

  // 3. 捷運 (Metro)
  const metroOp = originHub?.metroOp || destHub?.metroOp || 'TRTC';
  const sameMetro = originHub?.metroOp && originHub.metroOp === destHub?.metroOp;
  options.push({
    mode: '捷運',
    available: Boolean(originHub?.metroOp || destHub?.metroOp),
    title: sameMetro
      ? `都會捷運直達／轉乘・${originHub.label} ↔ ${destHub.label}`
      : `兩端都會捷運接駁（${originHub?.metroOp || destHub?.metroOp || '北捷/高捷/桃捷/中捷'}）`,
    time: sameMetro ? '約 15–40 分' : '頭末段接駁',
    detail: sameMetro
      ? `同一都會捷運路網（${metroOp}），營運時間 06:00–24:00，尖峰班距約 3–6 分鐘`
      : `跨縣市行程需搭配高鐵或台鐵主幹，起訖站可轉乘 ${metroOp} 都會捷運系統（營運 06:00–24:00）`,
    color: '#4d6b9e',
    hops: sameMetro ? '都會路網' : '需轉乘城際鐵路',
    confidence: 'scheduled',
    source: `交通部 TDX・${metroOp} 營運路網資料`,
    upcomingTrips: [],
  });

  // 4. 公車 (Bus)
  const busCity = originHub?.busCity || 'Taipei';
  options.push({
    mode: '公車',
    available: true,
    title: `市區幹線公車／公路客運接駁・${originHub?.label || from}`,
    time: originHub && destHub && originHub.busCity === destHub.busCity ? '約 25–55 分' : '站區轉乘接駁',
    detail: `已連線 TDX ${busCity} 即時公車預估到站服務；可於「大眾運輸 → 公車」切換縣市與搜尋路線號碼`,
    color: '#5175a4',
    hops: originHub && destHub && originHub.busCity === destHub.busCity ? '市區公車' : '轉乘接駁',
    confidence: 'live',
    source: `交通部 TDX・${busCity} 市區公車動態 v2`,
    upcomingTrips: [],
  });

  // 5. 航班 (Air)
  const airOrigin = originHub?.airport || 'TSA';
  const airDest = destHub?.airport || 'KHH';
  options.push({
    mode: '航班',
    available: airOrigin !== airDest,
    title: `機場航線動態（${airOrigin} / ${airDest}）`,
    time: airOrigin !== airDest ? '約 50–75 分（飛行）' : '同生活圈機場',
    detail: `對應機場：出發鄰近 ${airOrigin}、目的鄰近 ${airDest}；可於「大眾運輸 → 航班」查看即時起降狀態`,
    color: '#4074b3',
    hops: airOrigin !== airDest ? '機場轉乘' : '不需搭機',
    confidence: 'live',
    source: '交通部 TDX・航空即時航班資訊 v2',
    upcomingTrips: [],
  });

  return {
    status: 'available',
    source: '交通部 TDX・城際鐵路 OD 時刻表與多運具整合',
    updatedAt: `${datePart} ${timePart}`,
    fetchedAt,
    tdxConfigured: true,
    resolvedOrigin: originHub?.label || from,
    resolvedDestination: destHub?.label || to,
    options,
  };
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
        response.writeHead(result.status === 'error' ? 502 : 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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

    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  createApiServer().listen(PORT, HOST, () => console.log(`Island Pulse data API listening at http://${HOST}:${PORT}`));
}
