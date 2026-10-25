import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeSpeedCameras,
  normalizeHighwaySpeedCameras,
  normalizePbsRoadEvents,
  normalizeSpeedCameras,
  parseCsv,
} from './csv.mjs';
import { findDownloadUrl } from './api.mjs';

test('finds the government resource URL inside the dataset API envelope', () => {
  const url = 'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/example/download';
  const tgosUrl = 'https://www.tgos.tw/tgos/VirtualDir/Product/example/13940.zip';
  assert.equal(findDownloadUrl({ success: true, result: { distribution: [{ resourceDownloadUrl: url }] } }), url);
  assert.equal(findDownloadUrl({ success: true, result: { distribution: [{ resourceDownloadUrl: tgosUrl }] } }), tgosUrl);
  assert.equal(findDownloadUrl({ result: { distribution: [{ resourceDownloadUrl: 'https://other.example/data.csv' }] } }), undefined);
});

test('parse CSV preserves quoted commas, escaped quotes, and skips whitespace-only rows', () => {
  assert.deepEqual(
    parseCsv('\uFEFFa,b\r\n"Taichung, City","Road ""A"""\r\n  ,   \r\n'),
    [['a', 'b'], ['Taichung, City', 'Road "A"']],
  );
});

test('normalizes official camera rows, skipping description, duplicates, and invalid coordinates', () => {
  const csv = [
    'CityName,RegionName,Address,DeptNm,BranchNm,Longitude,Latitude,direct,limit',
    '縣市,區域,地址,機關,分局,經度,緯度,方向,速限',
    '臺北市,大安區,建國高架,警察局,大安分局,121.53,25.04,南向,60',
    '臺北市,大安區,建國高架,警察局,大安分局,121.53,25.04,南向,60',
    '臺北市,未知,錯誤點,警察局,,0,0,,',
  ].join('\n');
  const cameras = normalizeSpeedCameras(csv, { updatedAt: '2026-10-13', fetchedAt: '2026-10-14T00:00:00Z' });
  assert.equal(cameras.length, 1);
  const [camera] = cameras;
  assert.equal(camera.city, '臺北市');
  assert.equal(camera.limitKph, 60);
  assert.deepEqual(camera.coordinates, [25.04, 121.53]);
  assert.equal(camera.meta.confidence, 'official-static');
  assert.equal(camera.meta.updatedAt, '2026-10-13');
});

test('normalizes dataset 13940 highway cameras and deduplicates against dataset 7320 within 50m', () => {
  const csv7320 = 'CityName,RegionName,Address,DeptNm,BranchNm,Longitude,Latitude,direct,limit\n國道一號,,國道一號南向2公里,國道公路警察局,國道公路警一隊,121.724738,25.106857,往南,100\n';
  const csv13940 = [
    '設備編號,型式,縣市,行政區,設置區域描述,設置地點,取締項目,座標緯度,座標經度,拍攝方向,速限,管轄單位,備註',
    '1,雷達,,,,國道一號南向2公里,超速,25.106857,121.724738,北往南,100,國道公路警一隊,',
    '72,雷達,,,,國道一號汐五南向16.1公里,超速,25.064278,121.601444,北往南,100,國道公路警一隊,',
    '154,雷達,,,,壞座標點位,超速,25.03584,121.6219225.03584,南往北,40,國道公路警九隊,',
  ].join('\n');
  const primary = normalizeSpeedCameras(csv7320, { updatedAt: '2026-10-13', fetchedAt: '2026-10-14T00:00:00Z' });
  const highway = normalizeHighwaySpeedCameras(csv13940, { updatedAt: '2026-07-22', fetchedAt: '2026-10-14T00:00:00Z' });
  assert.equal(highway.length, 2);
  const merged = mergeSpeedCameras(primary, highway);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].road, '國道一號汐五南向16.1公里');
  assert.equal(merged[1].datasetId, '13940');
});

test('normalizes PBS live road events and classifies semantic kind and cleared state', () => {
  const raw = [
    {
      UID: '1151025001',
      roadtype: '道路施工',
      happendate: '2026-10-25',
      happentime: '14:04:00.0000000',
      modDttm: '2026-10-25 15:01:52.57',
      areaNm: '(西濱快速)-台61線',
      road: '',
      direction: '雙向',
      y1: '25.13779',
      x1: '121.37243',
      srcdetail: '公路局中區養護工程分局',
      comment: '台61線雙向施工管制',
      region: 'M',
    },
    {
      UID: '1151025002',
      roadtype: '事故',
      happendate: '2026-10-25',
      happentime: '14:44:00.0000000',
      modDttm: '2026-10-25 14:55:22.5',
      areaNm: '國道１號',
      road: '',
      direction: '南下',
      y1: '23.05834',
      x1: '120.25338',
      srcdetail: '國道警局',
      comment: '14:52事故排除,回堵約2k',
      region: 'S',
    },
  ];
  const events = normalizePbsRoadEvents(raw, { fetchedAt: '2026-10-25T07:10:00Z' });
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'roadwork');
  assert.equal(events[0].cleared, false);
  assert.equal(events[1].kind, 'incident');
  assert.equal(events[1].cleared, true);
  assert.equal(events[1].severity, 'low');
});

test('marks future and expired road notices separately and does not label reopened roads as closures', () => {
  const events = normalizePbsRoadEvents([
    { UID: 'future', roadtype: '交通管制', happendate: '2026-10-26', modDttm: '2026-10-26 00:10', areaNm: '日月潭', comment: '自115年11月1日當日8時起至12時止，辦理活動管制。', y1: '23.8', x1: '120.9' },
    { UID: 'expired', roadtype: '交通管制', happendate: '2026-10-26', modDttm: '2026-10-26 00:10', areaNm: '彰化', comment: '自115年3月2日至115年6月1日止，活動管制。', y1: '24.0', x1: '120.5' },
    { UID: 'open', roadtype: '交通管制', happendate: '2026-10-26', modDttm: '2026-10-26 00:10', areaNm: '花蓮', comment: '於115年1月1日正式通車，維持雙向各1快1慢車道。', y1: '23.9', x1: '121.6' },
  ], { fetchedAt: '2026-10-25T18:00:00Z' });

  assert.equal(events[0].phase, 'upcoming');
  assert.equal(events[1].phase, 'ended');
  assert.equal(events[2].phase, 'active');
  assert.equal(events[2].kind, 'incident');
});
