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

const AUTO_GAIN_TARGET_LUFS = -14;
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
  const autoGainEnabledRef = useRef(true);
  const autoGainCacheRef = useRef(new Map());

  const activeDeck = useRef('A');
  const masterVolume = useRef(0.8);
  const isPlayingRef = useRef(false);
  const isDucked = useRef(false);
  const crossfadeInProgressRef = useRef(false);

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

      musicBusGainRef.current = audioCtxRef.current.createGain();
      musicBusGainRef.current.gain.value = 1.0;
      musicBusGainRef.current.connect(limiterRef.current);

      deckAGainRef.current = audioCtxRef.current.createGain();
      deckAGainRef.current.gain.value = 1.0;
      deckAGainRef.current.connect(musicBusGainRef.current);

      deckBGainRef.current = audioCtxRef.current.createGain();
      deckBGainRef.current.gain.value = 0;
      deckBGainRef.current.connect(musicBusGainRef.current);

      deckASourceElRef.current = null;
      deckBSourceElRef.current = null;
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

    deckA.volume = 1.0;
    deckB.volume = 1.0;
    voice.volume = 1.0;

    deckARef.current = deckA;
    deckBRef.current = deckB;
    voiceElRef.current = voice;

    return () => {
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

  const analyzeTrackLoudness = useCallback(async (deckEl) => {
    if (!autoGainEnabledRef.current) return 1.0;
    try {
      const ctx = audioCtxRef.current;
      if (!ctx || !deckEl.src) return 1.0;

      const srcUrl = deckEl.src;
      const cacheKey = srcUrl.replace(/^blob:/, '');
      const cached = autoGainCacheRef.current.get(cacheKey);
      if (cached !== undefined) {
        console.log(`🔊 AutoGain: cached gain=${cached.toFixed(2)}x`);
        return cached;
      }

      const dur = deckEl.duration;
      if (!dur || !isFinite(dur) || dur <= 0) return 1.0;

      const sampleRate = ctx.sampleRate || 44100;
      const analysisDur = Math.min(dur, AUTO_GAIN_ANALYSIS_SECONDS);
      const frameCount = Math.floor(analysisDur * sampleRate);
      if (frameCount <= 0) return 1.0;

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
      source.start(0, 0, analysisDur);

      const rendered = await offlineCtx.startRendering();

      let sumSquares = 0;
      let sampleCount = 0;
      for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
        const data = rendered.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
          sumSquares += data[i] * data[i];
          sampleCount++;
        }
      }

      if (sampleCount === 0) return 1.0;

      const rms = Math.sqrt(sumSquares / sampleCount);
      const lufs = 20 * Math.log10(Math.max(rms, 1e-10));
      const diff = AUTO_GAIN_TARGET_LUFS - lufs;
      const gain = Math.pow(10, diff / 20);
      const clamped = Math.max(AUTO_GAIN_MIN, Math.min(AUTO_GAIN_MAX, gain));

      autoGainCacheRef.current.set(cacheKey, clamped);
      if (autoGainCacheRef.current.size > 200) {
        const firstKey = autoGainCacheRef.current.keys().next().value;
        autoGainCacheRef.current.delete(firstKey);
      }

      console.log(`🔊 AutoGain: LUFS=${lufs.toFixed(1)}dB, target=${AUTO_GAIN_TARGET_LUFS}dB, gain=${clamped.toFixed(2)}x`);
      return clamped;
    } catch (err) {
      console.warn('⚠️ AutoGain: Analysis failed, using 1.0:', err.message);
      return 1.0;
    }
  }, []);

  const loadTrack = useCallback(async (input) => {
    if (!input) return null;

    if (typeof input === 'object' && input.url) {
      return { url: input.url, name: input.name || input.url.split('/').pop(), file: null };
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
    const trackData = await loadTrack(fileHandle);
    if (!trackData) {
      console.error('❌ PlayTrack: loadTrack returned null — file unreadable');
      return false;
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
      return false;
    }

    const inactiveSourceElRef = getInactiveSourceElRef();
    if (!inactiveSourceRef.current || inactiveSourceElRef.current !== inactiveDeck) {
      connectDeckSource(inactiveDeck, inactiveGain, inactiveSourceRef, inactiveSourceElRef);
    }

    const autoGainValue = await analyzeTrackLoudness(inactiveDeck);
    inactiveGain.gain.value = autoGainValue;

    const maxDur = maxDurationOverrideRef.current || MAX_SONG_DURATION;
    const effectiveDuration = Math.min(inactiveDeck.duration || maxDur, maxDur);
    maxDurationOverrideRef.current = null;
    setDuration(effectiveDuration);
    setCurrentTrack(trackData.name);
    setCurrentTime(0);
    lastTimeUpdateRef.current = 0;
    onTrackChangeRef.current?.(trackData.name);

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

          if (progress < 1) {
            fadeAnimationRef.current = requestAnimationFrame(animateFade);
          } else {
            fadeAnimationRef.current = null;
            crossfadeInProgressRef.current = false;
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
        await inactiveDeck.play();
        activeDeck.current = activeDeck.current === 'A' ? 'B' : 'A';
      }
    } catch (playErr) {
      crossfadeInProgressRef.current = false;
      console.error('❌ PlayTrack: play() failed:', playErr.message);
      activeDeck.current = activeDeck.current === 'A' ? 'B' : 'A';
      return false;
    }

    isPlayingRef.current = true;
    setIsPlaying(true);

    const newDeck = inactiveDeck;
    const newDeckGain = inactiveGain;
    let transitionTriggered = false;
    let safetyFading = false;

    const startSafetyFade = () => {
      if (safetyFading || crossfadeInProgressRef.current) return;
      safetyFading = true;
      const fadeStartVolume = newDeckGain.gain.value;
      const fadeStart = performance.now();
      const fadeDur = SAFETY_FADE_SECONDS * 1000;

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

      const safetyFadePoint = resolvedDuration - SAFETY_FADE_SECONDS;
      if (time >= safetyFadePoint && !safetyFading) {
        startSafetyFade();
      }

      if (now - lastTimeUpdateRef.current > 1000) {
        lastTimeUpdateRef.current = now;
        setCurrentTime(time);
        onTimeUpdateRef.current?.(time, resolvedDuration);
      }

      const triggerPoint = Math.max(resolvedDuration - TRANSITION_LEAD_TIME, resolvedDuration * 0.5);
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

    return true;
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

  const seek = useCallback((time) => {
    const deck = getActiveDeck();
    deck.currentTime = Math.min(time, MAX_SONG_DURATION);
  }, []);

  useImperativeHandle(ref, () => ({
    playTrack,
    pause,
    resume,
    duck,
    unduck,
    playAnnouncement,
    setVolume,
    seek,
    setMaxDuration: (seconds) => { maxDurationOverrideRef.current = seconds; },
    setAutoGain: (enabled) => { autoGainEnabledRef.current = enabled; },
    isPlaying,
    currentTrack,
    currentTime,
    duration
  }));

  return null;
});

AudioEngine.displayName = 'AudioEngine';

export default AudioEngine;
