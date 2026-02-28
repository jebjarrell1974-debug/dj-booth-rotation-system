
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

const DEFAULTS = {
  openaiApiKey: '',
  elevenLabsApiKey: '',
  elevenLabsVoiceId: '',
  announcementsEnabled: true,
  clubName: '',
  clubOpenHour: 11,
  clubCloseHour: 2,
  energyOverride: 'auto',
  scriptModel: 'auto',
  clubSpecials: '',
};

let cachedConfig = null;

function readFromStorage() {
  return {
    openaiApiKey: (localStorage.getItem(STORAGE_KEYS.openaiApiKey) || '').trim(),
    elevenLabsApiKey: (localStorage.getItem(STORAGE_KEYS.elevenLabsApiKey) || '').trim(),
    elevenLabsVoiceId: (localStorage.getItem(STORAGE_KEYS.elevenLabsVoiceId) || '').trim(),
    announcementsEnabled: localStorage.getItem(STORAGE_KEYS.announcementsEnabled) !== 'false',
    clubName: localStorage.getItem(STORAGE_KEYS.clubName) || '',
    clubOpenHour: parseInt(localStorage.getItem(STORAGE_KEYS.clubOpenHour) || '11', 10),
    clubCloseHour: parseInt(localStorage.getItem(STORAGE_KEYS.clubCloseHour) || '2', 10),
    energyOverride: localStorage.getItem(STORAGE_KEYS.energyOverride) || 'auto',
    scriptModel: localStorage.getItem(STORAGE_KEYS.scriptModel) || 'auto',
    clubSpecials: localStorage.getItem(STORAGE_KEYS.clubSpecials) || '',
  };
}

export async function loadApiConfig() {
  cachedConfig = readFromStorage();
  return cachedConfig;
}

export const getApiConfig = () => {
  if (cachedConfig) return { ...cachedConfig };
  return readFromStorage();
};

export const saveApiConfig = (config) => {
  const updates = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (config[key] !== undefined) {
      updates[key] = typeof config[key] === 'string' ? config[key].trim() : config[key];
    }
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
};
