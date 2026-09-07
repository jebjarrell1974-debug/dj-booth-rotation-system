import express from 'express';
import { randomBytes } from 'crypto';
import {
  BUILTIN_PROFILES, ZoneProSafetyError, resolveProfile,
  validateConnectionSettings, validateConfiguration, createPlan, makeConfirmation, verifyConfirmation, buildPrimaryStatus, normalizePrimarySettings,
} from './zonepro-core.js';
import {
  listZoneProUnits, getZoneProUnit, saveZoneProUnit, saveZoneProSnapshot,
  getZoneProSnapshot, listZoneProSnapshots, getLatestConfirmedZoneProSnapshot, saveZoneProPlan, getPendingZoneProPlan, consumeZoneProPlan, findPendingZoneProPlan,
} from './zonepro-store.js';
import { testTcpConnection, discoverCandidates, getTransportHealth } from './zonepro-transport.js';

const confirmationSecret = randomBytes(32).toString('hex');

function errorResponse(res, error) {
  const status = error instanceof ZoneProSafetyError ? error.status : 502;
  res.status(status).json({ ok: false, code: error.code || 'HARDWARE_UNAVAILABLE', error: error.message });
}

function publicUnit(unit) {
  if (!unit) return null;
  let profile;
  try { profile = resolveProfile(unit.model, unit.firmware); }
  catch (error) { profile = { id: null, qualification: 'unknown', writeAllowed: false, error: error.message }; }
  return { ...unit, profile, health: getTransportHealth(unit.id) };
}

function primaryUnit() {
  const units = listZoneProUnits();
  return units.find(unit => unit.id === 'primary') || units.find(unit => unit.enabled) || units[0] || null;
}

function normalizedStatus(unit) {
  if (!unit) {
    return {
      primaryUnitId: null, health: 'unreachable', identityConfirmed: false, device: null,
      qualification: { readQualified: false, writeQualified: false, reason: 'No primary ZonePRO unit is configured' },
      capabilities: {}, configuration: null, revision: 0,
      safetyLimits: { minVolumeDb: -80, maxVolumeDb: 0 }, lastError: null,
    };
  }
  let profile;
  try { profile = resolveProfile(unit.model, unit.firmware); }
  catch (error) { profile = { id: null, qualification: 'unknown', capabilities: {}, writeAllowed: false, limitation: error.message }; }
  const connection = getTransportHealth(unit.id);
  const snapshot = getLatestConfirmedZoneProSnapshot(unit.id);
  return buildPrimaryStatus(unit, connection, snapshot, profile);
}

