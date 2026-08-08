
const STORAGE_KEYS = {
  openaiApiKey: 'djbooth_openai_key',
  elevenLabsApiKey: 'djbooth_elevenlabs_key',
  elevenLabsVoiceId: 'djbooth_elevenlabs_voice_id',
  announcementsEnabled: 'djbooth_announcements_enabled',
  clubName: 'djbooth_club_name',
  clubOpenHour: 'djbooth_club_open_hour',
  clubCloseHour: 'djbooth_club_close_hour',
  energyOverride: 'djbooth_energy_override',
  scriptModel: 'djbooth_script_model',
  clubSpecials: 'djbooth_club_specials',
};

// Lauren — the production voice. Baked into the app so it ships with every update
// and can never be mistyped on a kiosk touchscreen. To change the voice later, edit
// this one line and push an update — do NOT type voice IDs into the booth by hand.
export const FORCED_VOICE_ID = 'DODLEQrClDo8wCz460ld';

// ElevenLabs keys always start with "sk_" followed by a long hex/alnum body.
// Anything else (partial kiosk typing, garbled paste, blank) must NEVER be
// stored or used — a malformed key silently kills all voice generation while
// cached audio keeps playing, so nobody notices until a new girl goes silent.
export const isValidElevenLabsKey = (k) => /^sk_[A-Za-z0-9]{16,}$/.test((k || '').trim());

const DEFAULTS = {
  openaiApiKey: '',
  elevenLabsApiKey: '',
  elevenLabsVoiceId: '',
  announcementsEnabled: true,
  clubName: '',
  clubOpenHour: 11,
  clubCloseHour: 2,
  energyOverride: 'auto',
  scriptModel: 'gpt-4.1',
  clubSpecials: '',
};

let cachedConfig = null;
let serverDefaults = null;
let serverDefaultsOk = false;

async function fetchServerDefaults() {
  // Only cache a SUCCESSFUL fetch. If the server wasn't up yet (kiosk boot race),
  // caching {} forever meant a wiped browser profile never recovered its keys —
  // and worse, the Options page would then auto-save empty keys over the server
  // copy. Retry a few times, and retry again on the next loadApiConfig call.
  if (serverDefaultsOk) return serverDefaults;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('/api/config/defaults');
      if (res.ok) {
        serverDefaults = await res.json();
        serverDefaultsOk = true;
        reseedStorageFromServer(serverDefaults);
        return serverDefaults;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
  }
  serverDefaults = serverDefaults || {};
  return serverDefaults;
}

// A Chromium profile reset wipes localStorage. Re-seed the API keys from the
// server's copy (settings DB / .env) so a wiped kiosk fully recovers on first
// load with no manual re-entry.
function reseedStorageFromServer(sd) {
  try {
    if (sd.openaiApiKey && !(localStorage.getItem(STORAGE_KEYS.openaiApiKey) || '').trim()) {
      localStorage.setItem(STORAGE_KEYS.openaiApiKey, sd.openaiApiKey);
    }
    // Re-seed when local key is blank OR malformed — a corrupted local key must
    // heal itself from the server copy on next load, not stick around all night.
    const localEl = (localStorage.getItem(STORAGE_KEYS.elevenLabsApiKey) || '').trim();
    if (isValidElevenLabsKey(sd.elevenLabsApiKey) && !isValidElevenLabsKey(localEl)) {
      localStorage.setItem(STORAGE_KEYS.elevenLabsApiKey, sd.elevenLabsApiKey);
      if (localEl) console.warn('🔑 Replaced malformed local ElevenLabs key with server copy');
    }
  } catch {}
}

