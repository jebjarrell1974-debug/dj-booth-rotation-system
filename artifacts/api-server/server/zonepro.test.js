import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALIFICATION, ZoneProSafetyError, resolveProfile, validateConfiguration,
  additiveChecksum8, xorChecksum8, serializeQualifiedCommand,
  createPlan, makeConfirmation, executeTransaction, canManageZonePro,
  buildPrimaryStatus,
  normalizePrimarySettings,
  assertPrivateVenueHost,
} from './zonepro-core.js';

const verifiedProfile = {
  id: 'fixture-qualified-profile',
  firmware: 'fixture-1',
  writeAllowed: true,
};

test('unknown model and unverified 640m fail closed', () => {
  assert.throws(() => resolveProfile('not-a-zonepro', '1.0'), error => error.code === 'UNKNOWN_DEVICE');
  const profile = resolveProfile('dbx-zonepro-640m', 'unknown');
  assert.equal(profile.writeAllowed, false);
  assert.equal(profile.qualification, QUALIFICATION.UNVERIFIED);
});

test('volume safety bounds reject unsafe nested values', () => {
  assert.throws(() => validateConfiguration({ outputs: [{ volumeDb: 2 }] }, { minDb: -60, maxDb: -3 }),
    error => error.code === 'VOLUME_OUT_OF_BOUNDS');
  assert.throws(() => validateConfiguration({ outputs: [{ volume: 2 }] }, { minDb: -60, maxDb: -3 }),
    error => error.code === 'VOLUME_OUT_OF_BOUNDS');
  assert.deepEqual(validateConfiguration({ outputs: [{ volumeDb: -12 }] }, { minDb: -60, maxDb: -3 }),
    { outputs: [{ volumeDb: -12 }] });
});

test('authorization helper permits only master DJ sessions', () => {
  assert.equal(canManageZonePro({ role: 'dj', is_master: 1 }), true);
  assert.equal(canManageZonePro({ role: 'dj', is_master: 0 }), false);
  assert.equal(canManageZonePro({ role: 'dancer', is_master: 1 }), false);
});

test('primary status contract never exposes unconfirmed desired state', () => {
  const unit = { id: 'primary', name: 'Main', host: '10.0.0.4', port: 3804, model: 'dbx-zonepro-640m', firmware: null, minVolumeDb: -70, maxVolumeDb: -3 };
  const status = buildPrimaryStatus(unit, { connected: true, lastError: null }, null, {
    qualification: QUALIFICATION.UNVERIFIED, writeAllowed: false,
    capabilities: { configurationRead: false, configurationWrite: false }, limitation: 'Unverified',
  });
  assert.deepEqual(Object.keys(status).sort(), ['capabilities', 'configuration', 'device', 'health', 'identityConfirmed', 'lastError', 'primaryUnitId', 'qualification', 'revision', 'safetyLimits'].sort());
  assert.equal(status.health, 'reachable');
  assert.equal(status.identityConfirmed, false);
  assert.equal(status.configuration, null);
  assert.equal(status.revision, 0);
  assert.equal(status.qualification.writeQualified, false);
  const confirmed = buildPrimaryStatus(unit, {}, { id: 9, configuration: { outputs: [{ id: 1, volumeDb: -20 }] } }, {
    qualification: QUALIFICATION.VERIFIED, writeAllowed: true,
    capabilities: { configurationRead: true, configurationWrite: true },
  });
  assert.equal(confirmed.revision, 9);
  assert.deepEqual(confirmed.configuration, { outputs: [{ id: 1, volumeDb: -20 }] });
});

test('primary settings accepts frontend aliases and stores normalized fields', () => {
  assert.deepEqual(normalizePrimarySettings({ ip: '192.168.1.50', port: '3804', model: 'ZonePRO 640', autoConnect: 'true' }), {
    host: '192.168.1.50', port: 3804, connectTimeoutMs: 3000, commandTimeoutMs: 3000,
    model: 'dbx-zonepro-640m', firmware: null, name: 'Primary ZonePRO',
    minVolumeDb: -80, maxVolumeDb: 0, enabled: true,
  });
});