export function createZoneProRouter({ authenticate, requireDJ, requireMaster, audit }) {
  const router = express.Router();
  const dj = [authenticate, requireDJ];
  const master = [authenticate, requireDJ, requireMaster];

  router.get('/status', ...dj, (_req, res) => {
    const primary = primaryUnit();
    res.json({
      units: listZoneProUnits().map(publicUnit),
      ...normalizedStatus(primary),
      protocol: {
        qualification: 'unverified',
        writesEnabled: false,
        limitation: BUILTIN_PROFILES['dbx-zonepro-640m'].limitation,
      },
    });
  });

  router.get('/profiles', ...dj, (_req, res) => res.json(Object.values(BUILTIN_PROFILES)));

  // Single-venue compatibility contract used by the booth client. `ip` and
  // `autoConnect` are accepted aliases; storage remains normalized.
  router.get('/settings', ...dj, (_req, res) => {
    const unit = primaryUnit();
    if (!unit) return res.json({ ip: '', host: '', port: 3804, model: 'dbx-zonepro-640m', firmware: null, autoConnect: false, enabled: false, name: 'Primary ZonePRO', connectTimeoutMs: 3000, commandTimeoutMs: 3000, minVolumeDb: -80, maxVolumeDb: 0 });
    res.json({ ...unit, ip: unit.host, autoConnect: unit.enabled });
  });

  router.post('/settings', ...master, (req, res) => {
    try {
      const unit = saveZoneProUnit({ ...primaryUnit(), id: primaryUnit()?.id || 'primary', ...normalizePrimarySettings(req.body) });
      audit(req, 'zonepro.primary.settings.saved', JSON.stringify({ unitId: unit.id, host: unit.host, port: unit.port, model: unit.model }));
      res.json({ ...unit, ip: unit.host, autoConnect: unit.enabled });
    } catch (error) { errorResponse(res, error); }
  });

  router.put('/units/:id', ...master, (req, res) => {
    try {
      const connection = validateConnectionSettings(req.body);
      const minVolumeDb = Number(req.body.minVolumeDb ?? -80);
      const maxVolumeDb = Number(req.body.maxVolumeDb ?? 0);
      validateConfiguration({}, { minDb: minVolumeDb, maxDb: maxVolumeDb });
      const model = String(req.body.model || '').trim();
      if (!model) throw new ZoneProSafetyError('MODEL_REQUIRED', 'Model is required');
      // Unknown devices may be saved for diagnosis but are always fail-closed.
      const unit = saveZoneProUnit({
        id: req.params.id, name: String(req.body.name || '').trim() || req.params.id,
        ...connection, model, firmware: req.body.firmware ? String(req.body.firmware).trim() : null,
        minVolumeDb, maxVolumeDb, enabled: req.body.enabled === true,
        dailyControls: req.body.dailyControls || {},
      });
      audit(req, 'zonepro.unit.saved', JSON.stringify({ unitId: unit.id, host: unit.host, port: unit.port, model: unit.model }));
      res.json(publicUnit(unit));
    } catch (error) { errorResponse(res, error); }
  });

  router.post('/discover', ...master, async (req, res) => {
    try {
      const saved = listZoneProUnits();
      const requested = req.body?.candidates;
      const results = requested === undefined
        ? await Promise.all(saved.map(async unit => {
          try { return { host: unit.host, port: unit.port, ...(await testTcpConnection(unit)) }; }
          catch (error) { return { host: unit.host, port: unit.port, reachable: false, identityConfirmed: false, error: error.message }; }
        }))
        : await (() => {
          const port = Number(req.body.port);
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ZoneProSafetyError('INVALID_PORT', 'Valid port required');
          return discoverCandidates(requested, port, Number(req.body.timeoutMs || 1000));
        })();
      audit(req, 'zonepro.discovery', JSON.stringify({ candidates: results.length, reachable: results.filter(r => r.reachable).length }));
      res.json({ results, devices: results, identityConfirmed: false });
    } catch (error) { errorResponse(res, error); }
  });

  router.post('/units/:id/test', ...dj, async (req, res) => {
    const unit = getZoneProUnit(req.params.id);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });
    try {
      const result = await testTcpConnection(unit);
      audit(req, 'zonepro.connection.test', JSON.stringify({ unitId: unit.id, reachable: true }));
      res.json(result);
    } catch (error) {
      audit(req, 'zonepro.connection.test', JSON.stringify({ unitId: unit.id, reachable: false, error: error.message }));
      errorResponse(res, error);
    }
  });

  router.post('/units/:id/read', ...dj, async (req, res) => {
    const unit = getZoneProUnit(req.params.id);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });
    try {
      const profile = resolveProfile(unit.model, unit.firmware);
      if (!profile.capabilities.configurationRead) throw new ZoneProSafetyError('READ_UNSUPPORTED', 'No verified configuration read command exists for this profile', 409);
      throw new ZoneProSafetyError('ADAPTER_UNAVAILABLE', 'Qualified adapter is not installed', 503);
    } catch (error) { errorResponse(res, error); }
  });

  router.post('/units/:id/apply/plan', ...master, async (req, res) => {
    const unit = getZoneProUnit(req.params.id);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });
    try {
      const profile = resolveProfile(unit.model, unit.firmware);
      if (!profile.capabilities.configurationRead) throw new ZoneProSafetyError('READ_REQUIRED', 'Apply is blocked because a before-write readback cannot be performed', 409);
      const confirmed = getLatestConfirmedZoneProSnapshot(unit.id);
      if (!confirmed) throw new ZoneProSafetyError('READ_REQUIRED', 'A confirmed hardware readback is required before planning', 409);
      if (req.body.expectedRevision !== undefined && Number(req.body.expectedRevision) !== confirmed.id) {
        throw new ZoneProSafetyError('REVISION_CONFLICT', 'Configuration changed; read again before planning', 409);
      }
      const plan = createPlan({
        unitId: unit.id, current: confirmed.configuration, desired: req.body.configuration,
        profile, bounds: { minDb: unit.minVolumeDb, maxDb: unit.maxVolumeDb },
      });
      saveZoneProPlan(plan);
      const confirmationToken = makeConfirmation(plan, confirmationSecret);
      audit(req, 'zonepro.apply.planned', JSON.stringify({ unitId: unit.id, planId: plan.id, digest: plan.digest }));
      res.json({ planId: plan.id, confirmationToken, plan, diffs: [], warnings: [], expiresInMs: 300000 });
    } catch (error) { errorResponse(res, error); }
  });

  router.post('/units/:id/apply', ...master, async (req, res) => {
    const candidate = req.body.planId
      ? null
      : findPendingZoneProPlan(req.params.id, plan =>
        JSON.stringify(plan.desired) === JSON.stringify(req.body.configuration) &&
        verifyConfirmation(plan, confirmationSecret, req.body.confirmation ?? req.body.confirmationToken));
    const planId = String(req.body.planId || candidate?.id || '');
    const pending = getPendingZoneProPlan(planId);
    if (!pending || pending.unitId !== req.params.id) return errorResponse(res, new ZoneProSafetyError('PLAN_INVALID', 'Plan is missing, expired, already used, or belongs to another unit', 409));
    if (!verifyConfirmation(pending, confirmationSecret, req.body.confirmation ?? req.body.confirmationToken)) {
      audit(req, 'zonepro.apply.blocked', JSON.stringify({ unitId: req.params.id, planId: pending.id, reason: 'invalid_confirmation' }));
      return errorResponse(res, new ZoneProSafetyError('CONFIRMATION_REQUIRED', 'Valid plan confirmation required; no command was sent', 409));
    }
    const plan = consumeZoneProPlan(planId);
    if (!plan) return errorResponse(res, new ZoneProSafetyError('PLAN_INVALID', 'Plan was already consumed', 409));
    // A plan can only exist once a verified adapter profile is installed. Never claim
    // success without write acknowledgement and exact readback.
    audit(req, 'zonepro.apply.blocked', JSON.stringify({ unitId: req.params.id, planId: plan.id, reason: 'qualified_adapter_unavailable' }));
    return errorResponse(res, new ZoneProSafetyError('ADAPTER_UNAVAILABLE', 'Qualified write/readback adapter is not installed; no command was sent', 503));
  });

  router.get('/units/:id/snapshots', ...dj, (req, res) => {
    if (!getZoneProUnit(req.params.id)) return res.status(404).json({ error: 'Unit not found' });
    res.json(listZoneProSnapshots(req.params.id, Math.min(500, Math.max(1, Number(req.query.limit) || 100))));
  });

  router.post('/units/:id/snapshots', ...master, (req, res) => {
    const unit = getZoneProUnit(req.params.id);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });
    try {
      const configuration = validateConfiguration(req.body.configuration, { minDb: unit.minVolumeDb, maxDb: unit.maxVolumeDb });
      const snapshot = saveZoneProSnapshot(unit.id, 'imported-unverified', configuration);
      audit(req, 'zonepro.snapshot.imported', JSON.stringify({ unitId: unit.id, snapshotId: snapshot.id }));
      res.json(snapshot);
    } catch (error) { errorResponse(res, error); }
  });

  router.post('/units/:id/restore/:snapshotId', ...master, (req, res) => {
    const unit = getZoneProUnit(req.params.id);
    const snapshot = getZoneProSnapshot(Number(req.params.snapshotId));
    if (!unit || !snapshot || snapshot.unitId !== unit.id) return res.status(404).json({ error: 'Unit or snapshot not found' });
    const pending = req.body.planId ? getPendingZoneProPlan(String(req.body.planId)) : null;
    if (!pending || pending.unitId !== unit.id || JSON.stringify(pending.desired) !== JSON.stringify(snapshot.configuration) ||
      !verifyConfirmation(pending, confirmationSecret, req.body.confirmation ?? req.body.confirmationToken)) {
      return errorResponse(res, new ZoneProSafetyError('PLAN_INVALID', 'Restore requires a matching server-issued plan and confirmation token; no command was sent', 409));
    }
    if (!consumeZoneProPlan(String(req.body.planId))) return errorResponse(res, new ZoneProSafetyError('PLAN_INVALID', 'Plan was already consumed', 409));
    return errorResponse(res, new ZoneProSafetyError('RESTORE_BLOCKED', 'Restore requires a verified profile, before-write read, confirmation, write acknowledgement, and readback; no command was sent', 409));
  });

  router.put('/units/:id/daily-controls', ...master, (req, res) => {
    const unit = getZoneProUnit(req.params.id);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });
    try {
      const dailyControls = validateConfiguration(req.body, { minDb: unit.minVolumeDb, maxDb: unit.maxVolumeDb });
      // Daily controls are hardware writes, not desired-state preferences. Do
      // not persist or acknowledge them until a qualified adapter confirms readback.
      throw new ZoneProSafetyError('WRITES_BLOCKED', 'Daily control is blocked: no verified write/readback adapter is installed', 409);
    } catch (error) { errorResponse(res, error); }
  });

  router.post('/test', ...dj, async (req, res) => {
    const unit = primaryUnit();
    if (!unit) return errorResponse(res, new ZoneProSafetyError('PRIMARY_NOT_CONFIGURED', 'No primary ZonePRO unit is configured', 404));
    try { res.json(await testTcpConnection(unit)); } catch (error) { errorResponse(res, error); }
  });

  router.post('/read', ...dj, (req, res) => {
    const unit = primaryUnit();
    if (!unit) return errorResponse(res, new ZoneProSafetyError('PRIMARY_NOT_CONFIGURED', 'No primary ZonePRO unit is configured', 404));
    try {
      const profile = resolveProfile(unit.model, unit.firmware);
      if (!profile.capabilities.configurationRead) throw new ZoneProSafetyError('READ_UNSUPPORTED', 'No verified configuration read command exists for this profile', 409);
      throw new ZoneProSafetyError('ADAPTER_UNAVAILABLE', 'Qualified adapter is not installed', 503);
    } catch (error) { errorResponse(res, error); }
  });

  router.post('/plan', ...master, (req, res) => {
    const unit = primaryUnit();
    if (!unit) return errorResponse(res, new ZoneProSafetyError('PRIMARY_NOT_CONFIGURED', 'No primary ZonePRO unit is configured', 404));
    try {
      const profile = resolveProfile(unit.model, unit.firmware);
      if (!profile.capabilities.configurationRead || !profile.writeAllowed) throw new ZoneProSafetyError('WRITES_BLOCKED', 'Plan is blocked until this device profile has verified read/write support', 409);
      const confirmed = getLatestConfirmedZoneProSnapshot(unit.id);
      if (!confirmed) throw new ZoneProSafetyError('READ_REQUIRED', 'A confirmed hardware readback is required before planning', 409);
      if (req.body.expectedRevision !== undefined && Number(req.body.expectedRevision) !== confirmed.id) throw new ZoneProSafetyError('REVISION_CONFLICT', 'Configuration changed; read again before planning', 409);
      const plan = createPlan({ unitId: unit.id, current: confirmed.configuration, desired: req.body.configuration, profile, bounds: { minDb: unit.minVolumeDb, maxDb: unit.maxVolumeDb } });
      saveZoneProPlan(plan);
      const confirmationToken = makeConfirmation(plan, confirmationSecret);
      audit(req, 'zonepro.apply.planned', JSON.stringify({ unitId: unit.id, planId: plan.id }));
      res.json({ planId: plan.id, confirmationToken, plan, diffs: [], warnings: [], revision: confirmed.id, expiresInMs: 300000 });
    } catch (error) { errorResponse(res, error); }
  });

  router.post('/apply', ...master, (req, res) => {
    const unit = primaryUnit();
    if (!unit) return errorResponse(res, new ZoneProSafetyError('PRIMARY_NOT_CONFIGURED', 'No primary ZonePRO unit is configured', 404));
    // Re-enter through the same fail-closed logic as the retained per-unit route.
    req.params.id = unit.id;
    const confirmation = req.body.confirmationToken ?? req.body.confirmation;
    const candidate = req.body.planId ? null : findPendingZoneProPlan(unit.id, plan => JSON.stringify(plan.desired) === JSON.stringify(req.body.configuration) && verifyConfirmation(plan, confirmationSecret, confirmation));
    const planId = String(req.body.planId || candidate?.id || '');
    const pending = getPendingZoneProPlan(planId);
    if (!pending || !verifyConfirmation(pending, confirmationSecret, confirmation)) return errorResponse(res, new ZoneProSafetyError('PLAN_INVALID', 'A matching, unexpired confirmed plan is required', 409));
    const plan = consumeZoneProPlan(planId);
    if (!plan) return errorResponse(res, new ZoneProSafetyError('PLAN_INVALID', 'Plan was already consumed', 409));
    audit(req, 'zonepro.apply.blocked', JSON.stringify({ unitId: unit.id, planId: plan.id, reason: 'qualified_adapter_unavailable' }));
    return errorResponse(res, new ZoneProSafetyError('WRITES_BLOCKED', 'No verified write/readback adapter is installed; no command was sent', 409));
  });

  router.get('/snapshots', ...dj, (_req, res) => {
    const unit = primaryUnit();
    if (!unit) return res.json({ snapshots: [] });
    res.json({ snapshots: listZoneProSnapshots(unit.id) });
  });
  router.post('/snapshots/import', ...master, (req, res) => {
    const unit = primaryUnit();
    if (!unit) return errorResponse(res, new ZoneProSafetyError('PRIMARY_NOT_CONFIGURED', 'No primary ZonePRO unit is configured', 404));
    try {
      const snapshot = saveZoneProSnapshot(unit.id, 'imported-unverified', validateConfiguration(req.body.configuration, { minDb: unit.minVolumeDb, maxDb: unit.maxVolumeDb }));
      res.json({ snapshot });
    } catch (error) { errorResponse(res, error); }
  });
  router.post('/snapshots/:id/restore', ...master, (req, res) => {
    const unit = primaryUnit();
    const snapshot = getZoneProSnapshot(Number(req.params.id));
    if (!unit || !snapshot || snapshot.unitId !== unit.id) return errorResponse(res, new ZoneProSafetyError('PRIMARY_NOT_CONFIGURED', 'Primary unit or snapshot not found', 404));
    const plan = req.body.planId ? getPendingZoneProPlan(String(req.body.planId)) : null;
    const confirmation = req.body.confirmationToken ?? req.body.confirmation;
    if (!plan || JSON.stringify(plan.desired) !== JSON.stringify(snapshot.configuration) || !verifyConfirmation(plan, confirmationSecret, confirmation)) {
      return errorResponse(res, new ZoneProSafetyError('PLAN_INVALID', 'Restore requires a matching server-issued plan and confirmation token; no command was sent', 409));
    }
    if (!consumeZoneProPlan(String(req.body.planId))) return errorResponse(res, new ZoneProSafetyError('PLAN_INVALID', 'Plan was already consumed', 409));
    return errorResponse(res, new ZoneProSafetyError('WRITES_BLOCKED', 'Restore remains blocked until a verified read/write adapter is installed; no command was sent', 409));
  });
  router.post('/control', ...master, (req, res) => {
    const unit = primaryUnit();
    if (!unit) return errorResponse(res, new ZoneProSafetyError('PRIMARY_NOT_CONFIGURED', 'No primary ZonePRO unit is configured', 404));
    return errorResponse(res, new ZoneProSafetyError('WRITES_BLOCKED', 'Live control is blocked: no verified write/readback adapter is installed; no command was sent', 409));
  });

  return router;
}