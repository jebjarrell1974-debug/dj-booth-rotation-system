import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';

const MAX_SONG_DURATION = 180;
const MAX_FEATURE_DURATION = 3600;
const TRANSITION_LEAD_TIME = 15;
const CROSSFADE_DURATION = 5;
const SAFETY_FADE_SECONDS = 5;
const MICRO_CROSSFADE_DURATION = 1.2;

const DUCK_LEVEL = 0.18;
const DUCK_ATTACK_MS = 200;
const DUCK_RELEASE_MS = 600;

const NEAR_END_SECONDS = 3;

const AUTO_GAIN_TARGET_LUFS = -10;
const AUTO_GAIN_ANALYSIS_SECONDS = 10;
const AUTO_GAIN_MIN = 0.3;
const AUTO_GAIN_MAX = 2.5;

const AudioEngine = forwardRef(({ 
  onTrackEnd, 
  onTimeUpdate, 
  onTrackChange,
  musicFolder 
}, ref) => {
  const audioCtxRef = useRef(null);
  const deckARef = useRef(null);
  const deckBRef = useRef(null);
  const deckASourceRef = useRef(null);
  const deckBSourceRef = useRef(null);
  const deckAGainRef = useRef(null);
  const deckBGainRef = useRef(null);
  const musicBusGainRef = useRef(null);
  const limiterRef = useRef(null);
  const masterGainRef = useRef(null);
  const voiceElRef = useRef(null);
  const voiceGainRef = useRef(null);
  const voiceSourceRef = useRef(null);
  const voiceSourceElRef = useRef(null);
  const voiceGainLevel = useRef(1.5);
  const autoGainEnabledRef = useRef(true);
  const autoGainCacheRef = useRef(new Map());

  const beatMatchEnabledRef = useRef((() => {
    try { return localStorage.getItem('neonaidj_beat_match') === 'true'; } catch { return false; }
  })());
  const bpmCacheRef = useRef(new Map());
  const activeDeckBpmRef = useRef(null);

  const musicEqBassRef = useRef(null);
  const musicEqMidRef = useRef(null);
  const musicEqTrebleRef = useRef(null);
  const voiceEqBassRef = useRef(null);
  const voiceEqMidRef = useRef(null);
  const voiceEqTrebleRef = useRef(null);

  const activeDeck = useRef('A');
  const masterVolume = useRef(0.8);
  const isPlayingRef = useRef(false);
  const isDucked = useRef(false);
  const crossfadeInProgressRef = useRef(false);
  const playTrackLockRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const fadeAnimationRef = useRef(null);
  const safetyFadeRef = useRef(null);
  const lastTimeUpdateRef = useRef(0);

  const deckAUrl = useRef(null);
  const deckBUrl = useRef(null);

  const maxDurationOverrideRef = useRef(null);

  const onTrackEndRef = useRef(onTrackEnd);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onTrackChangeRef = useRef(onTrackChange);
  useEffect(() => { onTrackEndRef.current = onTrackEnd; }, [onTrackEnd]);
  useEffect(() => { onTimeUpdateRef.current = onTimeUpdate; }, [onTimeUpdate]);
  useEffect(() => { onTrackChangeRef.current = onTrackChange; }, [onTrackChange]);

  const deckASourceElRef = useRef(null);
  const deckBSourceElRef = useRef(null);

  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioContext();

      masterGainRef.current = audioCtxRef.current.createGain();
      masterGainRef.current.gain.value = masterVolume.current;
      masterGainRef.current.connect(audioCtxRef.current.destination);

      limiterRef.current = audioCtxRef.current.createDynamicsCompressor();
      limiterRef.current.threshold.value = -6;
      limiterRef.current.knee.value = 3;
      limiterRef.current.ratio.value = 20;
      limiterRef.current.attack.value = 0.002;
      limiterRef.current.release.value = 0.1;
      limiterRef.current.connect(masterGainRef.current);

      const savedMusicEq = JSON.parse(localStorage.getItem('neonaidj_music_eq') || '{"bass":0,"mid":0,"treble":0}');
      const savedVoiceEq = JSON.parse(localStorage.getItem('neonaidj_voice_eq') || '{"bass":0,"mid":0,"treble":0}');

      musicEqBassRef.current = audioCtxRef.current.createBiquadFilter();
      musicEqBassRef.current.type = 'lowshelf';
      musicEqBassRef.current.frequency.value = 200;
      musicEqBassRef.current.gain.value = savedMusicEq.bass;

      musicEqMidRef.current = audioCtxRef.current.createBiquadFilter();
      musicEqMidRef.current.type = 'peaking';
      musicEqMidRef.current.frequency.value = 1000;
      musicEqMidRef.current.Q.value = 1.0;
      musicEqMidRef.current.gain.value = savedMusicEq.mid;

      musicEqTrebleRef.current = audioCtxRef.current.createBiquadFilter();
      musicEqTrebleRef.current.type = 'highshelf';
      musicEqTrebleRef.current.frequency.value = 4000;
      musicEqTrebleRef.current.gain.value = savedMusicEq.treble;

      musicBusGainRef.current = audioCtxRef.current.createGain();
      musicBusGainRef.current.gain.value = 1.0;
      musicBusGainRef.current.connect(musicEqBassRef.current);
      musicEqBassRef.current.connect(musicEqMidRef.current);
      musicEqMidRef.current.connect(musicEqTrebleRef.current);
      musicEqTrebleRef.current.connect(limiterRef.current);

      deckAGainRef.current = audioCtxRef.current.createGain();
      deckAGainRef.current.gain.value = 1.0;
      deckAGainRef.current.connect(musicBusGainRef.current);

      deckBGainRef.current = audioCtxRef.current.createGain();
      deckBGainRef.current.gain.value = 0;
      deckBGainRef.current.connect(musicBusGainRef.current);

      deckASourceElRef.current = null;
      deckBSourceElRef.current = null;

      voiceEqBassRef.current = audioCtxRef.current.createBiquadFilter();
      voiceEqBassRef.current.type = 'lowshelf';
      voiceEqBassRef.current.frequency.value = 200;
      voiceEqBassRef.current.gain.value = savedVoiceEq.bass;

      voiceEqMidRef.current = audioCtxRef.current.createBiquadFilter();
      voiceEqMidRef.current.type = 'peaking';
      voiceEqMidRef.current.frequency.value = 1000;
      voiceEqMidRef.current.Q.value = 1.0;
      voiceEqMidRef.current.gain.value = savedVoiceEq.mid;

      voiceEqTrebleRef.current = audioCtxRef.current.createBiquadFilter();
      voiceEqTrebleRef.current.type = 'highshelf';
      voiceEqTrebleRef.current.frequency.value = 4000;
      voiceEqTrebleRef.current.gain.value = savedVoiceEq.treble;

      voiceGainRef.current = audioCtxRef.current.createGain();
      voiceGainRef.current.gain.value = voiceGainLevel.current;
      voiceGainRef.current.connect(voiceEqBassRef.current);
      voiceEqBassRef.current.connect(voiceEqMidRef.current);
      voiceEqMidRef.current.connect(voiceEqTrebleRef.current);
      voiceEqTrebleRef.current.connect(audioCtxRef.current.destination);
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const connectDeckSource = useCallback((deckEl, gainNode, sourceRef, sourceElRef) => {
    if (sourceElRef.current === deckEl && sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current.connect(gainNode);
      return;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch {}
    }
    const ctx = ensureAudioContext();
    const source = ctx.createMediaElementSource(deckEl);
    source.connect(gainNode);
    sourceRef.current = source;
    sourceElRef.current = deckEl;
  }, [ensureAudioContext]);

  useEffect(() => {
    const deckA = new Audio();
    const deckB = new Audio();
    const voice = new Audio();

    deckA.crossOrigin = 'anonymous';
    deckB.crossOrigin = 'anonymous';
    voice.crossOrigin = 'anonymous';

    deckA.volume = 1.0;
    deckB.volume = 1.0;
    voice.volume = 1.0;

    deckARef.current = deckA;
    deckBRef.current = deckB;
    voiceElRef.current = voice;

    const dualDeckMonitor = setInterval(() => {
      const a = deckARef.current;
      const b = deckBRef.current;
      if (a && b && !a.paused && !b.paused && a.src && b.src && !crossfadeInProgressRef.current) {
        const active = activeDeck.current;
        const stale = active === 'A' ? b : a;
        const staleName = active === 'A' ? 'B' : 'A';
        console.error(`🚨 DUAL-DECK FIX: Both decks playing outside crossfade! Force-pausing deck ${staleName}. A.src=${a.src.substring(0, 60)}, B.src=${b.src.substring(0, 60)}`);
        stale.pause();
        stale.src = '';
      }
    }, 2000);

    return () => {
      clearInterval(dualDeckMonitor);
      deckA.pause();
      deckA.src = '';
      deckB.pause();
      deckB.src = '';
      voice.pause();
      voice.src = '';
      if (fadeAnimationRef.current) cancelAnimationFrame(fadeAnimationRef.current);
      if (safetyFadeRef.current) cancelAnimationFrame(safetyFadeRef.current);
      if (deckASourceRef.current) { try { deckASourceRef.current.disconnect(); } catch {} }
      if (deckBSourceRef.current) { try { deckBSourceRef.current.disconnect(); } catch {} }
      if (voiceSourceRef.current) { try { voiceSourceRef.current.disconnect(); } catch {} }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const getActiveDeck = () => activeDeck.current === 'A' ? deckARef.current : deckBRef.current;
  const getInactiveDeck = () => activeDeck.current === 'A' ? deckBRef.current : deckARef.current;
  const getActiveDeckGain = () => activeDeck.current === 'A' ? deckAGainRef.current : deckBGainRef.current;
  const getInactiveDeckGain = () => activeDeck.current === 'A' ? deckBGainRef.current : deckAGainRef.current;
  const getInactiveSourceRef = () => activeDeck.current === 'A' ? deckBSourceRef : deckASourceRef;
  const getInactiveSourceElRef = () => activeDeck.current === 'A' ? deckBSourceElRef : deckASourceElRef;

  const equalPowerIn = (progress) => Math.sin(progress * Math.PI * 0.5);
  const equalPowerOut = (progress) => Math.cos(progress * Math.PI * 0.5);
  const clampVol = (v) => Math.max(0, Math.min(1, v));

  const cleanupDeck = useCallback((deckEl) => {
    const urlRef = deckEl === deckARef.current ? deckAUrl : deckBUrl;
    if (urlRef.current) {
      if (urlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(urlRef.current);
      }
      urlRef.current = null;
    }
  }, []);

  const detectBPMFromBuffer = useCallback((audioBuffer) => {
    try {
      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const bufLen = channelData.length;
      const analysisLen = Math.min(bufLen, sampleRate * 30);

      const filtered = new Float32Array(analysisLen);
      for (let i = 0; i < analysisLen; i++) {
        filtered[i] = Math.abs(channelData[i]);
      }
      for (let i = 1; i < analysisLen; i++) {
        filtered[i] = filtered[i] * 0.1 + filtered[i - 1] * 0.9;
      }

      const peaks = [];
      const windowSize = Math.floor(sampleRate * 0.3);
      let threshold = 0;
      for (let i = 0; i < analysisLen; i++) {
        threshold = Math.max(threshold * 0.9999, filtered[i]);
      }
      threshold *= 0.5;

      let lastPeak = -windowSize;
      for (let i = 1; i < analysisLen - 1; i++) {
        if (filtered[i] > filtered[i - 1] && filtered[i] > filtered[i + 1] && filtered[i] > threshold && (i - lastPeak) > windowSize) {
          peaks.push(i);
          lastPeak = i;
        }
      }

      if (peaks.length < 4) return null;

      const intervals = [];
      for (let i = 1; i < peaks.length; i++) {
        intervals.push((peaks[i] - peaks[i - 1]) / sampleRate);
      }

      const bpmCounts = {};
      for (const interval of intervals) {
        let bpm = 60 / interval;
        while (bpm < 70) bpm *= 2;
        while (bpm > 180) bpm /= 2;
        const rounded = Math.round(bpm);
        bpmCounts[rounded] = (bpmCounts[rounded] || 0) + 1;
      }

      let bestBpm = null;
      let bestCount = 0;
      for (const [bpm, count] of Object.entries(bpmCounts)) {
        const nearby = Object.entries(bpmCounts)
          .filter(([b]) => Math.abs(parseInt(b) - parseInt(bpm)) <= 2)
          .reduce((sum, [, c]) => sum + c, 0);
        if (nearby > bestCount) {
          bestCount = nearby;
          bestBpm = parseInt(bpm);
        }
      }

      if (bestBpm && bestCount >= 3) {
        console.log(`🎵 BPM detected: ${bestBpm} (confidence: ${bestCount} peaks)`);
        return bestBpm;
      }
      return null;
    } catch (err) {
      console.warn('⚠️ BPM detection failed:', err.message);
      return null;
    }
  }, []);

  const analyzeTrackLoudness = useCallback(async (deckEl) => {
    if (!autoGainEnabledRef.current && !beatMatchEnabledRef.current) {
      console.log('🔊 AutoGain: disabled, skipping');
      return { gain: 1.0, bpm: null };
    }
    try {
      const ctx = audioCtxRef.current;
      if (!ctx || !deckEl.src) {
        console.warn('🔊 AutoGain: no AudioContext or src, skipping');
        return { gain: 1.0, bpm: null };
      }

      const srcUrl = deckEl.src;
      const cacheKey = srcUrl.replace(/^blob:/, '');
      const cachedGain = autoGainCacheRef.current.get(cacheKey);
      const cachedBpm = bpmCacheRef.current.get(cacheKey);
      if (cachedGain !== undefined && (cachedBpm !== undefined || !beatMatchEnabledRef.current)) {
        console.log(`🔊 AutoGain: cached gain=${cachedGain.toFixed(2)}x, bpm=${cachedBpm || '?'}`);
        return { gain: cachedGain, bpm: cachedBpm || null };
      }

      let dur = deckEl.duration;
      if (!dur || !isFinite(dur) || dur <= 0) {
        await new Promise((resolve) => {
          const onMeta = () => { deckEl.removeEventListener('loadedmetadata', onMeta); resolve(); };
          deckEl.addEventListener('loadedmetadata', onMeta);
          setTimeout(() => { deckEl.removeEventListener('loadedmetadata', onMeta); resolve(); }, 3000);
        });
        dur = deckEl.duration;
      }
      if (!dur || !isFinite(dur) || dur <= 0) {
        console.warn('🔊 AutoGain: duration unavailable after wait, skipping');
        return { gain: 1.0, bpm: null };
      }

      const sampleRate = ctx.sampleRate || 44100;
      const analysisDur = Math.min(dur, AUTO_GAIN_ANALYSIS_SECONDS);
      const bpmDur = Math.min(dur, 30);
      const maxDur = Math.max(analysisDur, bpmDur);
      const frameCount = Math.floor(maxDur * sampleRate);
      if (frameCount <= 0) return { gain: 1.0, bpm: null };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(srcUrl, { signal: controller.signal });
      clearTimeout(timeout);
      const arrayBuffer = await response.arrayBuffer();

      const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);
      const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start(0, 0, maxDur);

      const rendered = await offlineCtx.startRendering();

      let gainValue = 1.0;
      if (autoGainEnabledRef.current) {
        let sumSquares = 0;
        let sampleCount = 0;
        const gainFrames = Math.floor(analysisDur * sampleRate);
        for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
          const data = rendered.getChannelData(ch);
          const len = Math.min(data.length, gainFrames);
          for (let i = 0; i < len; i++) {
            sumSquares += data[i] * data[i];
            sampleCount++;
          }
        }
        if (sampleCount > 0) {
          const rms = Math.sqrt(sumSquares / sampleCount);
          const lufs = 20 * Math.log10(Math.max(rms, 1e-10));
          const diff = AUTO_GAIN_TARGET_LUFS - lufs;
          const gain = Math.pow(10, diff / 20);
          gainValue = Math.max(AUTO_GAIN_MIN, Math.min(AUTO_GAIN_MAX, gain));
          console.log(`🔊 AutoGain: LUFS=${lufs.toFixed(1)}dB, target=${AUTO_GAIN_TARGET_LUFS}dB, gain=${gainValue.toFixed(2)}x`);
        }
      }

      let detectedBpm = null;
      if (beatMatchEnabledRef.current) {
        detectedBpm = detectBPMFromBuffer(rendered);
      }

      autoGainCacheRef.current.set(cacheKey, gainValue);
      bpmCacheRef.current.set(cacheKey, detectedBpm);
      if (autoGainCacheRef.current.size > 200) {
        const firstKey = autoGainCacheRef.current.keys().next().value;
        autoGainCacheRef.current.delete(firstKey);
        bpmCacheRef.current.delete(firstKey);
      }

      return { gain: gainValue, bpm: detectedBpm };
    } catch (err) {
      console.warn('⚠️ AutoGain: Analysis failed, using 1.0:', err.message);
      return { gain: 1.0, bpm: null };
    }
  }, [detectBPMFromBuffer]);

  const loadTrack = useCallback(async (input) => {
    if (!input) return null;

    if (typeof input === 'object' && input.url) {
      const url = input.url;
      const name = input.name || url.split('/').pop();
      if (input.auto_gain != null && autoGainCacheRef.current) {
        const cacheKey = url.replace(/^blob:/, '');
        const gain = Math.max(AUTO_GAIN_MIN, Math.min(AUTO_GAIN_MAX, input.auto_gain));
        autoGainCacheRef.current.set(cacheKey, gain);
        console.log(`🔊 AutoGain: pre-loaded server gain=${gain.toFixed(2)}x for ${name}`);
      }
      return { url, name, file: null };
    }

    if (typeof input === 'string') {
      const name = decodeURIComponent(input.split('/').pop().split('?')[0]);
      return { url: input, name, file: null };
    }

    try {
      const file = await input.getFile();
      const url = URL.createObjectURL(file);
      return { url, name: file.name, file };
    } catch (err) {
      console.error('❌ LoadTrack: Failed to read file (permission may have been revoked):', err.message);
      return null;
    }
  }, []);

  const playTrack = useCallback(async (fileHandle, crossfade = true) => {
    if (playTrackLockRef.current) {
      console.log('🚫 PlayTrack: BLOCKED — another track is already loading, skipping this call');
      return false;
    }

    let releaseLock;
    playTrackLockRef.current = new Promise(r => { releaseLock = r; });

    try {

    const deckA = deckARef.current;
    const deckB = deckBRef.current;
    const aDeck = activeDeck.current;
    console.log(`🔍 PlayTrack: DECK STATE before load — active=${aDeck}, A.paused=${deckA?.paused}, A.src=${deckA?.src ? 'set' : 'empty'}, B.paused=${deckB?.paused}, B.src=${deckB?.src ? 'set' : 'empty'}`);

    const trackData = await loadTrack(fileHandle);
    if (!trackData) {
      console.error('❌ PlayTrack: loadTrack returned null — file unreadable');
      releaseLock();
      playTrackLockRef.current = null;
      return false;
    }

    // Codec check — bail out early for formats the browser definitely cannot play
    // (e.g. WMA on Chromium/Linux).  canPlayType returns '' when support is absent.
    const CODEC_MAP = {
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
      flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
      wma: 'audio/x-ms-wma', opus: 'audio/ogg; codecs=opus',
    };
    const urlExt = (trackData.url.split('?')[0].split('.').pop() || '').toLowerCase();
    const codecMime = CODEC_MAP[urlExt];
    if (codecMime) {
      const probe = new Audio();
      if (probe.canPlayType(codecMime) === '') {
        console.error(`❌ PlayTrack: Browser cannot play ${urlExt.toUpperCase()} (${trackData.name}) — skipping`);
        releaseLock();
        playTrackLockRef.current = null;
        return false;
      }
    }

    const ctx = ensureAudioContext();
    crossfadeInProgressRef.current = true;

    if (fadeAnimationRef.current) {
      cancelAnimationFrame(fadeAnimationRef.current);
      fadeAnimationRef.current = null;
    }
    if (safetyFadeRef.current) {
      cancelAnimationFrame(safetyFadeRef.current);
      safetyFadeRef.current = null;
    }

    const inactiveDeck = getInactiveDeck();
    const activeDeckEl = getActiveDeck();
    const inactiveGain = getInactiveDeckGain();
    const activeGain = getActiveDeckGain();
    const inactiveSourceRef = getInactiveSourceRef();

    inactiveDeck.onended = null;
    inactiveDeck.ontimeupdate = null;
    activeDeckEl.onended = null;
    activeDeckEl.ontimeupdate = null;

    const inactiveUrlRef = inactiveDeck === deckARef.current ? deckAUrl : deckBUrl;
    if (inactiveUrlRef.current && inactiveUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(inactiveUrlRef.current);
    }
    inactiveUrlRef.current = trackData.url;

    inactiveDeck.currentTime = 0;
    inactiveDeck.src = '';
    inactiveDeck.src = trackData.url;

    try {
      await inactiveDeck.load();
    } catch (loadErr) {
      console.error('❌ PlayTrack: Audio load failed:', loadErr.message);
      releaseLock();
      playTrackLockRef.current = null;
      return false;
    }

    const inactiveSourceElRef = getInactiveSourceElRef();
    if (!inactiveSourceRef.current || inactiveSourceElRef.current !== inactiveDeck) {
      connectDeckSource(inactiveDeck, inactiveGain, inactiveSourceRef, inactiveSourceElRef);
    }

    const analysisResult = await analyzeTrackLoudness(inactiveDeck);
    const autoGainValue = analysisResult.gain;
    const incomingBpm = analysisResult.bpm;
    inactiveGain.gain.value = autoGainValue;

    const maxDur = maxDurationOverrideRef.current || MAX_SONG_DURATION;
    const effectiveDuration = Math.min(inactiveDeck.duration || maxDur, maxDur);
    maxDurationOverrideRef.current = null;
    setDuration(effectiveDuration);
    setCurrentTrack(trackData.name);
    setCurrentTime(0);
    lastTimeUpdateRef.current = 0;
    onTrackChangeRef.current?.(trackData.name);

    const outgoingBpm = activeDeckBpmRef.current;
    const doBeatMatch = beatMatchEnabledRef.current && outgoingBpm && incomingBpm && Math.abs(outgoingBpm - incomingBpm) > 1;
    const beatMatchRate = doBeatMatch ? outgoingBpm / incomingBpm : 1.0;
    const beatMatchMaxDiff = 0.12;
    const clampedRate = doBeatMatch ? Math.max(1 - beatMatchMaxDiff, Math.min(1 + beatMatchMaxDiff, beatMatchRate)) : 1.0;

    if (doBeatMatch) {
      console.log(`🎵 Beat Match: ${outgoingBpm} → ${incomingBpm} BPM, rate=${clampedRate.toFixed(3)}`);
      inactiveDeck.playbackRate = clampedRate;
    }

    try {
      if (crossfade && isPlayingRef.current) {
        inactiveGain.gain.setValueAtTime(0, ctx.currentTime);
        await inactiveDeck.play();

        const targetVolume = autoGainValue;
        const oldStartVolume = activeGain.gain.value;
        const startTime = performance.now();
        const fadeDuration = CROSSFADE_DURATION * 1000;

        const animateFade = (now) => {
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / fadeDuration, 1);

          inactiveGain.gain.setValueAtTime(clampVol(equalPowerIn(progress) * targetVolume), ctx.currentTime);
          activeGain.gain.setValueAtTime(clampVol(equalPowerOut(progress) * oldStartVolume), ctx.currentTime);

          if (doBeatMatch) {
            const rateProgress = Math.min(progress * 1.5, 1);
            inactiveDeck.playbackRate = clampedRate + (1.0 - clampedRate) * rateProgress;
          }

          if (progress < 1) {
            fadeAnimationRef.current = requestAnimationFrame(animateFade);
          } else {
            fadeAnimationRef.current = null;
            crossfadeInProgressRef.current = false;
            if (doBeatMatch) inactiveDeck.playbackRate = 1.0;
            activeDeckBpmRef.current = incomingBpm;
            activeDeckEl.pause();
            activeDeckEl.src = '';
            cleanupDeck(activeDeckEl);
            activeDeck.current = activeDeck.current === 'A' ? 'B' : 'A';
          }
        };

        fadeAnimationRef.current = requestAnimationFrame(animateFade);
      } else if (isPlayingRef.current) {
        const targetVolume = autoGainValue;
        const oldStartVolume = activeGain.gain.value;
        inactiveGain.gain.setValueAtTime(0, ctx.currentTime);
        if (doBeatMatch) inactiveDeck.playbackRate = 1.0;
        await inactiveDeck.play();

        const startTime = performance.now();
        const fadeDuration = MICRO_CROSSFADE_DURATION * 1000;

        const animateMicroFade = (now) => {
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / fadeDuration, 1);

          inactiveGain.gain.setValueAtTime(clampVol(equalPowerIn(progress) * targetVolume), ctx.currentTime);
          activeGain.gain.setValueAtTime(clampVol(equalPowerOut(progress) * oldStartVolume), ctx.currentTime);

          if (progress < 1) {
            fadeAnimationRef.current = requestAnimationFrame(animateMicroFade);
          } else {
            fadeAnimationRef.current = null;
            crossfadeInProgressRef.current = false;
            activeDeckBpmRef.current = incomingBpm;
            activeDeckEl.pause();
            activeDeckEl.src = '';
            cleanupDeck(activeDeckEl);
            activeDeck.current = activeDeck.current === 'A' ? 'B' : 'A';
          }
        };

        fadeAnimationRef.current = requestAnimationFrame(animateMicroFade);
      } else {
        crossfadeInProgressRef.current = false;
        activeDeckEl.pause();
        activeDeckEl.src = '';
        cleanupDeck(activeDeckEl);
        inactiveGain.gain.setValueAtTime(autoGainValue, ctx.currentTime);
        inactiveDeck.currentTime = 0;
        if (doBeatMatch) inactiveDeck.playbackRate = 1.0;
        await inactiveDeck.play();
        activeDeckBpmRef.current = incomingBpm;
        activeDeck.current = activeDeck.current === 'A' ? 'B' : 'A';
      }
    } catch (playErr) {
      crossfadeInProgressRef.current = false;
      console.error('❌ PlayTrack: play() failed:', playErr.message);
      activeDeck.current = activeDeck.current === 'A' ? 'B' : 'A';
      releaseLock();
      playTrackLockRef.current = null;
      return false;
    }

    isPlayingRef.current = true;
    setIsPlaying(true);

    console.log(`🔍 PlayTrack: DECK STATE after play — active=${activeDeck.current}, A.paused=${deckARef.current?.paused}, B.paused=${deckBRef.current?.paused}`);

    const newDeck = inactiveDeck;
    const newDeckGain = inactiveGain;
    let transitionTriggered = false;
    let safetyFading = false;

    const startSafetyFade = () => {
      if (safetyFading || crossfadeInProgressRef.current) return;
      safetyFading = true;
      const fadeStartVolume = newDeckGain.gain.value;
      const fadeStart = performance.now();
      const shortTrack = resolvedDuration < 60;
      const fadeSecs = shortTrack ? Math.min(2, resolvedDuration * 0.15) : SAFETY_FADE_SECONDS;
      const fadeDur = fadeSecs * 1000;

      const animateOut = (now) => {
        const elapsed = now - fadeStart;
        const progress = Math.min(elapsed / fadeDur, 1);
        newDeckGain.gain.setValueAtTime(clampVol(equalPowerOut(progress) * fadeStartVolume), ctx.currentTime);

        if (progress < 1) {
          safetyFadeRef.current = requestAnimationFrame(animateOut);
        } else {
          safetyFadeRef.current = null;
          newDeck.pause();
        }
      };

      safetyFadeRef.current = requestAnimationFrame(animateOut);
    };

    let resolvedDuration = effectiveDuration;

    const timeUpdateHandler = () => {
      const time = newDeck.currentTime;
      const now = performance.now();

      const realDur = newDeck.duration;
      if (realDur && isFinite(realDur) && realDur > 0) {
        const capped = Math.min(realDur, maxDur);
        if (Math.abs(capped - resolvedDuration) > 1) {
          resolvedDuration = capped;
          setDuration(resolvedDuration);
        }
      }

      if (time >= resolvedDuration) {
        if (!safetyFading) startSafetyFade();
        if (!transitionTriggered) {
          transitionTriggered = true;
          onTrackEndRef.current?.();
        }
        return;
      }

      const isShortTrack = resolvedDuration < 60;
      const effectiveSafetyFade = isShortTrack ? Math.min(2, resolvedDuration * 0.15) : SAFETY_FADE_SECONDS;
      const safetyFadePoint = resolvedDuration - effectiveSafetyFade;
      if (time >= safetyFadePoint && !safetyFading) {
        startSafetyFade();
      }

      if (now - lastTimeUpdateRef.current > 1000) {
        lastTimeUpdateRef.current = now;
        setCurrentTime(time);
        onTimeUpdateRef.current?.(time, resolvedDuration);
      }

      const effectiveLeadTime = isShortTrack ? Math.min(3, resolvedDuration * 0.15) : TRANSITION_LEAD_TIME;
      const triggerPoint = Math.max(resolvedDuration - effectiveLeadTime, resolvedDuration * 0.85);
      if (time >= triggerPoint && !transitionTriggered) {
        transitionTriggered = true;
        onTrackEndRef.current?.();
      }
    };

    const endedHandler = () => {
      if (!transitionTriggered) {
        transitionTriggered = true;
        onTrackEndRef.current?.();
      }
    };

    newDeck.ontimeupdate = timeUpdateHandler;
    newDeck.onended = endedHandler;

    releaseLock();
    playTrackLockRef.current = null;
    return true;
    } catch (outerErr) {
      console.error('❌ PlayTrack: Unexpected error:', outerErr.message);
      releaseLock();
      playTrackLockRef.current = null;
      return false;
    }
  }, [loadTrack, cleanupDeck, ensureAudioContext, connectDeckSource, analyzeTrackLoudness]);

  const duck = useCallback(() => {
    const ctx = ensureAudioContext();
    isDucked.current = true;
    const busGain = musicBusGainRef.current;
    if (!busGain) return;
    busGain.gain.cancelScheduledValues(ctx.currentTime);
    busGain.gain.setValueAtTime(busGain.gain.value, ctx.currentTime);
    busGain.gain.exponentialRampToValueAtTime(Math.max(DUCK_LEVEL, 0.001), ctx.currentTime + DUCK_ATTACK_MS / 1000);
  }, [ensureAudioContext]);

  const unduck = useCallback(() => {
    if (!isDucked.current) return;
    const ctx = ensureAudioContext();
    isDucked.current = false;
    const busGain = musicBusGainRef.current;
    if (!busGain) return;
    busGain.gain.cancelScheduledValues(ctx.currentTime);
    busGain.gain.setValueAtTime(busGain.gain.value, ctx.currentTime);
    busGain.gain.exponentialRampToValueAtTime(1.0, ctx.currentTime + DUCK_RELEASE_MS / 1000);
  }, [ensureAudioContext]);

  const playAnnouncement = useCallback(async (audioUrl, { autoDuck = true, onNearEnd = null } = {}) => {
    return new Promise(async (resolve) => {
      const voice = voiceElRef.current;
      if (voice) {
        voice.pause();
        voice.currentTime = 0;
      }

      if (autoDuck) duck();

      const isBlobUrl = audioUrl && audioUrl.startsWith('blob:');
      let resolved = false;
      let nearEndFired = false;
      const cleanupAndResolve = () => {
        if (resolved) return;
        resolved = true;
        if (voice) voice.ontimeupdate = null;
        if (isBlobUrl) URL.revokeObjectURL(audioUrl);
        if (!nearEndFired && onNearEnd) {
          nearEndFired = true;
          onNearEnd();
        }
        if (autoDuck) unduck();
        resolve();
      };

      if (!audioUrl) {
        console.warn('⚠️ PlayAnnouncement: No audio URL provided');
        cleanupAndResolve();
        return;
      }

      voice.src = audioUrl;
      voice.volume = 1.0;
      voice.loop = false;

      if (voiceGainRef.current && audioCtxRef.current) {
        if (voiceSourceElRef.current !== voice) {
          if (voiceSourceRef.current) {
            try { voiceSourceRef.current.disconnect(); } catch {}
          }
          const ctx = ensureAudioContext();
          const src = ctx.createMediaElementSource(voice);
          src.connect(voiceGainRef.current);
          voiceSourceRef.current = src;
          voiceSourceElRef.current = voice;
        }
        voiceGainRef.current.gain.setValueAtTime(voiceGainLevel.current, audioCtxRef.current.currentTime);
      }

      voice.ontimeupdate = () => {
        if (nearEndFired || !onNearEnd) return;
        if (voice && voice.duration && voice.duration > NEAR_END_SECONDS && voice.currentTime >= voice.duration - NEAR_END_SECONDS) {
          nearEndFired = true;
          onNearEnd();
        }
      };

      voice.onended = cleanupAndResolve;
      voice.onerror = (e) => {
        console.error('❌ Announcement audio error:', e?.target?.error?.message || 'unknown');
        cleanupAndResolve();
      };

      try {
        await voice.play();
      } catch (error) {
        console.error('Failed to play announcement:', error);
        cleanupAndResolve();
      }
    });
  }, [duck, unduck]);

  const pause = useCallback(() => {
    getActiveDeck().pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const pauseAll = useCallback(() => {
    if (fadeAnimationRef.current) {
      cancelAnimationFrame(fadeAnimationRef.current);
      fadeAnimationRef.current = null;
    }
    if (safetyFadeRef.current) {
      cancelAnimationFrame(safetyFadeRef.current);
      safetyFadeRef.current = null;
    }
    crossfadeInProgressRef.current = false;
    if (deckARef.current) {
      deckARef.current.pause();
      deckARef.current.onended = null;
      deckARef.current.ontimeupdate = null;
    }
    if (deckBRef.current) {
      deckBRef.current.pause();
      deckBRef.current.onended = null;
      deckBRef.current.ontimeupdate = null;
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const resume = useCallback(() => {
    ensureAudioContext();
    try {
      getActiveDeck().play().catch(err => {
        console.error('❌ Resume play failed:', err.message);
      });
    } catch (err) {
      console.error('❌ Resume failed:', err.message);
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
  }, [ensureAudioContext]);

  const setVolume = useCallback((vol) => {
    const v = clampVol(vol);
    masterVolume.current = v;
    if (masterGainRef.current && audioCtxRef.current) {
      masterGainRef.current.gain.setValueAtTime(v, audioCtxRef.current.currentTime);
    }
  }, []);

  const setVoiceGain = useCallback((gain) => {
    const g = Math.max(0, Math.min(3, gain));
    voiceGainLevel.current = g;
    if (voiceGainRef.current && audioCtxRef.current) {
      voiceGainRef.current.gain.setValueAtTime(g, audioCtxRef.current.currentTime);
    }
  }, []);

  const seek = useCallback((time) => {
    const deck = getActiveDeck();
    deck.currentTime = Math.min(time, MAX_SONG_DURATION);
  }, []);

  const setMusicEq = useCallback((band, value) => {
    const v = Math.max(-12, Math.min(12, value));
    const ref_map = { bass: musicEqBassRef, mid: musicEqMidRef, treble: musicEqTrebleRef };
    const filterRef = ref_map[band];
    if (filterRef && filterRef.current && audioCtxRef.current) {
      filterRef.current.gain.setValueAtTime(v, audioCtxRef.current.currentTime);
    }
    const saved = JSON.parse(localStorage.getItem('neonaidj_music_eq') || '{"bass":0,"mid":0,"treble":0}');
    saved[band] = v;
    localStorage.setItem('neonaidj_music_eq', JSON.stringify(saved));
  }, []);

  const stopVoice = useCallback(() => {
    const voice = voiceElRef.current;
    if (voice) {
      voice.pause();
      voice.currentTime = 0;
      voice.onended = null;
      voice.onerror = null;
      voice.ontimeupdate = null;
    }
    if (isDucked.current) unduck();
  }, [unduck]);

  const setVoiceEq = useCallback((band, value) => {
    const v = Math.max(-12, Math.min(12, value));
    const ref_map = { bass: voiceEqBassRef, mid: voiceEqMidRef, treble: voiceEqTrebleRef };
    const filterRef = ref_map[band];
    if (filterRef && filterRef.current && audioCtxRef.current) {
      filterRef.current.gain.setValueAtTime(v, audioCtxRef.current.currentTime);
    }
    const saved = JSON.parse(localStorage.getItem('neonaidj_voice_eq') || '{"bass":0,"mid":0,"treble":0}');
    saved[band] = v;
    localStorage.setItem('neonaidj_voice_eq', JSON.stringify(saved));
  }, []);

  useImperativeHandle(ref, () => ({
    playTrack,
    pause,
    pauseAll,
    resume,
    duck,
    unduck,
    playAnnouncement,
    stopVoice,
    setVolume,
    setVoiceGain,
    seek,
    setMusicEq,
    setVoiceEq,
    setMaxDuration: (seconds) => { maxDurationOverrideRef.current = seconds; },
    setAutoGain: (enabled) => { autoGainEnabledRef.current = enabled; },
    setBeatMatch: (enabled) => {
      beatMatchEnabledRef.current = enabled;
      try { localStorage.setItem('neonaidj_beat_match', enabled ? 'true' : 'false'); } catch {}
    },
    getBeatMatchEnabled: () => beatMatchEnabledRef.current,
    isPlaying,
    currentTrack,
    currentTime,
    duration
  }));

  return null;
});

AudioEngine.displayName = 'AudioEngine';

export default AudioEngine;
