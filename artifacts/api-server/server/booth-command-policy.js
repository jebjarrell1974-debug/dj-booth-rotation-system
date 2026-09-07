export const NORMAL_REMOTE_COMMANDS = new Set([
  'skip', 'startRotation', 'stopRotation', 'toggleAnnouncements', 'setSongsPerSet',
  'updateRotation', 'removeDancerFromRotation', 'addDancerToRotation', 'setVolume',
  'setVoiceGain', 'setCommercialFreq', 'setBreakSongsPerSet', 'moveInRotation',
  'saveRotation', 'updateInterstitialSongs', 'skipCommercial', 'swapPromo',
  'playSound', 'sendToVip', 'releaseFromVip', 'updateSongAssignments',
  'playHouseAnnouncement',
]);

const STRUCTURAL_COMMANDS = new Set([
  'updateRotation', 'removeDancerFromRotation', 'addDancerToRotation',
  'moveInRotation', 'saveRotation', 'updateSongAssignments',
]);

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = value => (Number.isInteger(value) && value >= 0) ||
  (typeof value === 'string' && value.trim().length > 0 && value.length <= 128);
const isFiniteNumber = (value, min, max) => typeof value === 'number' &&
  Number.isFinite(value) && value >= min && value <= max;
const isString = (value, max = 512) => typeof value === 'string' && value.length > 0 && value.length <= max;
const isIdArray = value => Array.isArray(value) && value.length <= 500 && value.every(isId);
const isStringArray = value => Array.isArray(value) && value.length <= 50 && value.every(item => isString(item, 512));

function invalid(error) {
  return { ok: false, error };
}

export function isStructuralCommand(action) {
  return STRUCTURAL_COMMANDS.has(action);
}

export function isPhysicalKioskAddress(address, selfIps) {
  const normalized = String(address || '').replace(/^::ffff:/, '');
  return normalized.length > 0 && selfIps.has(normalized);
}

// Validate only data the kiosk's command executor understands.  Keeping this
// policy independent makes it cheap to test without booting the API server.
export function validateBoothCommand(action, payload = {}) {
  if (!NORMAL_REMOTE_COMMANDS.has(action)) return invalid('Unknown or disallowed command action');
  if (!isPlainObject(payload)) return invalid('Command payload must be an object');
  // The JSON parser has a broader transport limit; command payloads are small
  // control messages and should never carry arbitrary large object graphs.
  if (JSON.stringify(payload).length > 100 * 1024) return invalid('Command payload is too large');

  switch (action) {
    case 'setVolume':
      if (!isFiniteNumber(payload.volume, 0, 1)) return invalid('volume must be a number from 0 to 1');
      break;
    case 'setVoiceGain':
      if (!isFiniteNumber(payload.gain, 0.5, 1.2)) return invalid('gain must be a number from 0.5 to 1.2');
      break;
    case 'setSongsPerSet':
      if (!Number.isInteger(payload.count) || payload.count < 1 || payload.count > 20) return invalid('count must be an integer from 1 to 20');
      if (payload.source != null && !isString(payload.source, 128)) return invalid('source must be a short string');
      break;
    case 'setBreakSongsPerSet':
      if (!Number.isInteger(payload.count) || payload.count < 0 || payload.count > 3) return invalid('count must be an integer from 0 to 3');
      break;
    case 'updateRotation':
    case 'saveRotation':
      if (!isIdArray(payload.rotation)) return invalid('rotation must be an array of dancer IDs');
      break;
    case 'addDancerToRotation':
    case 'removeDancerFromRotation':
    case 'releaseFromVip':
      if (!isId(payload.dancerId)) return invalid('dancerId is required');
      if (payload.onlyIfVip != null && typeof payload.onlyIfVip !== 'boolean') return invalid('onlyIfVip must be boolean');
      break;
    case 'moveInRotation':
      if (!isId(payload.dancerId) || !['up', 'down'].includes(payload.direction)) return invalid('dancerId and direction (up/down) are required');
      break;
    case 'sendToVip':
      if (!isId(payload.dancerId) || !isFiniteNumber(payload.durationMs, 1, 24 * 60 * 60 * 1000)) return invalid('dancerId and a VIP duration up to 24 hours are required');
      if (payload.skipIfActive != null && typeof payload.skipIfActive !== 'boolean') return invalid('skipIfActive must be boolean');
      break;
    case 'updateInterstitialSongs':
      if (!isPlainObject(payload.interstitialSongs) || Object.keys(payload.interstitialSongs).length > 100) return invalid('interstitialSongs must be an object');
      break;
    case 'updateSongAssignments':
      if (!isPlainObject(payload.assignments) || Object.keys(payload.assignments).length > 500 ||
          !Object.entries(payload.assignments).every(([id, songs]) => isId(id) && isStringArray(songs))) return invalid('assignments must map dancer IDs to song-name arrays');
      break;
    case 'setCommercialFreq':
      if (!['off', '1', '2', '3'].includes(String(payload.freq))) return invalid('freq must be off, 1, 2, or 3');
      break;
    case 'skipCommercial':
      if (!(isId(payload.commercialId))) return invalid('commercialId is required');
      break;
    case 'swapPromo':
      if (!Number.isInteger(payload.slotIndex) || payload.slotIndex < 0 || payload.slotIndex > 100) return invalid('slotIndex must be an integer from 0 to 100');
      break;
    case 'playSound':
      if (!isString(payload.soundId, 256) || (payload.gain != null && !isFiniteNumber(payload.gain, 0, 5))) return invalid('soundId and optional gain (0 to 5) are required');
      break;
    case 'playHouseAnnouncement':
      if (!isString(payload.cacheKey, 512)) return invalid('cacheKey is required');
      break;
  }
  return { ok: true, payload };
}

