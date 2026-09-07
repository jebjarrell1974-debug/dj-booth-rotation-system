import { createHash, timingSafeEqual, randomUUID } from 'crypto';
import { isIP } from 'net';

export const QUALIFICATION = Object.freeze({
  UNVERIFIED: 'unverified',
  CAPTURED: 'captured',
  VERIFIED: 'verified',
});

export const BUILTIN_PROFILES = Object.freeze({
  'dbx-zonepro-640m': Object.freeze({
    id: 'dbx-zonepro-640m',
    manufacturer: 'dbx',
    model: 'ZonePRO 640m',
    firmware: Object.freeze({ min: null, max: null }),
    qualification: QUALIFICATION.UNVERIFIED,
    qualificationEvidence: null,
    capabilities: Object.freeze({ identityRead: false, configurationRead: false, configurationWrite: false }),
    commands: Object.freeze({}),
    limitation: 'The Ethernet application protocol and firmware compatibility have not been verified from an authoritative public specification or qualified capture. TCP reachability is not device identity.',
  }),
});

export class ZoneProSafetyError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ZoneProSafetyError';
    this.code = code;
    this.status = status;
  }
}

export function resolveProfile(model, firmware, profiles = BUILTIN_PROFILES) {
  const normalized = String(model || '').trim().toLowerCase();
  const profile = Object.values(profiles).find(p =>
    [p.id, p.model].some(v => String(v).toLowerCase() === normalized));
  if (!profile) throw new ZoneProSafetyError('UNKNOWN_DEVICE', 'Unknown model; all writes are blocked', 409);
  if (profile.qualification !== QUALIFICATION.VERIFIED) {
    return { ...profile, firmware: String(firmware || ''), writeAllowed: false };
  }
  if (!firmware) throw new ZoneProSafetyError('UNKNOWN_FIRMWARE', 'Firmware must be identified before writes', 409);
  return { ...profile, firmware: String(firmware), writeAllowed: !!profile.capabilities.configurationWrite };
}

export function canManageZonePro(session) {
  return !!session && session.role === 'dj' && !!session.is_master;
}

// Pure contract formatter: configuration is supplied only from a confirmed
// readback snapshot by the route layer, never from requested/daily state.
export function buildPrimaryStatus(unit, connection = {}, snapshot = null, profile = {}) {
  const readQualified = !!profile.capabilities?.configurationRead && profile.qualification === QUALIFICATION.VERIFIED;
  const writeQualified = !!profile.writeAllowed && !!profile.capabilities?.configurationWrite;
  return {
    primaryUnitId: unit.id,
    health: connection.connected ? 'reachable' : 'unreachable',
    identityConfirmed: !!connection.identityConfirmed,
    device: { id: unit.id, name: unit.name, host: unit.host, port: unit.port, model: unit.model, firmware: unit.firmware },
    qualification: { readQualified, writeQualified, reason: writeQualified ? null : (profile.limitation || profile.error || 'Device/profile/firmware is not qualified for hardware writes') },
    capabilities: profile.capabilities || {},
    configuration: snapshot?.configuration || null,
    revision: snapshot?.id || 0,
    safetyLimits: { minVolumeDb: unit.minVolumeDb, maxVolumeDb: unit.maxVolumeDb },
    lastError: connection.lastError || null,
  };
}

export function assertPrivateVenueHost(host) {
  const value = String(host || '').trim();
  if (isIP(value) !== 4) {
    throw new ZoneProSafetyError('HOST_NOT_ALLOWED', 'ZonePRO host must be a private IPv4 address on the venue LAN');
  }
  const [first, second] = value.split('.').map(Number);
  const privateAddress = first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
  if (!privateAddress) {
    throw new ZoneProSafetyError('HOST_NOT_ALLOWED', 'Only private venue-LAN IPv4 addresses are allowed');
  }
  return value;
}

