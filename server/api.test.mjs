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