export function nextStateRevisions(previous, incoming) {
  const structuralChanged = JSON.stringify(previous.rotation ?? []) !== JSON.stringify(incoming.rotation ?? []) ||
    JSON.stringify(previous.rotationSongs ?? {}) !== JSON.stringify(incoming.rotationSongs ?? {}) ||
    JSON.stringify(previous.interstitialSongs ?? {}) !== JSON.stringify(incoming.interstitialSongs ?? {}) ||
    JSON.stringify(previous.dancerVipMap ?? {}) !== JSON.stringify(incoming.dancerVipMap ?? {});
  return {
    stateVersion: (previous.stateVersion ?? 0) + 1,
    rotationVersion: (previous.rotationVersion ?? 0) + (structuralChanged ? 1 : 0),
  };
}

export function normalizeBoothState(previous, state, now = Date.now()) {
  const revisions = nextStateRevisions(previous, state);
  return {
    isRotationActive: !!state.isRotationActive,
    currentDancerIndex: state.currentDancerIndex ?? 0,
    currentDancerName: state.currentDancerName ?? null,
    currentTrack: state.currentTrack ?? null,
    currentSongNumber: state.currentSongNumber ?? 0,
    songsPerSet: state.songsPerSet ?? 3,
    isPlaying: !!state.isPlaying,
    rotation: state.rotation ?? [],
    announcementsEnabled: state.announcementsEnabled !== false,
    skipLocked: !!state.skipLocked,
    rotationSongs: state.rotationSongs ?? {},
    volume: state.volume ?? 0.8,
    voiceGain: state.voiceGain ?? 1.5,
    trackTime: state.trackTime ?? 0,
    trackDuration: state.trackDuration ?? 0,
    trackTimeAt: state.trackTimeAt ?? 0,
    breakSongsPerSet: state.breakSongsPerSet ?? 0,
    breakSongIndex: state.breakSongIndex ?? null,
    interstitialSongs: state.interstitialSongs ?? {},
    commercialFreq: state.commercialFreq ?? 'off',
    commercialCounter: state.commercialCounter ?? 0,
    promoQueue: state.promoQueue ?? [],
    availablePromos: state.availablePromos ?? [],
    skippedCommercials: state.skippedCommercials ?? [],
    dancerVipMap: state.dancerVipMap ?? {},
    updatedAt: now,
    diagLog: state.diagLog ?? [],
    prePickHits: state.prePickHits ?? 0,
    prePickMisses: state.prePickMisses ?? 0,
    lastTransitionMs: state.lastTransitionMs ?? null,
    lastWatchdogAt: state.lastWatchdogAt ?? null,
    lastWatchdogSilentMs: state.lastWatchdogSilentMs ?? null,
    lastWatchdogDancer: state.lastWatchdogDancer ?? null,
    lastWatchdogTrack: state.lastWatchdogTrack ?? null,
    ...revisions,
  };
}

export class BoothCommandQueue {
  constructor({ maxSize = 50, dedupeTtlMs = 5 * 60 * 1000 } = {}) {
    this.maxSize = maxSize;
    this.dedupeTtlMs = dedupeTtlMs;
    this.commands = [];
    this.requestIds = new Map();
    this.nextId = 0;
  }

  prune(now = Date.now()) {
    this.commands = this.commands.filter(command => command.expiresAt > now && command.status === 'pending');
    for (const [key, value] of this.requestIds) {
      if (value.expiresAt <= now) this.requestIds.delete(key);
    }
  }

  findDuplicate(actor, requestId, now = Date.now()) {
    if (!requestId) return null;
    this.prune(now);
    return this.requestIds.get(`${actor}:${requestId}`)?.command || null;
  }

  enqueue(action, payload = {}, options = {}, now = Date.now()) {
    const validation = validateBoothCommand(action, payload);
    if (!validation.ok) {
      const error = new Error(validation.error);
      error.code = 'INVALID_BOOTH_COMMAND';
      throw error;
    }
    const actor = options.actor || 'internal';
    const requestId = options.requestId || null;
    const duplicate = this.findDuplicate(actor, requestId, now);
    if (duplicate) return { command: duplicate, duplicate: true };

    const command = {
      id: ++this.nextId,
      action,
      payload: validation.payload,
      timestamp: now,
      expiresAt: now + (options.ttlMs ?? 30 * 1000),
      status: 'pending',
      actor,
      requestId,
    };
    this.commands.push(command);
    if (this.commands.length > this.maxSize) this.commands = this.commands.slice(-this.maxSize);
    if (requestId) {
      this.requestIds.set(`${actor}:${requestId}`, {
        command,
        expiresAt: now + this.dedupeTtlMs,
      });
    }
    return { command, duplicate: false };
  }

  pendingSince(since = 0, now = Date.now()) {
    this.prune(now);
    return this.commands.filter(command => command.id > since);
  }

  acknowledgeThrough(upToId) {
    if (!Number.isInteger(upToId) || upToId < 1) return;
    this.commands = this.commands.filter(command => {
      if (command.id <= upToId) command.status = 'acknowledged';
      return command.id > upToId;
    });
  }
}