export function validateConnectionSettings(input) {
  const host = assertPrivateVenueHost(input?.host);
  const port = Number(input?.port);
  const connectTimeoutMs = Number(input?.connectTimeoutMs ?? 3000);
  const commandTimeoutMs = Number(input?.commandTimeoutMs ?? 3000);
  if (!host || host.length > 253 || /[\s/?#]/.test(host)) throw new ZoneProSafetyError('INVALID_HOST', 'A valid hostname or IP address is required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ZoneProSafetyError('INVALID_PORT', 'Port must be an integer from 1 to 65535');
  for (const [name, value] of Object.entries({ connectTimeoutMs, commandTimeoutMs })) {
    if (!Number.isInteger(value) || value < 250 || value > 30000) throw new ZoneProSafetyError('INVALID_TIMEOUT', `${name} must be 250-30000 ms`);
  }
  return { host, port, connectTimeoutMs, commandTimeoutMs };
}

export function normalizePrimarySettings(body = {}) {
  const connection = validateConnectionSettings({ ...body, host: body.host ?? body.ip, port: body.port ?? 3804 });
  const label = String(body.model || 'dbx-zonepro-640m').trim();
  const model = /^zonepro\s*640m?$/i.test(label) ? 'dbx-zonepro-640m' : label;
  const minVolumeDb = Number(body.minVolumeDb ?? -80);
  const maxVolumeDb = Number(body.maxVolumeDb ?? 0);
  validateConfiguration({}, { minDb: minVolumeDb, maxDb: maxVolumeDb });
  return {
    ...connection, model, firmware: body.firmware ? String(body.firmware).trim() : null,
    name: String(body.name || 'Primary ZonePRO').trim() || 'Primary ZonePRO',
    minVolumeDb, maxVolumeDb, enabled: body.enabled ?? (body.autoConnect === true || body.autoConnect === 'true'),
  };
}

export function validateConfiguration(config, bounds = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new ZoneProSafetyError('INVALID_CONFIG', 'Configuration must be an object');
  const minDb = Number(bounds.minDb ?? -80);
  const maxDb = Number(bounds.maxDb ?? 0);
  if (!Number.isFinite(minDb) || !Number.isFinite(maxDb) || minDb >= maxDb || minDb < -120 || maxDb > 12) {
    throw new ZoneProSafetyError('INVALID_BOUNDS', 'Safety volume bounds are invalid');
  }
  const copy = structuredClone(config);
  const visit = (value, path = '') => {
    if (Array.isArray(value)) return value.forEach((v, i) => visit(v, `${path}[${i}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (/(volume|gain|level|threshold)(Db)?$/i.test(key) || /Db$/.test(key)) {
        if (!Number.isFinite(child) || child < minDb || child > maxDb) {
          throw new ZoneProSafetyError('VOLUME_OUT_OF_BOUNDS', `${childPath} must be between ${minDb} and ${maxDb} dB`);
        }
      }
      visit(child, childPath);
    }
  };
  visit(copy);
  return copy;
}

export function additiveChecksum8(bytes) {
  return Buffer.from(bytes).reduce((sum, byte) => (sum + byte) & 0xff, 0);
}

export function xorChecksum8(bytes) {
  return Buffer.from(bytes).reduce((sum, byte) => sum ^ byte, 0);
}

// This serializes only an explicitly supplied, qualified command definition.
// It deliberately contains no dbx packet constants or guessed framing.
export function serializeQualifiedCommand(definition, payload = Buffer.alloc(0)) {
  if (!definition || definition.qualification !== QUALIFICATION.VERIFIED || !definition.evidence) {
    throw new ZoneProSafetyError('COMMAND_UNVERIFIED', 'Command definition is not verified', 409);
  }
  const prefix = Buffer.from(definition.prefixHex || '', 'hex');
  const suffix = Buffer.from(definition.suffixHex || '', 'hex');
  if ((definition.prefixHex && prefix.length * 2 !== definition.prefixHex.length) ||
      (definition.suffixHex && suffix.length * 2 !== definition.suffixHex.length)) {
    throw new ZoneProSafetyError('INVALID_COMMAND_DEFINITION', 'Command hex is invalid');
  }
  let frame = Buffer.concat([prefix, Buffer.from(payload), suffix]);
  if (definition.checksum === 'additive8') frame = Buffer.concat([frame, Buffer.from([additiveChecksum8(frame)])]);
  else if (definition.checksum === 'xor8') frame = Buffer.concat([frame, Buffer.from([xorChecksum8(frame)])]);
  else if (definition.checksum && definition.checksum !== 'none') throw new ZoneProSafetyError('UNKNOWN_CHECKSUM', 'Checksum algorithm is not supported');
  return frame;
}

export function makeConfirmation(plan, secret) {
  return createHash('sha256').update(`${secret}:${plan.id}:${plan.digest}`).digest('hex');
}

export function verifyConfirmation(plan, secret, token) {
  const expected = Buffer.from(makeConfirmation(plan, secret));
  const actual = Buffer.from(String(token || ''));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createPlan({ unitId, current, desired, profile, bounds, id = randomUUID() }) {
  if (!profile?.writeAllowed) throw new ZoneProSafetyError('WRITES_BLOCKED', 'Profile/model/firmware is not verified for writes', 409);
  const safeDesired = validateConfiguration(desired, bounds);
  const before = structuredClone(current);
  const digest = createHash('sha256').update(JSON.stringify({ unitId, before, desired: safeDesired, profile: profile.id, firmware: profile.firmware })).digest('hex');
  return Object.freeze({ id, unitId, profileId: profile.id, firmware: profile.firmware, before, desired: safeDesired, digest, createdAt: new Date().toISOString() });
}

export async function executeTransaction({ plan, token, secret, adapter, saveSnapshot = async () => {}, audit = async () => {} }) {
  if (!verifyConfirmation(plan, secret, token)) throw new ZoneProSafetyError('CONFIRMATION_REQUIRED', 'A valid plan confirmation is required', 409);
  if (typeof adapter?.serialize !== 'function') {
    throw new ZoneProSafetyError('ADAPTER_NOT_SERIALIZED', 'Hardware adapter must serialize the complete write/readback/rollback transaction', 409);
  }
  return adapter.serialize(async () => {
    await saveSnapshot(plan.unitId, 'before-write', plan.before);
    await audit('zonepro.apply.started', { planId: plan.id, unitId: plan.unitId });
    try {
      await adapter.apply(plan.desired);
      const readback = await adapter.read();
      if (JSON.stringify(readback) !== JSON.stringify(plan.desired)) throw new ZoneProSafetyError('READBACK_MISMATCH', 'Readback did not match requested configuration', 502);
      await saveSnapshot(plan.unitId, 'verified', readback);
      await audit('zonepro.apply.verified', { planId: plan.id, unitId: plan.unitId });
      return { ok: true, verified: true, readback };
    } catch (error) {
      let rollbackVerified = false;
      let rollbackError = null;
      try {
        await adapter.apply(plan.before);
        const restored = await adapter.read();
        rollbackVerified = JSON.stringify(restored) === JSON.stringify(plan.before);
        if (!rollbackVerified) rollbackError = 'Rollback readback mismatch';
      } catch (rollback) {
        rollbackError = rollback.message;
      }
      await audit('zonepro.apply.failed', { planId: plan.id, unitId: plan.unitId, error: error.message, rollbackVerified, rollbackError });
      const failure = new ZoneProSafetyError('APPLY_FAILED', 'Apply failed; rollback was attempted and must be inspected', 502);
      failure.cause = error;
      failure.rollbackVerified = rollbackVerified;
      failure.rollbackError = rollbackError;
      throw failure;
    }
  });
}