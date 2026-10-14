import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../api/serverApi.js', import.meta.url), 'utf8');
const match = source.match(/(async function apiFetch\([\s\S]*?)\n\}\n/);
assert.ok(match);

for (const path of ['/auth/login', '/settings/dj-pin/init', '/staff']) {
  test(`actual transport 401 for ${path} ${path === '/staff' ? 'expires' : 'preserves'} current operator`, async () => {
    let cleared = 0, events = 0;
    const context = {
      DJ_PATHS: [], _tokenOverride: null, getToken: () => 'fixture-current-token',
      getApiBase: () => '/api', DEFAULT_REQUEST_TIMEOUT_MS: 1000,
      telemetryEndpoint: () => 'other', telemetryFailure: () => 'http',
      shouldRecordRemoteFailure: () => false, recordRemoteTelemetry: () => {},
      withRequestDeadline: (options, fn) => fn(undefined),
      fetch: async () => ({ status: 401, ok: false, json: async () => ({ error: 'Incorrect PIN' }) }),
      clearToken: () => { cleared++; },
      Event: class {}, window: { dispatchEvent: () => { events++; } },
    };
    const apiFetch = vm.runInNewContext(`(${match[1]}\n})`, context);
    await assert.rejects(apiFetch(path, { method: 'POST' }), error => error.status === 401);
    assert.equal(cleared, path === '/staff' ? 1 : 0);
    assert.equal(events, path === '/staff' ? 1 : 0);
  });
}
