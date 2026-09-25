import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRemoteTelemetry, allowRemoteTelemetry } from './remote-telemetry.js';

test('remote diagnostics retain only bounded operational fields', () => {
  const cleaned = sanitizeRemoteTelemetry({
    type: 'remote_request', view: 'desktop', clientId: 'client-12345678',
    originHost: 'neonaidj005', targetHost: '100.107.182.2', configuredHost: 'neonaidj005',
    endpoint: 'music_tracks', result: 'http', status: 401, durationMs: 280,
    count: 0, total: 25959, token: 'secret', pin: 'secret',
    url: 'http://unit/api/music/tracks?search=private', error: 'Bearer secret',
    payload: { dancer: 'private' }, action: 'loadTracks?secret=bad',
  });
  assert.deepEqual(cleaned, {
    type: 'remote_request', view: 'desktop', clientId: 'client-12345678',
    originHost: 'neonaidj005', targetHost: '100.107.182.2', configuredHost: 'neonaidj005',
    endpoint: 'music_tracks', result: 'http', status: 401, durationMs: 280,
    count: 0, total: 25959,
  });
  assert.equal(sanitizeRemoteTelemetry({ type: 'arbitrary', token: 'secret' }), null);
  assert.equal(sanitizeRemoteTelemetry({ type: 'remote_request', originHost: 'x/path?token=secret' }).originHost, undefined);
});

test('remote diagnostic rate cap bounds a runaway browser', () => {
  const ip = 'test-rate-limit';
  assert.equal(allowRemoteTelemetry(ip, 240, 1000), true);
  assert.equal(allowRemoteTelemetry(ip, 1, 1001), false);
  assert.equal(allowRemoteTelemetry(ip, 1, 61_001), true);
});

test('stage comparison preserves only counts and status, not performer identities', () => {
  assert.deepEqual(sanitizeRemoteTelemetry({
    type: 'remote_stage_comparison', matches: false,
    boothIndex: 1, stageIndex: 0, rotationLength: 12, stageLength: 12,
    boothDancerId: 'private', stageDancerId: 'private',
  }), {
    type: 'remote_stage_comparison', matches: false,
    boothIndex: 1, stageIndex: 0, rotationLength: 12, stageLength: 12,
  });
});