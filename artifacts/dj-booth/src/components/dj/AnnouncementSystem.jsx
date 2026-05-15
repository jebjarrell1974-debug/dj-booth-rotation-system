import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Mic, Download, Wifi, WifiOff, Loader2, Check, AlertCircle, HardDrive } from 'lucide-react';
import { localIntegrations } from '@/api/localEntities';
import { getApiConfig } from '@/components/apiConfig';
import { VOICE_SETTINGS, buildAnnouncementPrompt } from '@/utils/energyLevels';
import { trackOpenAICall, trackElevenLabsCall, estimateTokens } from '@/utils/apiCostTracker';

const getAuthHeaders = () => {
  const token = localStorage.getItem('djbooth_token');
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

const deleteFromIndexedDB = async (key) => {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
};

const validateAudioBlob = async (blob) => {
  if (!blob || blob.size < 5000) return false;
  let ctx;
  try {
    const arrayBuffer = await blob.arrayBuffer();
    ctx = new AudioContext();
    await ctx.decodeAudioData(arrayBuffer);
    return true;
  } catch {
    return false;
  } finally {
    if (ctx) ctx.close().catch(() => {});
  }
};

const splitScriptIntoChunks = (script, targetWords = 40) => {
  const sentences = script.match(/[^.!?]+[.!?]+/g) || [script];
  const chunks = [];
  let current = [];
  let wordCount = 0;
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).length;
    if (wordCount + words > targetWords && current.length > 0) {
      chunks.push(current.join(' ').trim());
      current = [sentence.trim()];
      wordCount = words;
    } else {
      current.push(sentence.trim());
      wordCount += words;
    }
  }
  if (current.length > 0) chunks.push(current.join(' ').trim());
  return chunks.filter(c => c.length > 0);
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