function readFromStorage() {
  const local = {
    openaiApiKey: (localStorage.getItem(STORAGE_KEYS.openaiApiKey) || '').trim(),
    elevenLabsApiKey: (localStorage.getItem(STORAGE_KEYS.elevenLabsApiKey) || '').trim(),
    elevenLabsVoiceId: (localStorage.getItem(STORAGE_KEYS.elevenLabsVoiceId) || '').trim(),
    announcementsEnabled: localStorage.getItem(STORAGE_KEYS.announcementsEnabled) !== 'false',
    clubName: localStorage.getItem(STORAGE_KEYS.clubName) || '',
    clubOpenHour: parseInt(localStorage.getItem(STORAGE_KEYS.clubOpenHour) || '11', 10),
    clubCloseHour: parseInt(localStorage.getItem(STORAGE_KEYS.clubCloseHour) || '2', 10),
    energyOverride: localStorage.getItem(STORAGE_KEYS.energyOverride) || 'auto',
    scriptModel: localStorage.getItem(STORAGE_KEYS.scriptModel) || 'gpt-4.1',
    clubSpecials: localStorage.getItem(STORAGE_KEYS.clubSpecials) || '',
  };

  const sd = serverDefaults || {};
  // A malformed local ElevenLabs key is treated as ABSENT so the server copy
  // (env/DB/last-known-good) wins. Never hand a bad key to the announcer.
  const localElevenLabs = isValidElevenLabsKey(local.elevenLabsApiKey) ? local.elevenLabsApiKey : '';
  return {
    ...local,
    openaiApiKey: local.openaiApiKey || sd.openaiApiKey || '',
    elevenLabsApiKey: localElevenLabs || sd.elevenLabsApiKey || '',
    elevenLabsVoiceId: FORCED_VOICE_ID,
    scriptModel: local.scriptModel || sd.scriptModel || 'gpt-4.1',
  };
}

// Self-heal for long-running kiosk pages: a booth screen can outlive the moment
// a key arrives on the server (remote paste / fleet sync AFTER page load), and
// fetchServerDefaults caches its first successful answer forever. While no
// valid ElevenLabs key is in hand, force-refetch server defaults every 60s so
// the running page adopts a late-arriving key WITHOUT a reload. Stops itself
// once a valid key is present. (Aug 8 2026 — venue outage root cause.)
let keyWatchdogRunning = false;
function startKeyWatchdog() {
  if (keyWatchdogRunning) return;
  const cfg = cachedConfig || readFromStorage();
  if (isValidElevenLabsKey(cfg.elevenLabsApiKey)) return;
  keyWatchdogRunning = true;
  const tick = async () => {
    try {
      serverDefaultsOk = false; // bust the forever-cache
      await fetchServerDefaults();
      cachedConfig = readFromStorage();
      if (isValidElevenLabsKey(cachedConfig.elevenLabsApiKey)) {
        console.warn('🔑 ElevenLabs key arrived from server — adopted without reload');
        keyWatchdogRunning = false;
        return;
      }
    } catch {}
    setTimeout(tick, 60000);
  };
  setTimeout(tick, 60000);
}

export async function loadApiConfig() {
  await fetchServerDefaults();
  cachedConfig = readFromStorage();
  startKeyWatchdog();
  return cachedConfig;
}

export const getApiConfig = () => {
  if (cachedConfig) return { ...cachedConfig };
  return readFromStorage();
};

// Called when ElevenLabs rejects the key at generation time (400 "must start
// with 'sk_'" / 401 invalid). Drops the bad local copy, forces a fresh pull of
// server defaults (env → stored → last-known-good), and rebuilds the cached
// config — so a remotely-pasted or fleet-synced fix takes effect WITHOUT
// restarting the booth.
export async function recoverElevenLabsKey() {
  // Only called on CONFIRMED rejection (or missing key), so always evict the
  // local copy — a format-valid but revoked key must not keep winning over a
  // fresher server/remote-pasted key.
  try { localStorage.removeItem(STORAGE_KEYS.elevenLabsApiKey); } catch {}
  serverDefaultsOk = false; // force refetch — server may have a newer good key
  await fetchServerDefaults();
  cachedConfig = readFromStorage();
  const ok = isValidElevenLabsKey(cachedConfig.elevenLabsApiKey);
  console.warn(`🔑 ElevenLabs key recovery: ${ok ? 'restored a valid key' : 'no valid key available yet'}`);
  if (!ok) startKeyWatchdog(); // keep polling until a key shows up on the server
  return ok;
}