test('connection settings allow only private venue IPv4 addresses', () => {
  assert.equal(assertPrivateVenueHost('10.20.30.40'), '10.20.30.40');
  assert.equal(assertPrivateVenueHost('172.16.0.5'), '172.16.0.5');
  assert.equal(assertPrivateVenueHost('192.168.50.25'), '192.168.50.25');
  for (const host of ['127.0.0.1', '169.254.169.254', '8.8.8.8', 'example.com', '::1']) {
    assert.throws(() => assertPrivateVenueHost(host), error => error.code === 'HOST_NOT_ALLOWED');
  }
});

test('generic qualified command serializer and checksum fixtures are deterministic', () => {
  assert.equal(additiveChecksum8(Buffer.from([0x10, 0x20, 0xff])), 0x2f);
  assert.equal(xorChecksum8(Buffer.from([0x10, 0x20, 0xff])), 0xcf);
  const definition = {
    qualification: QUALIFICATION.VERIFIED,
    evidence: 'test fixture only; not a dbx protocol claim',
    prefixHex: 'aa01',
    suffixHex: '55',
    checksum: 'additive8',
  };
  assert.equal(serializeQualifiedCommand(definition, Buffer.from([0x02])).toString('hex'), 'aa01025502');
  assert.throws(() => serializeQualifiedCommand({ ...definition, qualification: QUALIFICATION.CAPTURED }),
    error => error.code === 'COMMAND_UNVERIFIED');
});

test('transaction verifies apply by readback', async () => {
  let state = { output: { volumeDb: -20 } };
  const plan = createPlan({
    id: 'plan-ok', unitId: 'u1', current: state, desired: { output: { volumeDb: -15 } },
    profile: verifiedProfile, bounds: { minDb: -60, maxDb: -3 },
  });
  const token = makeConfirmation(plan, 'secret');
  const events = [];
  const result = await executeTransaction({
    plan, token, secret: 'secret',
    adapter: { serialize: async operation => operation(), apply: async value => { state = structuredClone(value); }, read: async () => structuredClone(state) },
    audit: async event => events.push(event),
  });
  assert.equal(result.verified, true);
  assert.deepEqual(state, plan.desired);
  assert.deepEqual(events, ['zonepro.apply.started', 'zonepro.apply.verified']);
});

test('transaction rolls back after readback mismatch', async () => {
  let state = { output: { volumeDb: -20 } };
  let firstRead = true;
  const plan = createPlan({
    id: 'plan-rollback', unitId: 'u1', current: state, desired: { output: { volumeDb: -10 } },
    profile: verifiedProfile, bounds: { minDb: -60, maxDb: -3 },
  });
  await assert.rejects(executeTransaction({
    plan, token: makeConfirmation(plan, 'secret'), secret: 'secret',
    adapter: {
      serialize: async operation => operation(),
      apply: async value => { state = structuredClone(value); },
      read: async () => {
        if (firstRead) { firstRead = false; return { output: { volumeDb: -11 } }; }
        return structuredClone(state);
      },
    },
  }), error => error instanceof ZoneProSafetyError && error.code === 'APPLY_FAILED' && error.rollbackVerified === true);
  assert.deepEqual(state, plan.before);
});

test('transaction rejects missing confirmation before writing', async () => {
  const plan = createPlan({
    id: 'plan-auth', unitId: 'u1', current: {}, desired: {},
    profile: verifiedProfile, bounds: { minDb: -60, maxDb: -3 },
  });
  let writes = 0;
  await assert.rejects(executeTransaction({
    plan, token: 'bad', secret: 'secret',
    adapter: { serialize: async operation => operation(), apply: async () => { writes++; }, read: async () => ({}) },
  }), error => error.code === 'CONFIRMATION_REQUIRED');
  assert.equal(writes, 0);
});