const withRetry = async (fn, maxAttempts = 3, baseDelayMs = 3000) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err?.message || '';
      const isTerminal = msg.includes('401') || msg.includes('403') || msg.includes('API key');
      if (isTerminal || attempt === maxAttempts) break;
      const is429 = msg.includes('429') || msg.includes('Rate limit');
      const delay = is429 ? 6000 : baseDelayMs;
      console.warn(`⚠️ Attempt ${attempt}/${maxAttempts} failed (${msg.substring(0, 80)}). Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
};

const CURRENT_VOICE_VERSION = 'V13';

const hashPhonetic = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h, 33) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
};

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
};

const GENERIC_DANCER_NAME = '_GENERIC_';
const NUM_VARIATIONS = 5;
const LOCKED_LEVEL = 4;

const AnnouncementSystem = React.forwardRef((props, ref) => {
  const {
    dancers,
    rotation,
    currentDancerIndex,
    onPlay,
    elevenLabsApiKey,
    openaiApiKey,
    hideUI = false,
    onVoiceDiag,
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
  const variationCounterRef = useRef({});
  const failedGenerationsRef = useRef(new Set());
  const lastPlayedTypeVariantRef = useRef({ intro: 0, outro: 0, round2: 0 });
  const currentSetIntroVariantRef = useRef({});

  const getNextVariationNum = useCallback((type, dancerName, nextDancerName = null) => {
    const k = `${type}-${dancerName}${nextDancerName ? `-${nextDancerName}` : ''}`;
    const lastForKey = variationCounterRef.current[k] || 0;

    const avoid = new Set();
    avoid.add(lastForKey);

    if (type === 'intro') {
      avoid.add(lastPlayedTypeVariantRef.current.outro);
    }
    if (type === 'outro') {
      avoid.add(lastPlayedTypeVariantRef.current.intro);
      const setIntroVariant = currentSetIntroVariantRef.current[dancerName];
      if (setIntroVariant) avoid.add(setIntroVariant);
    }

    avoid.delete(0);

    const candidates = [];
    for (let i = 1; i <= NUM_VARIATIONS; i++) {
      if (!avoid.has(i)) candidates.push(i);
    }
    const pool = candidates.length > 0 ? candidates
      : Array.from({ length: NUM_VARIATIONS }, (_, i) => i + 1).filter(i => i !== lastForKey);

    const next = pool[Math.floor(Math.random() * pool.length)];
    variationCounterRef.current[k] = next;
    lastPlayedTypeVariantRef.current[type] = next;

    if (type === 'intro') {
      currentSetIntroVariantRef.current[dancerName] = next;
    }

    return next;
  }, []);

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


  const generateScript = useCallback(async (type, dancerName, nextDancerName = null, roundNumber = 1, varNum = 1) => {
    const config = getApiConfig();
    const prompt = buildAnnouncementPrompt(type, dancerName, nextDancerName, LOCKED_LEVEL, roundNumber, varNum);

    const openaiKey = config.openaiApiKey || '';
    const scriptModel = config.scriptModel || 'auto';

    if (openaiKey && scriptModel !== 'auto') {
      return await withRetry(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
          const res = await fetch('/api/openai/chat', {
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
        } catch (err) {
          clearTimeout(timeout);
          throw err;
        }
      });
    }

    const response = await localIntegrations.Core.InvokeLLM({ prompt });
    return parseResponse(response);
  }, []);

  const generateAudio = useCallback(async (script) => {
    const config = getApiConfig();
    const apiKey = config.elevenLabsApiKey || elevenLabsApiKey;
    if (!apiKey) {
      throw new Error('ElevenLabs API key not configured - check settings');
    }

    const voiceId = config.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM';
    const voiceSettings = VOICE_SETTINGS[LOCKED_LEVEL];

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
    let ttsText = script;
    // Case-insensitive normalize: catch "vip", "Vip", "VIP", "vip's" etc.
    // and spell them out directly. ElevenLabs reads "vip" as a word otherwise.
    for (const acronym of SPELL_OUT) {
      const spelled = acronym.split('').join('.') + '.';
      ttsText = ttsText.replace(
        new RegExp(`\\b${acronym}('[Ss])?\\b`, 'gi'),
        (_m, suffix) => spelled + (suffix || '')
      );
    }
    // Existing all-caps pass: handles other acronyms (USA → Usa) and any
    // SPELL_OUT entry that somehow wasn't caught above.
    ttsText = ttsText.replace(/\b([A-Z]{2,}(?:'[Ss])?)\b/g, (match) => {
      const base = match.replace(/'[Ss]$/, '');
      const suffix = match.slice(base.length);
      if (SPELL_OUT.has(base)) return base.split('').join('.') + '.' + suffix;
      return base.charAt(0) + base.slice(1).toLowerCase() + suffix;
    });
    for (const [name, phonetic] of Object.entries(pronunciationMap)) {
      ttsText = ttsText.replace(new RegExp(`\\b${name}\\b`, 'gi'), phonetic);
    }

    return await withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey
          },
          body: JSON.stringify({
            text: ttsText,
            model_id: 'eleven_v3',
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

        trackElevenLabsCall({ text: ttsText, model: 'eleven_v3', context: 'announcement-tts' });
        return await response.blob();
      } catch (err) {
        clearTimeout(timeout);
        throw err;
      }
    });
  }, [elevenLabsApiKey]);

  const getAnnouncementKey = (type, dancerName, nextDancerName = null, varNum = 1, phonetic = null) => {
    const ph = phonetic ? `-ph${hashPhonetic(phonetic)}` : '';
    return `${type}-${dancerName}${nextDancerName ? `-${nextDancerName}` : ''}${ph}-var${varNum}-${CURRENT_VOICE_VERSION}`;
  };

  const getLegacyL4Key = (type, dancerName, nextDancerName = null) => {
    return `${type}-${dancerName}${nextDancerName ? `-${nextDancerName}` : ''}-L4-${CURRENT_VOICE_VERSION}`;
  };

  const getKeyForDancer = (type, dancerName, nextDancerName = null, varNum = 1) => {
    const d = (dancers || []).find(dn => dn.name === dancerName);
    const phonetic = d?.phonetic_name || null;
    return getAnnouncementKey(type, dancerName, nextDancerName, varNum, phonetic);
  };

  const getCacheKey = (type, dancerName, nextDancerName = null, varNum = 1) => {
    return getKeyForDancer(type, dancerName, nextDancerName, varNum);
  };

  const saveToServer = useCallback(async (cacheKey, audioBlob, script, type, dancerName, energyLevel) => {
    try {
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
        })
      });
      if (res.ok) {
        console.log(`💾 Saved voiceover to server: ${cacheKey}`);
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

  const checkServerCacheMeta = useCallback(async (cacheKey) => {
    try {
      const res = await fetch(`/api/voiceovers/check/${encodeURIComponent(cacheKey)}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
      return { exists: false, day_of_week: null };
    } catch {
      return { exists: false, day_of_week: null };
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

  const findCachedAtAnyVariation = useCallback(async (type, dancerName, nextDancerName) => {
    const keysToCheck = [
      ...Array.from({ length: NUM_VARIATIONS }, (_, i) => getKeyForDancer(type, dancerName, nextDancerName, i + 1)),
      getLegacyL4Key(type, dancerName, nextDancerName),
    ];
    for (const altKey of keysToCheck) {
      const meta = await checkServerCacheMeta(altKey);
      if (meta.exists) {
        const idb = await getCachedFromIndexedDB(altKey);
        if (idb) {
          console.log(`✅ Found cached ${type} for ${dancerName} at ${altKey} (IndexedDB)`);
          return { url: URL.createObjectURL(idb), fromCache: true };
        }
        const serverBlob = await loadFromServer(altKey);
        if (serverBlob) {
          await cacheToIndexedDB(altKey, serverBlob);
          return { url: URL.createObjectURL(serverBlob), fromCache: true };
        }
      } else {
        const idb = await getCachedFromIndexedDB(altKey);
        if (idb) {
          console.log(`✅ Found cached ${type} for ${dancerName} at ${altKey} (IndexedDB only)`);
          return { url: URL.createObjectURL(idb), fromCache: true };
        }
      }
    }
    return null;
  }, [loadFromServer, checkServerCacheMeta]);

  const genericIndexRef = useRef({ intro: 0, round2: 0, outro: 0 });

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

  const getOrGenerateAnnouncement = useCallback(async (type, dancerName, nextDancerName = null, varNum = 1, roundNumber = 1) => {
    const key = getKeyForDancer(type, dancerName, nextDancerName, varNum);

    const customBlob = await checkCustomRecording(dancerName, type);
    if (customBlob) {
      console.log(`🎤 Using custom recording for ${dancerName}/${type} (skipping AI TTS)`);
      return { url: URL.createObjectURL(customBlob), fromCache: true };
    }

    const idbCached = await getCachedFromIndexedDB(key);
    if (idbCached) {
      console.log(`✅ Loaded from IndexedDB: ${key}`);
      setCacheStatus(prev => ({ ...prev, [key]: true }));
      return { url: URL.createObjectURL(idbCached), fromCache: true };
    }

    const serverBlob = await loadFromServer(key);
    if (serverBlob) {
      await cacheToIndexedDB(key, serverBlob);
      setCacheStatus(prev => ({ ...prev, [key]: true }));
      return { url: URL.createObjectURL(serverBlob), fromCache: true };
    }

    if (varNum === 1) {
      const legacyKey = getLegacyL4Key(type, dancerName, nextDancerName);
      const legacyIdb = await getCachedFromIndexedDB(legacyKey);
      if (legacyIdb) {
        console.log(`✅ Migrating legacy L4 voiceover → var1 for ${dancerName}/${type}`);
        await cacheToIndexedDB(key, legacyIdb);
        setCacheStatus(prev => ({ ...prev, [key]: true }));
        return { url: URL.createObjectURL(legacyIdb), fromCache: true };
      }
      const legacyBlob = await loadFromServer(legacyKey);
      if (legacyBlob) {
        console.log(`✅ Migrating legacy L4 voiceover → var1 for ${dancerName}/${type} (server)`);
        await cacheToIndexedDB(key, legacyBlob);
        setCacheStatus(prev => ({ ...prev, [key]: true }));
        return { url: URL.createObjectURL(legacyBlob), fromCache: true };
      }
    }

    if (dancerName !== GENERIC_DANCER_NAME) {
      const anyCached = await findCachedAtAnyVariation(type, dancerName, nextDancerName);
      if (anyCached) {
        console.log(`✅ Serving cached var for ${dancerName}/${type} (var${varNum} not cached — skipping ElevenLabs call)`);
        return anyCached;
      }
    }

    const failKey = `${type}-${dancerName}${nextDancerName ? `-${nextDancerName}` : ''}`;
    if (failedGenerationsRef.current.has(failKey)) {
      console.log(`⏭️ Skipping generation for ${failKey} — failed earlier this session, using fallback`);
      const anyVariation = dancerName !== GENERIC_DANCER_NAME ? await findCachedAtAnyVariation(type, dancerName, nextDancerName) : null;
      if (anyVariation) return anyVariation;
      const anyGeneric = await findCachedAtAnyVariation(type, GENERIC_DANCER_NAME, null);
      if (anyGeneric) return anyGeneric;
      const genericRecording = await checkGenericRecording(type);
      if (genericRecording) return { url: URL.createObjectURL(genericRecording), fromCache: true };
      throw new Error(`Generation skipped (failed earlier this session): ${failKey}`);
    }

    try {
      console.log(`🎙️ Generating announcement: ${key} (var${varNum})`);
      setGeneratingType(type);
      const script = await generateScript(type, dancerName, nextDancerName, roundNumber, varNum);

      // Chunk-and-stitch via server FFmpeg — prevents ElevenLabs corrupt blob artifacts (backwards/garbled audio)
      const scriptChunks = splitScriptIntoChunks(script);
      console.log(`🎙️ Generating ${scriptChunks.length} chunk(s) for ${key}...`);
      const chunkBase64s = [];
      for (let i = 0; i < scriptChunks.length; i++) {
        const chunkBlob = await generateAudio(scriptChunks[i]);
        chunkBase64s.push(await blobToBase64(chunkBlob));
      }
      const stitchRes = await fetch('/api/voiceovers/stitch-chunks', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunks: chunkBase64s }),
      });
      if (!stitchRes.ok) throw new Error(`Stitch failed: ${stitchRes.status}`);
      const { audio_base64 } = await stitchRes.json();
      const rawBytes = atob(audio_base64);
      const byteArr = new Uint8Array(rawBytes.length);
      for (let i = 0; i < rawBytes.length; i++) byteArr[i] = rawBytes.charCodeAt(i);
      const audioBlob = new Blob([byteArr], { type: 'audio/mpeg' });

      await cacheToIndexedDB(key, audioBlob);
      await saveToServer(key, audioBlob, script, type, dancerName, LOCKED_LEVEL);

      setCacheStatus(prev => ({ ...prev, [key]: true }));
      setServerCacheCount(prev => prev + 1);
      setGeneratingType(null);

      console.log(`✅ Generated announcement: ${key} (var${varNum}) — saved to server`);
      return { url: URL.createObjectURL(audioBlob), fromCache: false };
    } catch (genError) {
      setGeneratingType(null);
      failedGenerationsRef.current.add(failKey);
      const isTimeout = genError.name === 'AbortError' || genError.message?.toLowerCase().includes('abort');
      onVoiceDiag?.(isTimeout ? 'voice_timeout' : 'voice_generate_fail', { dancer: dancerName, voiceType: type, error: (genError.message || '').substring(0, 80) });
      console.warn(`⚠️ Could not generate ${type} for ${dancerName}: ${genError.message}, trying fallbacks... (will skip retries this session)`);
      if (dancerName !== GENERIC_DANCER_NAME) {
        const anyVariation = await findCachedAtAnyVariation(type, dancerName, nextDancerName);
        if (anyVariation) {
          console.log(`✅ Using ${dancerName} cached ${type} from another variation (fallback)`);
          return anyVariation;
        }
        const anyGeneric = await findCachedAtAnyVariation(type, GENERIC_DANCER_NAME, null);
        if (anyGeneric) {
          console.log(`✅ Using generic fallback from any variation for ${type}`);
          return anyGeneric;
        }
      } else {
        const anyGenericVariation = await findCachedAtAnyVariation(type, GENERIC_DANCER_NAME, null);
        if (anyGenericVariation) {
          console.log(`✅ Using generic fallback from any variation for ${type}`);
          return anyGenericVariation;
        }
      }
      const genericRecording = await checkGenericRecording(type);
      if (genericRecording) {
        console.log(`🎤 Last-resort generic pre-recorded ${type} voiceover used`);
        onVoiceDiag?.('voice_fallback_generic', { dancer: dancerName, voiceType: type });
        return { url: URL.createObjectURL(genericRecording), fromCache: true };
      }
      console.error(`❌ No announcement available for ${type}: ${genError.message}`);
      throw genError;
    }
  }, [generateScript, generateAudio, findCachedAtAnyVariation, saveToServer, loadFromServer, checkCustomRecording, checkGenericRecording, checkServerCacheMeta, onVoiceDiag]);

  const playAnnouncement = useCallback(async (type, dancerName, nextDancerName = null, roundNumber = 1, audioOptions = {}) => {
    try {
      const varNum = getNextVariationNum(type, dancerName, nextDancerName);
      console.log(`📢 AnnouncementSystem: Playing ${type} for ${dancerName} (var${varNum}, Round ${roundNumber})`);
      const result = await getOrGenerateAnnouncement(type, dancerName, nextDancerName, varNum, roundNumber);
      console.log(`📢 AnnouncementSystem: Got audio URL (cached=${result.fromCache}), playing...`);
      try {
        await onPlay?.(result.url, audioOptions);
        console.log(`📢 AnnouncementSystem: Playback complete`);
      } catch (playError) {
        const cacheKey = `${type}-${dancerName}${nextDancerName ? `-${nextDancerName}` : ''}-var${varNum}-${CURRENT_VOICE_VERSION}`;
        console.warn(`⚠️ Playback failed for ${cacheKey} — clearing local cache, trying server copy first...`, playError.message);
        onVoiceDiag?.('voice_play_fail', { dancer: dancerName, voiceType: type, error: (playError.message || '').substring(0, 80) });
        await deleteFromIndexedDB(cacheKey);
        let recovered = false;
        try {
          const serverBlob = await loadFromServer(cacheKey);
          if (serverBlob) {
            const serverUrl = URL.createObjectURL(serverBlob);
            try {
              await onPlay?.(serverUrl, audioOptions);
              console.log(`📢 AnnouncementSystem: Playback complete (recovered from server copy — local cache was the issue)`);
              onVoiceDiag?.('voice_play_recovered', { dancer: dancerName, voiceType: type });
              recovered = true;
            } finally {
              URL.revokeObjectURL(serverUrl);
            }
          }
        } catch {}
        if (!recovered) {
          console.warn(`⚠️ Server copy also failed for ${cacheKey} — now deleting server file and regenerating`);
          try {
            await fetch(`/api/voiceovers/${encodeURIComponent(cacheKey)}`, { method: 'DELETE', headers: getAuthHeaders() });
          } catch {}
          try {
            const fresh = await getOrGenerateAnnouncement(type, dancerName, nextDancerName, varNum, roundNumber);
            await onPlay?.(fresh.url, audioOptions);
            console.log(`📢 AnnouncementSystem: Playback complete (recovered after confirmed-bad file regeneration)`);
            onVoiceDiag?.('voice_play_recovered', { dancer: dancerName, voiceType: type });
          } catch (retryError) {
            console.error(`❌ Playback still failed after regeneration — skipping:`, retryError.message);
            onVoiceDiag?.('voice_play_dead', { dancer: dancerName, voiceType: type, error: (retryError.message || '').substring(0, 80) });
          }
        }
      }
    } catch (error) {
      console.error(`❌ AnnouncementSystem Error (silent fallback):`, error.message);
      console.warn(`Announcement skipped: ${error.message} — music continues uninterrupted`);
      onVoiceDiag?.('voice_skipped', { dancer: dancerName, voiceType: type, error: (error.message || '').substring(0, 80) });
    }
  }, [getOrGenerateAnnouncement, getNextVariationNum, onPlay, onVoiceDiag]);

  const preCacheDancer = useCallback(async (dancerName) => {
    const config = getApiConfig();
    if (!config.elevenLabsApiKey && !elevenLabsApiKey) {
      console.warn('⚠️ No ElevenLabs API key configured - skipping pre-cache');
      return;
    }
    console.log(`🔄 Pre-caching ${NUM_VARIATIONS} variations for: ${dancerName}`);
    const types = [ANNOUNCEMENT_TYPES.INTRO, ANNOUNCEMENT_TYPES.ROUND2, ANNOUNCEMENT_TYPES.OUTRO];
    for (const type of types) {
      for (let v = 1; v <= NUM_VARIATIONS; v++) {
        try {
          const result = await getOrGenerateAnnouncement(type, dancerName, null, v, type === ANNOUNCEMENT_TYPES.ROUND2 ? 2 : 1);
          if (result.url?.startsWith('blob:')) URL.revokeObjectURL(result.url);
          if (!result.fromCache) {
            await new Promise(resolve => setTimeout(resolve, 6000));
          }
        } catch (err) {
          console.error(`Pre-cache failed for ${type}-${dancerName} var${v}:`, err.message);
        }
      }
    }
    console.log(`✅ Pre-cache complete for: ${dancerName} (${NUM_VARIATIONS} variations per type)`);
  }, [getOrGenerateAnnouncement, elevenLabsApiKey]);

  const preCacheCancelRef = useRef(false);
  // MUST equal NUM_VARIATIONS — the random picker (line ~226) chooses from 1..NUM_VARIATIONS,
  // so any value lower than NUM_VARIATIONS leaves a (NUM_VARIATIONS-this)/NUM_VARIATIONS chance
  // of cache-miss → fresh ElevenLabs gen → 2-5s of silence at dancer changeover.
  // Was 3 with NUM_VARIATIONS=5 → 40% miss rate ("not every girl, but noticeable" — 003 May 8).
  // Trade-off: cold-cache pre-warm goes from ~54s to ~90s per dancer, but only on first-ever
  // rotation per dancer; subsequent rotations are all cache hits and finish in seconds.
  const UPCOMING_CACHE_VARIATIONS = 5;

  const preCacheUpcoming = useCallback(async (upcomingDancers) => {
    const config = getApiConfig();
    if (!config.elevenLabsApiKey && !elevenLabsApiKey) return;
    if (!upcomingDancers || upcomingDancers.length === 0) return;

    preCacheCancelRef.current = true;
    await new Promise(r => setTimeout(r, 100));
    preCacheCancelRef.current = false;

    const makeNextJobs = (dancer) => {
      const jobs = [];
      for (let v = 1; v <= UPCOMING_CACHE_VARIATIONS; v++) {
        jobs.push([ANNOUNCEMENT_TYPES.INTRO, dancer.name, null, v, 1]);
        jobs.push([ANNOUNCEMENT_TYPES.ROUND2, dancer.name, null, v, 2]);
        jobs.push([ANNOUNCEMENT_TYPES.OUTRO, dancer.name, null, v, 1]);
      }
      return jobs;
    };

    const nextDancer = upcomingDancers[0];
    const jobs = makeNextJobs(nextDancer);
    console.log(`🔄 Pre-cache next entertainer: ${nextDancer.name} (${jobs.length} jobs — ${UPCOMING_CACHE_VARIATIONS} variations × 3 types)`);

    for (const [type, name, nextName, varNum, round] of jobs) {
      if (preCacheCancelRef.current) {
        console.log('🔄 Pre-cache cancelled (rotation changed)');
        return;
      }
      try {
        const result = await getOrGenerateAnnouncement(type, name, nextName, varNum, round);
        if (result.url?.startsWith('blob:')) URL.revokeObjectURL(result.url);
        if (!result.fromCache) {
          await new Promise(r => setTimeout(r, 6000));
        }
      } catch (err) {
        console.error(`Pre-cache failed for ${type}-${name} var${varNum}:`, err.message);
      }
    }

    if (!preCacheCancelRef.current) {
      console.log(`✅ Pre-cache complete: ${nextDancer.name}`);
    }

    if (upcomingDancers.length > 1 && !preCacheCancelRef.current) {
      const secondDancer = upcomingDancers[1];
      const bgJobs = makeNextJobs(secondDancer);
      console.log(`🔄 Background pre-cache: ${secondDancer.name}`);
      (async () => {
        for (const [type, name, nextName, varNum, round] of bgJobs) {
          if (preCacheCancelRef.current) return;
          try {
            const result = await getOrGenerateAnnouncement(type, name, nextName, varNum, round);
            if (result.url?.startsWith('blob:')) URL.revokeObjectURL(result.url);
            if (!result.fromCache) await new Promise(r => setTimeout(r, 6000));
          } catch (err) {
            console.error(`Background pre-cache failed for ${type}-${name} var${varNum}:`, err.message);
          }
        }
        if (!preCacheCancelRef.current) console.log(`✅ Background pre-cache complete: ${secondDancer.name}`);
      })();
    }
  }, [getOrGenerateAnnouncement, elevenLabsApiKey]);

  const preCacheForRotationStart = useCallback(async (rotationDancers, onProgress, bufferCount = 2) => {
    const config = getApiConfig();
    if (!config.elevenLabsApiKey && !elevenLabsApiKey) {
      console.warn('⚠️ No ElevenLabs API key — skipping rotation pre-cache');
      return true;
    }
    preCacheCancelRef.current = false;

    const total = rotationDancers.length;
    if (total === 0) return true;

    const typesPerDancer = 3;
    const jobsPerDancer = typesPerDancer * UPCOMING_CACHE_VARIATIONS;
    const makeJobs = (dancerIdx) => {
      const d = rotationDancers[dancerIdx];
      const jobs = [];
      for (let v = 1; v <= UPCOMING_CACHE_VARIATIONS; v++) {
        jobs.push({ type: ANNOUNCEMENT_TYPES.INTRO, name: d.name, nextName: null, round: 1, varNum: v });
        jobs.push({ type: ANNOUNCEMENT_TYPES.ROUND2, name: d.name, nextName: null, round: 2, varNum: v });
        jobs.push({ type: ANNOUNCEMENT_TYPES.OUTRO, name: d.name, nextName: null, round: 1, varNum: v });
      }
      return jobs;
    };

    const bufferDancerCount = Math.min(bufferCount, total);
    const totalJobs = bufferDancerCount * jobsPerDancer;

    console.log(`🔄 Rotation pre-cache: ${bufferDancerCount} entertainers foreground, ${total - bufferDancerCount} on-demand (${UPCOMING_CACHE_VARIATIONS} variations × 3 types each)`);

    let bufferCompleted = 0;
    for (let di = 0; di < bufferDancerCount; di++) {
      if (preCacheCancelRef.current) return false;
      const jobs = makeJobs(di);
      for (const job of jobs) {
        if (preCacheCancelRef.current) return false;
        try {
          const result = await getOrGenerateAnnouncement(job.type, job.name, job.nextName, job.varNum, job.round);
          if (result.url?.startsWith('blob:')) URL.revokeObjectURL(result.url);
          if (!result.fromCache) await new Promise(r => setTimeout(r, 6000));
        } catch (err) {
          console.error(`Pre-cache failed for ${job.type}-${job.name} var${job.varNum}:`, err.message);
        }
        bufferCompleted++;
      }
      onProgress?.({ completed: bufferCompleted, total: totalJobs, dancersDone: di + 1, dancersTotal: bufferDancerCount, phase: 'buffer' });
    }

    return true;
  }, [getOrGenerateAnnouncement, elevenLabsApiKey]);

  const resetAndRegenerateDancer = useCallback(async (dancerName) => {
    if (!dancerName) return { deleted: 0 };
    let deletedCount = 0;

    try {
      const res = await fetch(`/api/voiceovers/dancer/${encodeURIComponent(dancerName)}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        deletedCount = data.deleted || 0;
        console.log(`🧹 Reset: deleted ${deletedCount} server voiceovers for "${dancerName}"`);
      }
    } catch (e) {
      console.error('Reset: server delete failed:', e);
    }

    try {
      const db = await openDB();
      const allKeys = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const matches = allKeys.filter(k => typeof k === 'string' && k.includes(dancerName));
      if (matches.length) {
        const tx2 = db.transaction(STORE_NAME, 'readwrite');
        const store = tx2.objectStore(STORE_NAME);
        for (const key of matches) store.delete(key);
        await new Promise((resolve) => { tx2.oncomplete = resolve; tx2.onerror = resolve; });
      }
      console.log(`🧹 Reset: cleared ${matches.length} IndexedDB entries for "${dancerName}"`);
    } catch (e) {
      console.error('Reset: IDB wipe failed:', e);
    }

    setCacheStatus(prev => {
      const next = {};
      for (const [k, v] of Object.entries(prev)) {
        if (!k.includes(dancerName)) next[k] = v;
      }
      return next;
    });

    for (const failKey of Array.from(failedGenerationsRef.current)) {
      if (failKey.includes(dancerName)) failedGenerationsRef.current.delete(failKey);
    }

    console.log(`🔄 Reset complete for "${dancerName}" — regenerating fresh voiceovers...`);
    preCacheDancer(dancerName).catch(e => console.error('Reset: regenerate failed:', e));

    return { deleted: deletedCount };
  }, [preCacheDancer]);

  React.useImperativeHandle(ref, () => ({
    playAutoAnnouncement: async (type, currentDancerName, nextDancerName = null, roundNumber = 1, audioOptions = {}) => {
      await playAnnouncement(type, currentDancerName, nextDancerName, roundNumber, audioOptions);
    },
    getAnnouncementUrl: async (type, dancerName, nextDancerName = null, roundNumber = 1) => {
      try {
        const varNum = getNextVariationNum(type, dancerName, nextDancerName);
        console.log(`🔄 Pre-fetching ${type} announcement for ${dancerName} (var${varNum})`);
        const result = await getOrGenerateAnnouncement(type, dancerName, nextDancerName, varNum, roundNumber);
        return result?.url || null;
      } catch (error) {
        console.error(`❌ Pre-fetch announcement failed:`, error.message);
        return null;
      }
    },
    preCacheDancer,
    preCacheUpcoming,
    preCacheForRotationStart,
    resetAndRegenerateDancer
  }));

  const preCacheAll = useCallback(async () => {
    setIsPreCaching(true);
    setPreCacheProgress(0);
    setPreCacheETA(null);
    setPreCacheError(null);
    preCacheStartTimeRef.current = Date.now();

    const rotationDancers = rotation.map(id => dancers.find(d => d.id === id)).filter(Boolean);

    const genericTypes = [
      [ANNOUNCEMENT_TYPES.INTRO, GENERIC_DANCER_NAME, null, 1, 1],
      [ANNOUNCEMENT_TYPES.ROUND2, GENERIC_DANCER_NAME, null, 1, 2],
      [ANNOUNCEMENT_TYPES.OUTRO, GENERIC_DANCER_NAME, null, 1, 1],
    ];

    const dancerTypes = [];
    for (let i = 0; i < rotationDancers.length; i++) {
      const dancer = rotationDancers[i];
      for (let v = 1; v <= NUM_VARIATIONS; v++) {
        dancerTypes.push([ANNOUNCEMENT_TYPES.INTRO, dancer.name, null, v, 1]);
        dancerTypes.push([ANNOUNCEMENT_TYPES.ROUND2, dancer.name, null, v, 2]);
        dancerTypes.push([ANNOUNCEMENT_TYPES.OUTRO, dancer.name, null, v, 1]);
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
      for (const [type, name, next, varNum, roundNum] of allTypes) {
        let fromCache = true;
        try {
          const result = await getOrGenerateAnnouncement(type, name, next, varNum, roundNum);
          fromCache = result.fromCache;
          if (!fromCache) generatedCount++;
          if (fromCache && result.url?.startsWith('blob:')) {
            URL.revokeObjectURL(result.url);
          }
        } catch {}
        completed++;
        setPreCacheProgress((completed / totalAnnouncements) * 100);
        updateETA();
        if (!fromCache) {
          await new Promise(resolve => setTimeout(resolve, 6000));
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
            ].map(({ type, label, dancer, nextDancer: nd }) => {
              const ck = getCacheKey(type, dancer, nd, 1);
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
