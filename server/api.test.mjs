import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from './api.mjs';

test('route API rejects unknown places instead of silently using Taipei', async (t) => {
  const server = createApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/routes?from=${encodeURIComponent('火星')}&to=${encodeURIComponent('月球')}`);
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.status, 'error');
  assert.match(payload.note, /無法辨識/);
  assert.equal(payload.originCoords, undefined);
});

test('route API rejects identical start and destination places', async (t) => {
  const server = createApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const place = encodeURIComponent('臺北車站');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/routes?from=${place}&to=${place}`);
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.match(payload.note, /相同/);
});

test('route API keeps driving and external modes available without TDX credentials', async (t) => {
  const server = createApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const previousId = process.env.TDX_CLIENT_ID;
  const previousSecret = process.env.TDX_CLIENT_SECRET;
  const nativeFetch = globalThis.fetch;
  delete process.env.TDX_CLIENT_ID;
  delete process.env.TDX_CLIENT_SECRET;
  globalThis.fetch = async (input) => {
    if (String(input).includes('router.project-osrm.org')) {
      return Response.json({ routes: [{ distance: 350000, duration: 18000, geometry: { coordinates: [[121.5, 25.0], [121.0, 24.5], [120.9, 22.7]] }, legs: [{ steps: [] }] }] });
    }
    return Response.json([]);
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
    if (previousId === undefined) delete process.env.TDX_CLIENT_ID;
    else process.env.TDX_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.TDX_CLIENT_SECRET;
    else process.env.TDX_CLIENT_SECRET = previousSecret;
  });

  const address = server.address();
  const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/routes?from=${encodeURIComponent('臺北車站')}&to=${encodeURIComponent('左營站')}`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.tdxConfigured, false);
  assert.equal(payload.options.find((item) => item.mode === '自駕')?.available, true);
  assert.equal(payload.options.find((item) => item.mode === '高鐵')?.available, false);
  assert.equal(payload.options.find((item) => item.mode === '台鐵')?.available, false);
  assert.equal(payload.options.find((item) => item.mode === '公車')?.navigationUrl.includes('google.com/maps'), true);
});

test('transit API never invents timetable rows when TDX is unavailable', async (t) => {
  const server = createApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const previousId = process.env.TDX_CLIENT_ID;
  const previousSecret = process.env.TDX_CLIENT_SECRET;
  const nativeFetch = globalThis.fetch;
  process.env.TDX_CLIENT_ID = 'test-client';
  process.env.TDX_CLIENT_SECRET = 'test-secret';
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/protocol/openid-connect/token')) {
      return new Response('TDX unavailable', { status: 503 });
    }
    return nativeFetch(input, init);
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
    if (previousId === undefined) delete process.env.TDX_CLIENT_ID;
    else process.env.TDX_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.TDX_CLIENT_SECRET;
    else process.env.TDX_CLIENT_SECRET = previousSecret;
  });

  const address = server.address();
  const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/transit?mode=${encodeURIComponent('高鐵')}&refresh=1`);
  const payload = await response.json();

  assert.equal(payload.status, 'error');
  assert.equal(payload.data.length, 0);
  assert.match(payload.note, /沒有可用快取/);
});
