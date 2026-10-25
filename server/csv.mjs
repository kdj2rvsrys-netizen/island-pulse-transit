import { inflateRawSync } from 'node:zlib';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function isValidTaiwanCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 20 && lat <= 27 && lon >= 118 && lon <= 123;
}

export function haversineMeters([lat1, lon1], [lat2, lon2]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function normalizeDirectionTag(direction = '') {
  if (/雙向|南北|東西/.test(direction)) return 'both';
  if (/南|北往南/.test(direction)) return 'south';
  if (/北|南往北/.test(direction)) return 'north';
  if (/東|西往東/.test(direction)) return 'east';
  if (/西|東往西/.test(direction)) return 'west';
  return direction.trim();
}

export function normalizeSpeedCameras(csv, { updatedAt, fetchedAt }) {
  const parsed = parseCsv(csv);
  const [header, ...rest] = parsed;
  if (!header || !header.includes('Latitude') || !header.includes('Longitude')) {
    throw new Error('官方測速資料格式與預期不符');
  }
  const index = Object.fromEntries(header.map((name, i) => [name.trim(), i]));
  const records = rest.length > 0 && Number.isNaN(Number(rest[0][index.Latitude])) ? rest.slice(1) : rest;
  const seenIds = new Set();

  return records.flatMap((record) => {
    const lat = Number(record[index.Latitude]);
    const lon = Number(record[index.Longitude]);
    if (!isValidTaiwanCoord(lat, lon)) return [];
    const city = record[index.CityName]?.trim() ?? '';
    const region = record[index.RegionName]?.trim() ?? '';
    const address = record[index.Address]?.trim() ?? '';
    const direction = record[index.direct]?.trim() ?? '';
    const rawLimit = record[index.limit]?.trim() ?? '';
    const limit = rawLimit ? Number(rawLimit) : Number.NaN;
    const baseId = ['7320', city, region, address, direction, lat, lon].join('|');
    if (seenIds.has(baseId)) return [];
    seenIds.add(baseId);
    return [{
      id: baseId,
      name: '固定式測速照相',
      city,
      region,
      address,
      road: address || [city, region].filter(Boolean).join(''),
      authority: [record[index.DeptNm]?.trim(), record[index.BranchNm]?.trim()].filter(Boolean).join('・'),
      limitKph: Number.isFinite(limit) ? limit : null,
      direction: direction || '方向未提供',
      coordinates: [lat, lon],
      datasetId: '7320',
      meta: {
        source: '內政部警政署・政府資料開放平臺（資料集 7320）',
        updatedAt,
        fetchedAt,
        status: 'available',
        confidence: 'official-static',
        note: '官方設置點資料，非即時；資料不定期更新，請以現場標誌及交通規則為準。',
      },
    }];
  });
}

export function extractCsvFromZipBuffer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('非有效的 ZIP 檔案格式');
  }
  const method = buf.readUInt16LE(8);
  const compressedSize = buf.readUInt32LE(18);
  const fileNameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const dataOffset = 30 + fileNameLen + extraLen;
  const slice = compressedSize > 0 ? buf.subarray(dataOffset, dataOffset + compressedSize) : buf.subarray(dataOffset);
  const raw = method === 8 ? inflateRawSync(slice) : method === 0 ? slice : (() => { throw new Error(`不支援的 ZIP 壓縮方式 ${method}`); })();
  return new TextDecoder('utf-8').decode(raw);
}

export function normalizeHighwaySpeedCameras(csv, { updatedAt, fetchedAt }) {
  const parsed = parseCsv(csv);
  const [header, ...records] = parsed;
  if (!header || !header.some((col) => col.includes('緯度')) || !header.some((col) => col.includes('經度'))) {
    throw new Error('國道測速資料格式與預期不符');
  }
  const index = Object.fromEntries(header.map((name, i) => [name.trim(), i]));
  const seenIds = new Set();

  return records.flatMap((record) => {
    const lat = Number(record[index['座標緯度']]);
    const lon = Number(record[index['座標經度']]);
    if (!isValidTaiwanCoord(lat, lon)) return [];
    const city = record[index['縣市']]?.trim() ?? '';
    const region = record[index['行政區']]?.trim() ?? '';
    const address = (record[index['設置地點']] ?? record[index['設置區域描述']] ?? '').trim();
    const direction = record[index['拍攝方向']]?.trim() ?? '';
    const rawLimit = record[index['速限']]?.trim() ?? '';
    const limit = rawLimit ? Number(rawLimit) : Number.NaN;
    const enforcement = record[index['取締項目']]?.trim() || undefined;
    const authority = [ '國道公路警察局', record[index['管轄單位']]?.trim() ].filter(Boolean).join('・');
    const baseId = ['13940', address, direction, lat, lon].join('|');
    if (seenIds.has(baseId)) return [];
    seenIds.add(baseId);
    return [{
      id: baseId,
      name: '國道固定式測速照相',
      city,
      region,
      address,
      road: address || '國道公路路段',
      authority,
      limitKph: Number.isFinite(limit) ? limit : null,
      direction: direction || '方向未提供',
      coordinates: [lat, lon],
      datasetId: '13940',
      enforcement,
      meta: {
        source: '內政部警政署・政府資料開放平臺（資料集 13940）',
        updatedAt,
        fetchedAt,
        status: 'available',
        confidence: 'official-static',
        note: '國道官方設置點清冊，非即時執法狀態；請依現場速限標誌行駛。',
      },
    }];
  });
}

