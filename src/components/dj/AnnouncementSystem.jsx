import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Mic, Download, Wifi, WifiOff, Loader2, Check, AlertCircle, HardDrive } from 'lucide-react';
import { localIntegrations } from '@/api/localEntities';
import { getApiConfig } from '@/components/apiConfig';
import { getCurrentEnergyLevel, VOICE_SETTINGS, ENERGY_LEVELS, buildAnnouncementPrompt } from '@/utils/energyLevels';
import { trackOpenAICall, trackElevenLabsCall, estimateTokens } from '@/utils/apiCostTracker';

const getAuthHeaders = () => {
  const token = sessionStorage.getItem('djbooth_token');
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const DB_NAME = 'djAnnouncementsDB';
const STORE_NAME = 'announcements';

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
};

const getCachedFromIndexedDB = async (key) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result?.audioBlob);
    });
  } catch { return null; }
};

const cacheToIndexedDB = async (key, audioBlob) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put({ key, audioBlob, timestamp: Date.now() });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (err) { console.error('IndexedDB cache failed:', err); }
};

const blobToBase64 = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const CURRENT_VOICE_VERSION = 'V10';

const cleanupStaleIDBEntries = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAllKeys();
    request.onsuccess = () => {
      const keys = request.result || [];
      let removed = 0;
      for (const key of keys) {
        if (typeof key === 'string' && !key.includes(`-${CURRENT_VOICE_VERSION}`)) {
          store.delete(key);
          removed++;
        }
      }
      if (removed > 0) console.log(`🧹 Cleaned ${removed} stale voiceover entries from IndexedDB`);
    };
  } catch {}
};

const ANNOUNCEMENT_TYPES = {
  INTRO: 'intro',
  ROUND2: 'round2',
  OUTRO: 'outro',
  TRANSITION: 'transition'
};

const GENERIC_DANCER_NAME = '_GENERIC_';