export const saveApiConfig = (config) => {
  const updates = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (config[key] !== undefined) {
      updates[key] = typeof config[key] === 'string' ? config[key].trim() : config[key];
    }
  }

  // API keys: REFUSE bad values instead of storing them. A blank or malformed
  // key (whole-form autosave with an untouched/garbled field, partial kiosk
  // typing) must never overwrite a working key — locally OR on the server.
  if (updates.openaiApiKey !== undefined && !(updates.openaiApiKey || '').trim()) {
    delete updates.openaiApiKey; // never blank over a stored key
  }
  if (updates.elevenLabsApiKey !== undefined && !isValidElevenLabsKey(updates.elevenLabsApiKey)) {
    if ((updates.elevenLabsApiKey || '').trim()) {
      console.warn('🔑 Rejected malformed ElevenLabs key on save (must start with sk_) — keeping current key');
    }
    delete updates.elevenLabsApiKey;
  }
  if (updates.openaiApiKey !== undefined) localStorage.setItem(STORAGE_KEYS.openaiApiKey, updates.openaiApiKey);
  if (updates.elevenLabsApiKey !== undefined) localStorage.setItem(STORAGE_KEYS.elevenLabsApiKey, updates.elevenLabsApiKey);
  if (updates.elevenLabsVoiceId !== undefined) localStorage.setItem(STORAGE_KEYS.elevenLabsVoiceId, updates.elevenLabsVoiceId);
  if (updates.announcementsEnabled !== undefined) localStorage.setItem(STORAGE_KEYS.announcementsEnabled, String(updates.announcementsEnabled));
  if (updates.clubName !== undefined) localStorage.setItem(STORAGE_KEYS.clubName, updates.clubName);
  if (updates.clubOpenHour !== undefined) localStorage.setItem(STORAGE_KEYS.clubOpenHour, String(updates.clubOpenHour));
  if (updates.clubCloseHour !== undefined) localStorage.setItem(STORAGE_KEYS.clubCloseHour, String(updates.clubCloseHour));
  if (updates.energyOverride !== undefined) localStorage.setItem(STORAGE_KEYS.energyOverride, updates.energyOverride);
  if (updates.scriptModel !== undefined) localStorage.setItem(STORAGE_KEYS.scriptModel, updates.scriptModel);
  if (updates.clubSpecials !== undefined) localStorage.setItem(STORAGE_KEYS.clubSpecials, updates.clubSpecials);

  const current = cachedConfig || readFromStorage();
  cachedConfig = { ...current, ...updates };

  const serverPayload = {};
  // Never push an EMPTY key to the server. An empty field (e.g. after a browser
  // profile wipe, before server defaults loaded) must not clobber the server's
  // stored key — the server copy is the recovery backstop. The server also
  // enforces this, but don't even send it.
  if (updates.openaiApiKey) serverPayload[STORAGE_KEYS.openaiApiKey] = updates.openaiApiKey;
  if (updates.elevenLabsApiKey) serverPayload[STORAGE_KEYS.elevenLabsApiKey] = updates.elevenLabsApiKey;
  if (updates.elevenLabsVoiceId !== undefined) serverPayload[STORAGE_KEYS.elevenLabsVoiceId] = updates.elevenLabsVoiceId;
  if (updates.announcementsEnabled !== undefined) serverPayload[STORAGE_KEYS.announcementsEnabled] = String(updates.announcementsEnabled);
  if (updates.clubName !== undefined) serverPayload[STORAGE_KEYS.clubName] = updates.clubName;
  if (updates.clubOpenHour !== undefined) serverPayload[STORAGE_KEYS.clubOpenHour] = String(updates.clubOpenHour);
  if (updates.clubCloseHour !== undefined) serverPayload[STORAGE_KEYS.clubCloseHour] = String(updates.clubCloseHour);
  if (updates.energyOverride !== undefined) serverPayload[STORAGE_KEYS.energyOverride] = updates.energyOverride;
  if (updates.scriptModel !== undefined) serverPayload[STORAGE_KEYS.scriptModel] = updates.scriptModel;
  if (updates.clubSpecials !== undefined) serverPayload[STORAGE_KEYS.clubSpecials] = updates.clubSpecials;
  if (Object.keys(serverPayload).length > 0) {
    fetch('/api/config/save-to-server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serverPayload),
    }).catch(() => {});
  }
};
