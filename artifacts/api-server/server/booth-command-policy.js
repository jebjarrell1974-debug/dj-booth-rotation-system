export const NORMAL_REMOTE_COMMANDS = new Set([
  'skip', 'startRotation', 'stopRotation', 'toggleAnnouncements', 'setSongsPerSet',
  'updateRotation', 'removeDancerFromRotation', 'addDancerToRotation', 'setVolume',
  'setVoiceGain', 'setCommercialFreq', 'setBreakSongsPerSet', 'moveInRotation',
  'saveRotation', 'updateInterstitialSongs', 'skipCommercial', 'swapPromo',
  'playSound', 'sendToVip', 'releaseFromVip', 'updateSongAssignments',
  'playHouseAnnouncement', 'deactivateTrack',
  'saveRotationWorkspace',
  'setAutoplayQueue', 'setAutoplayAutoFill',
  'playFeatureAudio',
  'placeFeature', 'cancelFeaturePlacement',
  'setBeatMatch', 'setMusicEq',
  'playLibraryTrack',
  'resetDancerVoiceovers',
  'acquireDuck', 'renewDuck', 'releaseDuck',
]);

const STRUCTURAL_COMMANDS = new Set([
  'updateRotation', 'removeDancerFromRotation', 'addDancerToRotation',
  'moveInRotation', 'saveRotation', 'updateSongAssignments',
  'saveRotationWorkspace',
  'updateInterstitialSongs', 'sendToVip', 'releaseFromVip',
  'placeFeature', 'cancelFeaturePlacement',
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

export function isPhysicalKioskAddress(address) {
  const normalized = String(address || '').replace(/^::ffff:/, '');
  // Audio/administration authority belongs to a browser talking over the
  // machine's loopback interface, never merely to another local interface on
  // the same host. A request arriving on the kiosk's LAN address is remote.
  return normalized === '127.0.0.1' || normalized === '::1';
}

export function isPhysicalKioskRequestMetadata(address, host, headers = {}) {
  if (!isPhysicalKioskAddress(address)) return false;

  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  const forwardingHeaders = [
    'forwarded',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-forwarded-port',
    'x-real-ip',
    'via',
  ];
  if (forwardingHeaders.some(name => normalizedHeaders[name] != null)) return false;

  const value = String(host || '').trim().toLowerCase();
  if (value === 'localhost' || value === 'localhost.') return true;
  if (/^localhost\.:\d+$/.test(value) || /^localhost:\d+$/.test(value)) return true;
  if (/^127\.0\.0\.1(?::\d+)?$/.test(value)) return true;
  return /^\[::1\](?::\d+)?$/.test(value);
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
    case 'skip':
      if (payload.skipBreaks != null && typeof payload.skipBreaks !== 'boolean') {
        return invalid('skipBreaks must be boolean');
      }
      break;
    case 'setVolume':
      if (!isFiniteNumber(payload.volume, 0, 1)) return invalid('volume must be a number from 0 to 1');
      break;
    case 'setVoiceGain':
      if (!isFiniteNumber(payload.gain, 0.5, 1.2)) return invalid('gain must be a number from 0.5 to 1.2');
      break;
    case 'acquireDuck':
    case 'renewDuck':
    case 'releaseDuck':
      if (!isString(payload.leaseId, 128)) return invalid('leaseId is required');
      if (payload.leaseMs != null && !isFiniteNumber(payload.leaseMs, 1000, 10_000)) {
        return invalid('leaseMs must be between 1000 and 10000 milliseconds');
      }
      break;
    case 'setBeatMatch':
      if (typeof payload.enabled !== 'boolean') return invalid('enabled must be boolean');
      break;
    case 'setMusicEq':
      if (!['bass', 'mid', 'treble'].includes(payload.band) || !isFiniteNumber(payload.value, -12, 12)) {
        return invalid('EQ band and value are invalid');
      }
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
    case 'saveRotationWorkspace':
      if (!isIdArray(payload.rotation)) return invalid('rotation must be an array of dancer IDs');
      if (!isPlainObject(payload.assignments) || Object.keys(payload.assignments).length > 500 ||
          !Object.entries(payload.assignments).every(([id, songs]) => isId(id) && isStringArray(songs))) {
        return invalid('assignments must map dancer IDs to song-name arrays');
      }
      if (!isPlainObject(payload.interstitialSongs) || Object.keys(payload.interstitialSongs).length > 100) {
        return invalid('interstitialSongs must be an object');
      }
      if (payload.manualOverrides != null && !isIdArray(payload.manualOverrides)) {
        return invalid('manualOverrides must be an array of dancer IDs');
      }
      break;
    case 'setAutoplayQueue':
      if (!isStringArray(payload.trackNames)) return invalid('trackNames must be an array of track names');
      break;
    case 'setAutoplayAutoFill':
      if (typeof payload.enabled !== 'boolean') return invalid('enabled must be boolean');
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
    case 'playLibraryTrack':
      if (!isString(payload.trackName, 512)) return invalid('trackName is required');
      break;
    case 'resetDancerVoiceovers':
      if (!isString(payload.dancerName, 256)) return invalid('dancerName is required');
      break;
    case 'playFeatureAudio':
      if (!isId(payload.dancerId) || !['intro', 'outro'].includes(payload.type)) {
        return invalid('dancerId and feature audio type are required');
      }
      break;
    case 'placeFeature':
      if (!isId(payload.featureId) || !Number.isInteger(payload.playPos) || payload.playPos < 1 || payload.playPos > 500) {
        return invalid('featureId and playPos are required');
      }
      if (payload.chosenSetName != null && !isString(payload.chosenSetName, 512)) return invalid('chosenSetName is invalid');
      if (payload.audioFlags != null && !isPlainObject(payload.audioFlags)) return invalid('audioFlags is invalid');
      break;
    case 'cancelFeaturePlacement':
      if (!isId(payload.featureId)) return invalid('featureId is required');
      break;
    case 'deactivateTrack':
      if (!isString(payload.trackName, 512) || !/^\d{5}$/.test(payload.pin)) {
        return invalid('trackName and a 5-digit DJ PIN are required');
      }
      break;
  }
  return { ok: true, payload };
}

export function nextStateRevisions(previous, incoming) {
  const structuralChanged = JSON.stringify(previous.rotation ?? []) !== JSON.stringify(incoming.rotation ?? previous.rotation ?? []) ||
    JSON.stringify(previous.rotationSongs ?? {}) !== JSON.stringify(incoming.rotationSongs ?? previous.rotationSongs ?? {}) ||
    JSON.stringify(previous.manualRotationSongs ?? {}) !== JSON.stringify(incoming.manualRotationSongs ?? previous.manualRotationSongs ?? {}) ||
    JSON.stringify(previous.interstitialSongs ?? {}) !== JSON.stringify(incoming.interstitialSongs ?? previous.interstitialSongs ?? {}) ||
    JSON.stringify(previous.dancerVipMap ?? {}) !== JSON.stringify(incoming.dancerVipMap ?? previous.dancerVipMap ?? {}) ||
    JSON.stringify(previous.placedFeatures ?? {}) !== JSON.stringify(incoming.placedFeatures ?? previous.placedFeatures ?? {});
  return {
    stateVersion: (previous.stateVersion ?? 0) + 1,
    rotationVersion: (previous.rotationVersion ?? 0) + (structuralChanged ? 1 : 0),
  };
}

export function boothWorkspaceSnapshot(state = {}) {
  const songName = track => {
    if (typeof track === 'string') return track;
    if (!track || typeof track !== 'object') return null;
    for (const field of ['name', 'file_name', 'filename', 'trackName', 'title', 'path']) {
      if (typeof track[field] !== 'string' || !track[field].trim()) continue;
      const value = track[field].trim();
      return field === 'path' ? (value.split(/[\\/]/).pop() || value) : value;
    }
    return null;
  };
  const songs = {};
  for (const [id, tracks] of Object.entries(state.rotationSongs || {})) {
    songs[id] = (tracks || []).map(songName).filter(Boolean);
  }
  return {
    rotation: [...(state.rotation || [])],
    rotationSongs: songs,
    interstitialSongs: state.interstitialSongs || {},
    dancerVipMap: state.dancerVipMap || {},
    placedFeatures: state.placedFeatures || {},
  };
}

export function normalizeBoothState(previous, state, now = Date.now()) {
  const source = state && typeof state === 'object' ? state : {};
  const prior = previous && typeof previous === 'object' ? previous : {};
  // A legacy kiosk may omit fields introduced after it was installed. Omitted
  // data means "not supplied", not "reset to a process default"; explicit
  // false, null, zero, and [] remain meaningful stop/empty values.
  const read = (key, fallback) => source[key] !== undefined
    ? source[key]
    : (prior[key] !== undefined ? prior[key] : fallback);
  const normalized = {
    isRotationActive: !!read('isRotationActive', false),
    currentDancerIndex: read('currentDancerIndex', 0),
    currentDancerName: read('currentDancerName', null),
    currentTrack: read('currentTrack', null),
    currentSongNumber: read('currentSongNumber', 0),
    songsPerSet: read('songsPerSet', 3),
    isPlaying: !!read('isPlaying', false),
    rotation: read('rotation', []) ?? [],
    announcementsEnabled: read('announcementsEnabled', true) !== false,
    skipLocked: !!read('skipLocked', false),
    rotationSongs: read('rotationSongs', {}) ?? {},
    manualRotationSongs: read('manualRotationSongs', {}) ?? {},
    volume: read('volume', 0.8),
    voiceGain: read('voiceGain', 1.5),
    trackTime: read('trackTime', 0),
    trackDuration: read('trackDuration', 0),
    trackTimeAt: read('trackTimeAt', 0),
    breakSongsPerSet: read('breakSongsPerSet', 0),
    breakSongIndex: read('breakSongIndex', null),
    interstitialSongs: read('interstitialSongs', {}) ?? {},
    commercialFreq: read('commercialFreq', 'off'),
    commercialCounter: read('commercialCounter', 0),
    promoQueue: read('promoQueue', []) ?? [],
    availablePromos: read('availablePromos', []) ?? [],
    skippedCommercials: read('skippedCommercials', []) ?? [],
    dancerVipMap: read('dancerVipMap', {}) ?? {},
    placedFeatures: read('placedFeatures', {}) ?? {},
    autoplayQueue: read('autoplayQueue', []) ?? [],
    autoplayAutoFillEnabled: read('autoplayAutoFillEnabled', true) !== false,
    // The process-level epoch is seeded on the live server's initial state.
    // Never trust a client-supplied epoch; a legacy publisher simply carries
    // forward the server's current one.
    stateEpoch: typeof prior.stateEpoch === 'string' ? prior.stateEpoch : null,
    updatedAt: now,
    diagLog: read('diagLog', []) ?? [],
    prePickHits: read('prePickHits', 0),
    prePickMisses: read('prePickMisses', 0),
    lastTransitionMs: read('lastTransitionMs', null),
    lastWatchdogAt: read('lastWatchdogAt', null),
    lastWatchdogSilentMs: read('lastWatchdogSilentMs', null),
    lastWatchdogDancer: read('lastWatchdogDancer', null),
    lastWatchdogTrack: read('lastWatchdogTrack', null),
  };
  return { ...normalized, ...nextStateRevisions(prior, normalized) };
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
    for (const command of this.commands) {
      if (command.status === 'pending' && command.expiresAt <= now) {
        command.status = 'expired';
        command.error = 'The command expired before the kiosk applied it';
        command.completedAt = now;
      }
    }
    this.commands = this.commands.filter(command =>
      ['pending', 'processing'].includes(command.status) ||
      (command.completedAt ?? command.timestamp) + this.dedupeTtlMs > now
    );
    for (const [key, value] of this.requestIds) {
      if (value.expiresAt <= now &&
          !['pending', 'processing'].includes(value.command?.status)) {
        this.requestIds.delete(key);
      }
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
    if (this.commands.filter(command => ['pending', 'processing'].includes(command.status)).length >= this.maxSize) {
      const error = new Error('The kiosk command queue is full; try again after pending work is applied');
      error.code = 'BOOTH_COMMAND_QUEUE_FULL';
      throw error;
    }

    const command = {
      id: ++this.nextId,
      action,
      payload: validation.payload,
      timestamp: now,
      expiresAt: now + (options.ttlMs ?? 30 * 1000),
      status: 'pending',
      actor,
      requestId,
      expectedRotationVersion: options.expectedRotationVersion,
      expectedStateVersion: options.expectedStateVersion,
      nowPlayingGuard: options.nowPlayingGuard || null,
      expectedRotation: options.expectedRotation,
      expectedWorkspace: options.expectedWorkspace,
    };
    this.commands.push(command);
    if (this.commands.length > this.maxSize * 3) {
      const pending = this.commands.filter(item => ['pending', 'processing'].includes(item.status));
      const receipts = this.commands
        .filter(item => !['pending', 'processing'].includes(item.status))
        .slice(-this.maxSize * 2);
      this.commands = [...pending, ...receipts].sort((a, b) => a.id - b.id);
    }
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
    return this.commands.filter(command => command.id > since && command.status === 'pending');
  }

  getById(id, now = Date.now()) {
    this.prune(now);
    return this.commands.find(command => command.id === id) || null;
  }

  pendingStructuralForVersion(rotationVersion, now = Date.now()) {
    this.prune(now);
    return this.commands.find(command =>
      (command.status === 'pending' || command.status === 'processing') &&
      isStructuralCommand(command.action) &&
      command.expectedRotationVersion === rotationVersion
    ) || null;
  }

  acknowledge(commandId, result = {}, now = Date.now()) {
    if (!Number.isInteger(commandId) || commandId < 1) return null;
    const command = this.getById(commandId, now);
    if (!command || !['pending', 'processing'].includes(command.status)) return command;
    command.status = result.ok === false ? 'failed' : 'applied';
    command.error = result.error || null;
    command.completedAt = now;
    command.appliedStateVersion = result.stateVersion;
    command.appliedRotationVersion = result.rotationVersion;
    return command;
  }

  claim(commandId, now = Date.now()) {
    if (!Number.isInteger(commandId) || commandId < 1) return null;
    const command = this.getById(commandId, now);
    if (!command || command.status !== 'pending') return command;
    command.status = 'processing';
    command.startedAt = now;
    return command;
  }

  // Compatibility for older kiosk clients. This is intentionally exact rather
  // than "through": a later SSE delivery must never acknowledge earlier work
  // that has not actually finished.
  acknowledgeThrough(commandId) {
    return this.acknowledge(commandId);
  }
}