export function mergeSpeedCameras(primary7320, highway13940) {
  const merged = [...primary7320];
  for (const candidate of highway13940) {
    const candDir = normalizeDirectionTag(candidate.direction);
    const isDuplicate = merged.some((existing) => {
      if (existing.address && candidate.address && existing.address === candidate.address) return true;
      const dist = haversineMeters(existing.coordinates, candidate.coordinates);
      if (dist <= 50) {
        const existDir = normalizeDirectionTag(existing.direction);
        return !candDir || !existDir || candDir === existDir;
      }
      return false;
    });
    if (!isDuplicate) merged.push(candidate);
  }
  return merged;
}

export function normalizePbsRoadEvents(items, { fetchedAt }) {
  if (!Array.isArray(items)) throw new Error('警廣路況資料格式不符');
  const seenUids = new Set();

  return items.flatMap((item, idx) => {
    const lat = Number(item.y1);
    const lon = Number(item.x1);
    if (!isValidTaiwanCoord(lat, lon)) return [];
    const uid = String(item.UID || `${item.happendate}-${item.happentime}-${idx}`).trim();
    if (seenUids.has(uid)) return [];
    seenUids.add(uid);

    const roadtype = String(item.roadtype || '其他').trim();
    const comment = String(item.comment || '').trim();
    const areaNm = String(item.areaNm || '').trim();
    const road = String(item.road || '').trim();
    const direction = String(item.direction || '').trim() || '雙向或未註明';
    const srcdetail = String(item.srcdetail || '警察廣播電臺').trim();
    const happendate = String(item.happendate || '').trim();
    const happentime = String(item.happentime || '').trim().slice(0, 5);
    const modDttm = String(item.modDttm || '').trim();

    let kind;
    if (roadtype === '道路施工' || /施工|刨鋪|養護|改建|工程/.test(roadtype)) {
      kind = 'roadwork';
    } else if (roadtype === '阻塞' || /壅塞|車多|回堵/.test(roadtype)) {
      kind = 'congestion';
    } else if (roadtype === '交通管制' || roadtype === '災變' || /封閉|全線封閉|雙向封閉|管制通行|坍方|落石阻斷/.test(comment)) {
      kind = 'closure';
    } else {
      kind = 'incident';
    }

    const cleared = /已排除|事故排除|解除管制|恢復通行|障礙排除|狀況排除/.test(comment);
    let severity = 'medium';
    if (cleared) {
      severity = 'low';
    } else if (kind === 'closure' || roadtype === '災變' || /全線封閉|重大|死亡|翻車|連環|多車|回堵[3-9]K|回堵\d{2}K|紫爆/i.test(comment)) {
      severity = 'high';
    } else if (roadtype === '其他' || roadtype === '阻塞') {
      severity = 'low';
    }

    const location = [areaNm, road].filter(Boolean).join('・') || comment.split(/[，,。\n\s]/)[0]?.slice(0, 28) || '台灣道路路段';
    const firstLine = comment.split(/\r?\n/)[0] ?? '';
    const title = roadtype === '事故' ? '道路交通事故'
      : roadtype === '道路施工' ? '道路施工與管制'
      : roadtype === '阻塞' ? '路段車多壅塞'
      : roadtype === '交通障礙' ? '道路散落物／交通障礙'
      : roadtype === '交通管制' ? '路段交通管制'
      : roadtype === '號誌故障' ? '號誌設備異常'
      : roadtype === '災變' ? '道路災變阻斷'
      : firstLine.slice(0, 18) || '一般路況通報';

    const updatedAt = modDttm ? modDttm.slice(0, 16) : `${happendate} ${happentime}`.trim();

    return [{
      id: `pbs-${uid}`,
      kind,
      subKind: roadtype,
      title: cleared ? `${title}（已排除）` : title,
      location,
      direction,
      description: comment || '無詳細說明',
      severity,
      coordinates: [lat, lon],
      observedAt: happentime || updatedAt.slice(11, 16) || '近期',
      updatedAt,
      cleared,
      region: String(item.region || 'A').trim(),
      authority: srcdetail,
      meta: {
        source: `內政部警政署警察廣播電臺・即時路況（資料集 15221）`,
        updatedAt,
        fetchedAt,
        status: 'available',
        confidence: 'official-live',
        note: `通報來源：${srcdetail}。與警廣查詢網頁至多有 1 分鐘時間差。`,
      },
    }];
  });
}