const AnnouncementSystem = React.forwardRef((props, ref) => {
  const {
    dancers,
    rotation,
    currentDancerIndex,
    onPlay,
    elevenLabsApiKey,
    openaiApiKey,
    hideUI = false
  } = props;

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [cacheStatus, setCacheStatus] = useState({});
  const [serverCacheCount, setServerCacheCount] = useState(0);
  const [isPreCaching, setIsPreCaching] = useState(false);
  const [preCacheProgress, setPreCacheProgress] = useState(0);
  const [preCacheETA, setPreCacheETA] = useState(null);
  const [generatingType, setGeneratingType] = useState(null);
  const [preCacheError, setPreCacheError] = useState(null);
  const preCacheStartTimeRef = useRef(0);
  const specialsAnnouncementCountRef = useRef(0);
  const specialsRotationIndexRef = useRef(0);
  const specialsNextTriggerRef = useRef(Math.floor(Math.random() * 2) + 2);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const loadServerCacheStatus = async () => {
      try {
        const res = await fetch('/api/voiceovers', { headers: getAuthHeaders() });
        if (res.ok) {
          const voiceovers = await res.json();
          const status = {};
          voiceovers.forEach(vo => { status[vo.cache_key] = true; });
          setCacheStatus(status);
          setServerCacheCount(voiceovers.length);
          console.log(`🎙️ Server has ${voiceovers.length} cached voiceovers`);
        }
      } catch (err) {
        console.error('Failed to load server cache status:', err);
      }
    };
    loadServerCacheStatus();
    cleanupStaleIDBEntries();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const parseResponse = (raw) => {
    let text = '';
    if (typeof raw === 'string') {
      text = raw;
    } else if (raw && typeof raw === 'object') {
      if (typeof raw.script === 'string') text = raw.script;
      else if (typeof raw.text === 'string') text = raw.text;
      else if (typeof raw.content === 'string') text = raw.content;
      else if (Array.isArray(raw.fragments)) text = raw.fragments.join(' ');
      else if (typeof raw.choices?.[0]?.message?.content === 'string') text = raw.choices[0].message.content;
      else text = JSON.stringify(raw);
    } else {
      text = String(raw ?? '');
    }
    if (typeof text !== 'string') text = String(text ?? '');
    text = text.replace(/^\d+[\.\)]\s*/gm, '').trim();
    text = text.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const lastEnd = Math.max(text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?'));
    if (lastEnd > 0 && lastEnd < text.length - 1) {
      text = text.substring(0, lastEnd + 1);
    }
    return text || 'Welcome to the stage.';
  };

  const getStaggeredSpecial = useCallback((type) => {
    if (type !== 'outro' && type !== 'transition') return [];
    const config = getApiConfig();
    const allSpecials = (config.clubSpecials || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (allSpecials.length === 0) return [];

    specialsAnnouncementCountRef.current++;
    if (specialsAnnouncementCountRef.current < specialsNextTriggerRef.current) return [];

    specialsAnnouncementCountRef.current = 0;
    specialsNextTriggerRef.current = Math.floor(Math.random() * 2) + 2;

    const idx = specialsRotationIndexRef.current % allSpecials.length;
    specialsRotationIndexRef.current = idx + 1;
    console.log(`🎤 Club special #${idx + 1}/${allSpecials.length}: "${allSpecials[idx]}" (next in ${specialsNextTriggerRef.current} announcements)`);
    return [allSpecials[idx]];
  }, []);

  const generateScript = useCallback(async (type, dancerName, nextDancerName = null, energyLevel = 3, roundNumber = 1) => {
    const config = getApiConfig();
    const clubName = config.clubName || '';
    const specials = getStaggeredSpecial(type);
    const prompt = buildAnnouncementPrompt(type, dancerName, nextDancerName, energyLevel, roundNumber, clubName, specials);

    const openaiKey = config.openaiApiKey || '';
    const scriptModel = config.scriptModel || 'auto';

    if (openaiKey && scriptModel !== 'auto') {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: scriptModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.9,
          frequency_penalty: 0.6,
          presence_penalty: 0.4,
          max_tokens: 300,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`OpenAI ${res.status}: ${errText}`);
      }
      const data = await res.json();
      const usage = data.usage;
      trackOpenAICall({
        model: scriptModel,
        promptTokens: usage?.prompt_tokens || estimateTokens(prompt),
        completionTokens: usage?.completion_tokens || estimateTokens(data.choices?.[0]?.message?.content || ''),
        context: `announcement-${type}-${dancerName}`,
      });
      return parseResponse(data);
    }

    const response = await localIntegrations.Core.InvokeLLM({ prompt });
    return parseResponse(response);
  }, []);

  const generateAudio = useCallback(async (script, energyLevel = 3) => {
    const config = getApiConfig();
    const apiKey = config.elevenLabsApiKey || elevenLabsApiKey;
    if (!apiKey) {
      throw new Error('ElevenLabs API key not configured - check settings');
    }

    const voiceId = config.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM';
    const voiceSettings = VOICE_SETTINGS[energyLevel] || VOICE_SETTINGS[3];

    const pronunciationMap = {};
    if (dancers && dancers.length > 0) {
      for (const d of dancers) {
        if (d.phonetic_name && d.phonetic_name.trim()) {
          pronunciationMap[d.name] = d.phonetic_name.trim();
          pronunciationMap[d.name + "'s"] = d.phonetic_name.trim() + "'s";
        }
      }
    }
    const FALLBACK_MAP = {
      'Mia': 'Meeyah',
      'Chaunte': 'Shawn-tay',
      'Charisse': 'Sha-reese',
      'Tatianna': 'Tah-tee-ah-nah',
      'Nadia': 'Nah-dee-ah',
      'Yasmine': 'Yazmen',
      'Mimi': 'Mee-Mee',
      'Ava': 'Ay-vuh',
      'Gigi': 'Jee-Jee',
    };
    for (const [name, phonetic] of Object.entries(FALLBACK_MAP)) {
      if (!pronunciationMap[name]) {
        pronunciationMap[name] = phonetic;
        pronunciationMap[name + "'s"] = phonetic + "'s";
      }
    }
    const SPELL_OUT = new Set(['VIP', 'DJ', 'MC', 'ATM', 'ID', 'VR', 'TV', 'AC', 'DC', 'OK', 'UV']);
    let ttsText = script.replace(/\b([A-Z]{2,}(?:'[Ss])?)\b/g, (match) => {
      const base = match.replace(/'[Ss]$/, '');
      const suffix = match.slice(base.length);
      if (SPELL_OUT.has(base)) return base.split('').join('.') + '.' + suffix;
      return base.charAt(0) + base.slice(1).toLowerCase() + suffix;
    });
    for (const [name, phonetic] of Object.entries(pronunciationMap)) {
      ttsText = ttsText.replace(new RegExp(`\\b${name}\\b`, 'gi'), phonetic);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text: ttsText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: voiceSettings.stability,
          similarity_boost: voiceSettings.similarity_boost,
          style: voiceSettings.style,
          speed: voiceSettings.speed,
          use_speaker_boost: voiceSettings.use_speaker_boost !== false,
        }
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const status = response.status;
      let detail = '';
      try {
        const errBody = await response.json();
        detail = errBody?.detail?.message || errBody?.detail || JSON.stringify(errBody);
      } catch (e) {}
      if (status === 401) {
        throw new Error(`Invalid ElevenLabs API key - check settings. ${detail}`);
      } else if (status === 429) {
        throw new Error('Rate limit exceeded. Wait a moment and try again.');
      }
      throw new Error(`ElevenLabs error (${status}): ${detail || 'Unknown error'}`);
    }

    trackElevenLabsCall({ text: ttsText, model: 'eleven_multilingual_v2', context: 'announcement-tts' });
    return await response.blob();
  }, [elevenLabsApiKey]);

  const getAnnouncementKey = (type, dancerName, nextDancerName = null, energyLevel = 3) => {
    return `${type}-${dancerName}${nextDancerName ? `-${nextDancerName}` : ''}-L${energyLevel}-V10`;
  };

  const getSpecialsHash = () => {
    const config = getApiConfig();
    const specials = (config.clubSpecials || '').trim();
    if (!specials) return '';
    let h = 0;
    for (let i = 0; i < specials.length; i++) {
      h = ((h << 5) - h + specials.charCodeAt(i)) | 0;
    }
    return `-S${Math.abs(h).toString(36)}`;
  };

  const getClubSuffix = () => {
    const config = getApiConfig();
    const clubName = (config.clubName || '').trim();
    if (!clubName) return '';
    return `-C${clubName.replace(/[^a-zA-Z0-9]/g, '')}`;
  };

  const getCacheKey = (type, dancerName, nextDancerName = null, energyLevel = 3) => {
    return getAnnouncementKey(type, dancerName, nextDancerName, energyLevel) + getSpecialsHash() + getClubSuffix();
  };

  const saveToServer = useCallback(async (cacheKey, audioBlob, script, type, dancerName, energyLevel) => {
    try {
      const config = getApiConfig();
      const clubName = (config.clubName || '').trim() || null;
      const audio_base64 = await blobToBase64(audioBlob);
      const res = await fetch('/api/voiceovers', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cache_key: cacheKey,
          audio_base64,
          script,
          type,
          dancer_name: dancerName,
          energy_level: energyLevel,
          club_name: clubName
        })
      });
      if (res.ok) {
        console.log(`💾 Saved voiceover to server: ${cacheKey}${clubName ? ` (club: ${clubName})` : ''}`);
        return true;
      }
      console.error('Server save failed:', res.status);
      return false;
    } catch (err) {
      console.error('Failed to save voiceover to server:', err);
      return false;
    }
  }, []);

  const loadFromServer = useCallback(async (cacheKey) => {
    try {
      const res = await fetch(`/api/voiceovers/audio/${encodeURIComponent(cacheKey)}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const blob = await res.blob();
        console.log(`✅ Loaded voiceover from server: ${cacheKey}`);
        return blob;
      }
      return null;
    } catch (err) {
      return null;
    }
  }, []);

  const checkServerCache = useCallback(async (cacheKey) => {
    try {
      const res = await fetch(`/api/voiceovers/check/${encodeURIComponent(cacheKey)}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        return data.exists;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const findCachedAtAnyLevel = useCallback(async (type, dancerName, nextDancerName) => {
    const clubSuffix = getClubSuffix();
    for (let l = 1; l <= 5; l++) {
      const altKey = getAnnouncementKey(type, dancerName, nextDancerName, l) + clubSuffix;
      const idb = await getCachedFromIndexedDB(altKey);
      if (idb) {
        console.log(`✅ Found cached ${type} for ${dancerName} at L${l} (IndexedDB)`);
        return { url: URL.createObjectURL(idb), fromCache: true };
      }
      const serverBlob = await loadFromServer(altKey);
      if (serverBlob) {
        await cacheToIndexedDB(altKey, serverBlob);
        return { url: URL.createObjectURL(serverBlob), fromCache: true };
      }
    }
    return null;
  }, [loadFromServer]);

  const genericIndexRef = useRef({ intro: 0, round2: 0, outro: 0, transition: 0 });

  const checkGenericRecording = useCallback(async (type) => {
    const typeKey = type === ANNOUNCEMENT_TYPES.ROUND2 ? 'round2' : type;
    const genericName = '__generic__';
    const idx = genericIndexRef.current;
    const maxVariations = 10;
    for (let attempt = 0; attempt < maxVariations; attempt++) {
      idx[typeKey] = ((idx[typeKey] || 0) % maxVariations) + 1;
      const recType = `${typeKey}_${idx[typeKey]}`;
      const cacheKey = `custom-recording-${genericName}-${recType}`;
      const idbCached = await getCachedFromIndexedDB(cacheKey);
      if (idbCached) {
        console.log(`🎤 Generic ${typeKey} from IndexedDB: ${recType}`);
        return idbCached;
      }
      try {
        const res = await fetch(`/api/fleet/voice-recordings/audio/${encodeURIComponent(genericName)}/${encodeURIComponent(recType)}`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const blob = await res.blob();
          await cacheToIndexedDB(cacheKey, blob);
          console.log(`🎤 Generic ${typeKey} fetched: ${recType}`);
          return blob;
        }
      } catch {}
    }
    return null;
  }, []);

  const noRecordingSetRef = useRef(new Set());

  const checkCustomRecording = useCallback(async (dancerName, type) => {
    if (!dancerName || dancerName === GENERIC_DANCER_NAME) return null;
    const customCacheKey = `custom-recording-${dancerName}-${type}`;
    const idbCached = await getCachedFromIndexedDB(customCacheKey);
    if (idbCached) {
      console.log(`🎤 Custom recording loaded from IndexedDB: ${dancerName}/${type}`);
      return idbCached;
    }
    if (noRecordingSetRef.current.has(customCacheKey)) return null;
    try {
      const res = await fetch(`/api/fleet/voice-recordings/audio/${encodeURIComponent(dancerName)}/${encodeURIComponent(type)}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const blob = await res.blob();
        await cacheToIndexedDB(customCacheKey, blob);
        console.log(`🎤 Custom recording fetched and cached: ${dancerName}/${type}`);
        return blob;
      }
      noRecordingSetRef.current.add(customCacheKey);
      return null;
    } catch {
      return null;
    }
  }, []);

  const getOrGenerateAnnouncement = useCallback(async (type, dancerName, nextDancerName = null, energyLevel = null, roundNumber = 1) => {
    const config = getApiConfig();
    const level = energyLevel ?? getCurrentEnergyLevel(config);
    const specialsSuffix = getSpecialsHash();
    const clubSuffix = getClubSuffix();
    const hasSpecials = specialsSuffix.length > 0;
    const isSpecialsEligible = hasSpecials && (type === 'outro' || type === 'transition');
    const key = getAnnouncementKey(type, dancerName, nextDancerName, level) + specialsSuffix + clubSuffix;

    const customBlob = await checkCustomRecording(dancerName, type);
    if (customBlob) {
      console.log(`🎤 Using custom recording for ${dancerName}/${type} (skipping AI TTS)`);
      return { url: URL.createObjectURL(customBlob), fromCache: true };
    }

    if (!isSpecialsEligible) {
      const idbCached = await getCachedFromIndexedDB(key);
      if (idbCached) {
        console.log(`✅ Loaded from IndexedDB (session cache): ${key}`);
        setCacheStatus(prev => ({ ...prev, [key]: true }));
        return { url: URL.createObjectURL(idbCached), fromCache: true };
      }
    }

    if (!hasSpecials) {
      const serverBlob = await loadFromServer(key);
      if (serverBlob) {
        await cacheToIndexedDB(key, serverBlob);
        setCacheStatus(prev => ({ ...prev, [key]: true }));
        return { url: URL.createObjectURL(serverBlob), fromCache: true };
      }
    }

    try {
      console.log(`🎙️ Generating new announcement: ${key} (Energy L${level})${isSpecialsEligible ? ' [specials staggered]' : hasSpecials ? ' [with specials]' : ''}`);
      setGeneratingType(type);
      const script = await generateScript(type, dancerName, nextDancerName, level, roundNumber);
      const audioBlob = await generateAudio(script, level);

      if (!isSpecialsEligible) {
        await cacheToIndexedDB(key, audioBlob);
      }

      if (!hasSpecials) {
        await saveToServer(key, audioBlob, script, type, dancerName, level);
      } else {
        console.log(`📢 Specials active — voiceover not cached (staggered specials vary each time)`);
      }

      setCacheStatus(prev => ({ ...prev, [key]: true }));
      if (!hasSpecials) setServerCacheCount(prev => prev + 1);
      setGeneratingType(null);

      console.log(`✅ Generated announcement: ${key} (L${level})${isSpecialsEligible ? ' [fresh, staggered]' : !hasSpecials ? ' — saved to server' : ''}`);
      return { url: URL.createObjectURL(audioBlob), fromCache: false };
    } catch (genError) {
      setGeneratingType(null);
      console.warn(`⚠️ Could not generate ${type} for ${dancerName}: ${genError.message}, trying fallbacks...`);
      if (dancerName !== GENERIC_DANCER_NAME) {
        const anyLevel = await findCachedAtAnyLevel(type, dancerName, nextDancerName);
        if (anyLevel) {
          console.log(`✅ Using ${dancerName} cached ${type} from different energy level (fallback)`);
          return anyLevel;
        }
        const anyGeneric = await findCachedAtAnyLevel(type, GENERIC_DANCER_NAME, null);
        if (anyGeneric) {
          console.log(`✅ Using generic fallback from any energy level for ${type}`);
          return anyGeneric;
        }
      } else {
        const anyGenericLevel = await findCachedAtAnyLevel(type, GENERIC_DANCER_NAME, null);
        if (anyGenericLevel) {
          console.log(`✅ Using generic fallback from any energy level for ${type}`);
          return anyGenericLevel;
        }
      }
      const genericRecording = await checkGenericRecording(type);
      if (genericRecording) {
        console.log(`🎤 Last-resort generic pre-recorded ${type} voiceover used`);
        return { url: URL.createObjectURL(genericRecording), fromCache: true };
      }
      console.error(`❌ No announcement available for ${type}: ${genError.message}`);
      throw genError;
    }
  }, [generateScript, generateAudio, findCachedAtAnyLevel, saveToServer, loadFromServer, checkCustomRecording, checkGenericRecording]);

  const playAnnouncement = useCallback(async (type, dancerName, nextDancerName = null, roundNumber = 1, audioOptions = {}) => {
    try {
      const config = getApiConfig();
      const level = getCurrentEnergyLevel(config);
      console.log(`📢 AnnouncementSystem: Generating ${type} for ${dancerName} (Energy L${level}, Round ${roundNumber})`);
      const result = await getOrGenerateAnnouncement(type, dancerName, nextDancerName, level, roundNumber);
      console.log(`📢 AnnouncementSystem: Got audio URL (cached=${result.fromCache}), playing...`);
      await onPlay?.(result.url, audioOptions);
      console.log(`📢 AnnouncementSystem: Playback complete`);
    } catch (error) {
      console.error(`❌ AnnouncementSystem Error (silent fallback):`, error.message);
      console.warn(`Announcement skipped: ${error.message} — music continues uninterrupted`);
    }
  }, [getOrGenerateAnnouncement, onPlay]);

  const preCacheDancer = useCallback(async (dancerName) => {
    const config = getApiConfig();
    if (!config.elevenLabsApiKey && !elevenLabsApiKey) {
      console.warn('⚠️ No ElevenLabs API key configured - skipping pre-cache');
      return;
    }
    const level = getCurrentEnergyLevel(config);
    console.log(`🔄 Auto pre-caching announcements for: ${dancerName} (Energy L${level})`);
    const types = [ANNOUNCEMENT_TYPES.INTRO, ANNOUNCEMENT_TYPES.ROUND2, ANNOUNCEMENT_TYPES.OUTRO];
    for (const type of types) {
      try {
        const result = await getOrGenerateAnnouncement(type, dancerName, null, level, type === ANNOUNCEMENT_TYPES.ROUND2 ? 2 : 1);
        if (result.url?.startsWith('blob:')) URL.revokeObjectURL(result.url);
        if (!result.fromCache) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      } catch (err) {
        console.error(`Pre-cache failed for ${type}-${dancerName}:`, err.message);
        break;
      }
    }
    console.log(`✅ Pre-cache complete for: ${dancerName}`);
  }, [getOrGenerateAnnouncement, elevenLabsApiKey]);

  const preCacheCancelRef = useRef(false);

  const preCacheUpcoming = useCallback(async (upcomingDancers) => {
    const config = getApiConfig();
    if (!config.elevenLabsApiKey && !elevenLabsApiKey) return;
    if (!upcomingDancers || upcomingDancers.length === 0) return;

    preCacheCancelRef.current = true;
    await new Promise(r => setTimeout(r, 100));
    preCacheCancelRef.current = false;

    const level = getCurrentEnergyLevel(config);
    const jobs = [];
    for (let i = 0; i < upcomingDancers.length; i++) {
      const d = upcomingDancers[i];
      jobs.push([ANNOUNCEMENT_TYPES.INTRO, d.name, null, 1]);
      jobs.push([ANNOUNCEMENT_TYPES.ROUND2, d.name, null, 2]);
      jobs.push([ANNOUNCEMENT_TYPES.OUTRO, d.name, null, 1]);
      if (d.nextName) {
        jobs.push([ANNOUNCEMENT_TYPES.TRANSITION, d.name, d.nextName, 1]);
      }
    }

    console.log(`🔄 Pre-cache upcoming: ${upcomingDancers.map(d => d.name).join(', ')} (${jobs.length} announcements, L${level})`);

    for (const [type, name, nextName, round] of jobs) {
      if (preCacheCancelRef.current) {
        console.log('🔄 Pre-cache cancelled (rotation changed)');
        return;
      }
      try {
        const result = await getOrGenerateAnnouncement(type, name, nextName, level, round);
        if (result.url?.startsWith('blob:')) URL.revokeObjectURL(result.url);
        if (!result.fromCache) {
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (err) {
        console.error(`Pre-cache failed for ${type}-${name}:`, err.message);
      }
    }
    if (!preCacheCancelRef.current) {
      console.log(`✅ Pre-cache upcoming complete`);
    }
  }, [getOrGenerateAnnouncement, elevenLabsApiKey]);

  const preCacheForRotationStart = useCallback(async (rotationDancers, onProgress, bufferCount = 2) => {
    const config = getApiConfig();
    if (!config.elevenLabsApiKey && !elevenLabsApiKey) {
      console.warn('⚠️ No ElevenLabs API key — skipping rotation pre-cache');
      return true;
    }
    preCacheCancelRef.current = false;

    const level = getCurrentEnergyLevel(config);
    const total = rotationDancers.length;
    if (total === 0) return true;

    const jobsPerDancer = total > 1 ? 4 : 3;
    const makeJobs = (dancerIdx) => {
      const d = rotationDancers[dancerIdx];
      const nextD = rotationDancers[(dancerIdx + 1) % total];
      const jobs = [
        { type: ANNOUNCEMENT_TYPES.INTRO, name: d.name, nextName: null, round: 1 },
        { type: ANNOUNCEMENT_TYPES.ROUND2, name: d.name, nextName: null, round: 2 },
        { type: ANNOUNCEMENT_TYPES.OUTRO, name: d.name, nextName: null, round: 1 },
      ];
      if (total > 1) {
        jobs.push({ type: ANNOUNCEMENT_TYPES.TRANSITION, name: d.name, nextName: nextD.name, round: 1 });
      }
      return jobs;
    };

    const bufferDancerCount = Math.min(bufferCount, total);
    const totalJobs = total * jobsPerDancer;

    console.log(`🔄 Rotation pre-cache: ${bufferDancerCount} entertainers to buffer, ${total - bufferDancerCount} background`);

    let bufferCompleted = 0;
    for (let di = 0; di < bufferDancerCount; di++) {
      if (preCacheCancelRef.current) return false;
      const jobs = makeJobs(di);
      for (const job of jobs) {
        if (preCacheCancelRef.current) return false;
        try {
          const result = await getOrGenerateAnnouncement(job.type, job.name, job.nextName, level, job.round);
          if (result.url?.startsWith('blob:')) URL.revokeObjectURL(result.url);
          if (!result.fromCache) await new Promise(r => setTimeout(r, 1500));
        } catch (err) {
          console.error(`Pre-cache failed for ${job.type}-${job.name}:`, err.message);
        }
        bufferCompleted++;
      }
      onProgress?.({ completed: bufferCompleted, total: totalJobs, dancersDone: di + 1, dancersTotal: total, phase: 'buffer' });
    }

    if (bufferDancerCount < total) {
      (async () => {
        let bgCompleted = bufferCompleted;
        for (let di = bufferDancerCount; di < total; di++) {
          if (preCacheCancelRef.current) return;
          const jobs = makeJobs(di);
          for (const job of jobs) {
            if (preCacheCancelRef.current) return;
            try {
              const result = await getOrGenerateAnnouncement(job.type, job.name, job.nextName, level, job.round);
              if (result.url?.startsWith('blob:')) URL.revokeObjectURL(result.url);
              if (!result.fromCache) await new Promise(r => setTimeout(r, 1500));
            } catch (err) {
              console.error(`Background pre-cache failed for ${job.type}-${job.name}:`, err.message);
            }
            bgCompleted++;
          }
          onProgress?.({ completed: bgCompleted, total: totalJobs, dancersDone: di + 1, dancersTotal: total, phase: 'background' });
        }
        console.log('✅ Background pre-cache complete for all entertainers');
      })();
    }

    return true;
  }, [getOrGenerateAnnouncement, elevenLabsApiKey]);

  React.useImperativeHandle(ref, () => ({
    playAutoAnnouncement: async (type, currentDancerName, nextDancerName = null, roundNumber = 1, audioOptions = {}) => {
      await playAnnouncement(type, currentDancerName, nextDancerName, roundNumber, audioOptions);
    },
    getAnnouncementUrl: async (type, dancerName, nextDancerName = null, roundNumber = 1) => {
      try {
        const config = getApiConfig();
        const level = getCurrentEnergyLevel(config);
        console.log(`🔄 Pre-fetching ${type} announcement for ${dancerName} (L${level})`);
        const result = await getOrGenerateAnnouncement(type, dancerName, nextDancerName, level, roundNumber);
        return result?.url || null;
      } catch (error) {
        console.error(`❌ Pre-fetch announcement failed:`, error.message);
        return null;
      }
    },
    preCacheDancer,
    preCacheUpcoming,
    preCacheForRotationStart
  }));

  const preCacheAll = useCallback(async () => {
    setIsPreCaching(true);
    setPreCacheProgress(0);
    setPreCacheETA(null);
    setPreCacheError(null);
    preCacheStartTimeRef.current = Date.now();

    const config = getApiConfig();
    const level = getCurrentEnergyLevel(config);
    const rotationDancers = rotation.map(id => dancers.find(d => d.id === id)).filter(Boolean);

    const genericTypes = [
      [ANNOUNCEMENT_TYPES.INTRO, GENERIC_DANCER_NAME, null, 1],
      [ANNOUNCEMENT_TYPES.ROUND2, GENERIC_DANCER_NAME, null, 2],
      [ANNOUNCEMENT_TYPES.OUTRO, GENERIC_DANCER_NAME, null, 1],
      [ANNOUNCEMENT_TYPES.TRANSITION, GENERIC_DANCER_NAME, null, 1],
    ];

    const dancerTypes = [];
    for (let i = 0; i < rotationDancers.length; i++) {
      const dancer = rotationDancers[i];
      const nextDancer = rotationDancers[(i + 1) % rotationDancers.length];
      dancerTypes.push([ANNOUNCEMENT_TYPES.INTRO, dancer.name, null, 1]);
      dancerTypes.push([ANNOUNCEMENT_TYPES.ROUND2, dancer.name, null, 2]);
      dancerTypes.push([ANNOUNCEMENT_TYPES.OUTRO, dancer.name, null, 1]);
      if (rotationDancers.length > 1) {
        dancerTypes.push([ANNOUNCEMENT_TYPES.TRANSITION, dancer.name, nextDancer.name, 1]);
      }
    }

    const allTypes = [...genericTypes, ...dancerTypes];
    const totalAnnouncements = allTypes.length;
    let completed = 0;
    let generatedCount = 0;

    const updateETA = () => {
      if (generatedCount === 0) return;
      const elapsed = Date.now() - preCacheStartTimeRef.current;
      const avgPerItem = elapsed / (completed || 1);
      const remaining = totalAnnouncements - completed;
      const etaSeconds = Math.ceil((remaining * avgPerItem) / 1000);
      if (etaSeconds < 60) {
        setPreCacheETA(`~${etaSeconds}s remaining`);
      } else {
        setPreCacheETA(`~${Math.ceil(etaSeconds / 60)}m remaining`);
      }
    };

    try {
      const BATCH_SIZE = 3;
      for (let i = 0; i < allTypes.length; i += BATCH_SIZE) {
        const batch = allTypes.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(([type, name, next, roundNum]) =>
            getOrGenerateAnnouncement(type, name, next, level, roundNum)
          )
        );
        for (const result of results) {
          completed++;
          if (result.status === 'fulfilled') {
            if (!result.value.fromCache) generatedCount++;
            if (result.value.fromCache && result.value.url?.startsWith('blob:')) {
              URL.revokeObjectURL(result.value.url);
            }
          }
          setPreCacheProgress((completed / totalAnnouncements) * 100);
          updateETA();
        }
        const hasNewGenerations = results.some(r => r.status === 'fulfilled' && !r.value.fromCache);
        if (hasNewGenerations) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error('Pre-cache failed:', error.message);
      setPreCacheError(error.message);
    } finally {
      setIsPreCaching(false);
      setPreCacheETA(null);
    }
  }, [rotation, dancers, getOrGenerateAnnouncement]);

  const currentDancer = rotation[currentDancerIndex]
    ? dancers.find(d => d.id === rotation[currentDancerIndex])
    : null;

  const nextDancer = rotation[(currentDancerIndex + 1) % rotation.length]
    ? dancers.find(d => d.id === rotation[(currentDancerIndex + 1) % rotation.length])
    : null;

  const config = getApiConfig();
  const currentLevel = getCurrentEnergyLevel(config);
  const levelInfo = ENERGY_LEVELS[currentLevel];

  if (hideUI) {
    return null;
  }

  return (
    <div className="bg-[#0d0d1f] rounded-xl border border-[#1e293b] p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-[#00d4ff]" />
          <h3 className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">
            Announcements
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="text-xs px-1.5 py-0"
            style={{ borderColor: levelInfo.color + '80', color: levelInfo.color }}
          >
            L{currentLevel}
          </Badge>
          <Badge
            variant="outline"
            className={isOnline ? 'border-green-500 text-green-400' : 'border-red-500 text-red-400'}
          >
            {isOnline ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
            {isOnline ? 'Online' : 'Offline'}
          </Badge>
        </div>
      </div>

      {serverCacheCount > 0 && (
        <div className="mb-3 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
          <div className="flex items-center gap-2">
            <HardDrive className="w-3 h-3 text-green-400" />
            <span className="text-xs text-green-400">
              {serverCacheCount} voiceovers saved to disk (no tokens used on replay)
            </span>
          </div>
        </div>
      )}

      <Button
        onClick={preCacheAll}
        disabled={isPreCaching || rotation.length === 0}
        className="w-full mb-4 bg-[#151528] hover:bg-[#1e293b] text-white border border-[#1e293b]"
      >
        {isPreCaching ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Caching... {Math.round(preCacheProgress)}%{preCacheETA ? ` (${preCacheETA})` : ''}
          </>
        ) : (
          <>
            <Download className="w-4 h-4 mr-2" />
            Pre-Cache All Announcements
          </>
        )}
      </Button>

      {isPreCaching && (
        <Progress value={preCacheProgress} className="mb-4" />
      )}

      {preCacheError && (
        <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
            <span className="text-xs text-red-400">{preCacheError}</span>
          </div>
        </div>
      )}

      {currentDancer && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Quick Announce</p>

          <div className="grid grid-cols-2 gap-2">
            {[
              { type: ANNOUNCEMENT_TYPES.INTRO, label: 'Intro', dancer: currentDancer.name },
              { type: ANNOUNCEMENT_TYPES.ROUND2, label: 'Round 2', dancer: currentDancer.name },
              { type: ANNOUNCEMENT_TYPES.OUTRO, label: 'Outro', dancer: currentDancer.name },
              ...(nextDancer ? [{ type: ANNOUNCEMENT_TYPES.TRANSITION, label: 'Transition', dancer: currentDancer.name, nextDancer: nextDancer.name }] : [])
            ].map(({ type, label, dancer, nextDancer: nd }) => {
              const ck = getCacheKey(type, dancer, nd, currentLevel);
              const isCached = cacheStatus[ck];
              return (
                <Button
                  key={type}
                  size="sm"
                  variant="outline"
                  className={`border-[#1e293b] text-gray-300 hover:bg-[#1e293b] hover:text-white justify-start ${isCached ? 'border-green-500/40' : ''}`}
                  onClick={() => playAnnouncement(type, dancer, nd, type === ANNOUNCEMENT_TYPES.ROUND2 ? 2 : 1)}
                  disabled={generatingType === type}
                >
                  {generatingType === type ? (
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                  ) : isCached ? (
                    <Check className="w-3 h-3 mr-2 text-green-400" />
                  ) : (
                    <Mic className="w-3 h-3 mr-2" />
                  )}
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {!currentDancer && (
        <div className="text-center py-4 text-gray-500 text-sm">
          <AlertCircle className="w-5 h-5 mx-auto mb-2 text-gray-600" />
          Start rotation to enable announcements
        </div>
      )}
    </div>
  );
});

AnnouncementSystem.displayName = 'AnnouncementSystem';

export default AnnouncementSystem;
