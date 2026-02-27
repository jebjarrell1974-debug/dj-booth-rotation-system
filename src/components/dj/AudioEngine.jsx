import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';

const MAX_SONG_DURATION = 180;
const TRANSITION_LEAD_TIME = 15;
const CROSSFADE_DURATION = 5;
const DUCK_VOLUME = 0.18;
const DUCK_TRANSITION = 4.5;
const SAFETY_FADE_SECONDS = 5;
const MICRO_CROSSFADE_DURATION = 1.2;

const AudioEngine = forwardRef(({ 
  onTrackEnd, 
  onTimeUpdate, 
  onTrackChange,
  musicFolder 
}, ref) => {
  const deckA = useRef(null);
  const deckB = useRef(null);
  const announcementAudio = useRef(null);
  const activeDeck = useRef('A');
  const masterVolume = useRef(0.8);
  const isPlayingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const fadeAnimationRef = useRef(null);
  const safetyFadeRef = useRef(null);
  const isDucked = useRef(false);
  const lastTimeUpdateRef = useRef(0);
  const duckAnimationRef = useRef(null);
  const crossfadeInProgressRef = useRef(false);

  const onTrackEndRef = useRef(onTrackEnd);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onTrackChangeRef = useRef(onTrackChange);
  useEffect(() => { onTrackEndRef.current = onTrackEnd; }, [onTrackEnd]);
  useEffect(() => { onTimeUpdateRef.current = onTimeUpdate; }, [onTimeUpdate]);
  useEffect(() => { onTrackChangeRef.current = onTrackChange; }, [onTrackChange]);

  useEffect(() => {
    deckA.current = new Audio();
    deckB.current = new Audio();
    announcementAudio.current = new Audio();
    
    deckA.current.volume = masterVolume.current;
    deckB.current.volume = 0;
    
    return () => {
      deckA.current?.pause();
      deckB.current?.pause();
      announcementAudio.current?.pause();
      if (fadeAnimationRef.current) cancelAnimationFrame(fadeAnimationRef.current);
      if (safetyFadeRef.current) cancelAnimationFrame(safetyFadeRef.current);
      if (duckAnimationRef.current) cancelAnimationFrame(duckAnimationRef.current);
    };
  }, []);

  const getActiveDeck = () => activeDeck.current === 'A' ? deckA.current : deckB.current;
  const getInactiveDeck = () => activeDeck.current === 'A' ? deckB.current : deckA.current;

  const deckAUrl = useRef(null);
  const deckBUrl = useRef(null);

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

  const equalPowerIn = (progress) => Math.sin(progress * Math.PI * 0.5);
  const equalPowerOut = (progress) => Math.cos(progress * Math.PI * 0.5);
  const clampVol = (v) => Math.max(0, Math.min(1, v));

  const cleanupDeck = useCallback((deckEl) => {
    const urlRef = deckEl === deckA.current ? deckAUrl : deckBUrl;
    if (urlRef.current) {
      if (urlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(urlRef.current);
      }
      urlRef.current = null;
    }
  }, []);

  const playTrack = useCallback(async (fileHandle, crossfade = true) => {
    const trackData = await loadTrack(fileHandle);
    if (!trackData) {
      console.error('❌ PlayTrack: loadTrack returned null — file unreadable');
      return false;
    }

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
    
    inactiveDeck.onended = null;
    inactiveDeck.ontimeupdate = null;
    activeDeckEl.onended = null;
    activeDeckEl.ontimeupdate = null;
    
    const inactiveUrlRef = inactiveDeck === deckA.current ? deckAUrl : deckBUrl;
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
    
    const effectiveDuration = Math.min(inactiveDeck.duration || MAX_SONG_DURATION, MAX_SONG_DURATION);
    setDuration(effectiveDuration);
    setCurrentTrack(trackData.name);
    setCurrentTime(0);
    lastTimeUpdateRef.current = 0;
    onTrackChangeRef.current?.(trackData.name);
    
    try {
      if (crossfade && isPlayingRef.current) {
        inactiveDeck.volume = 0;
        await inactiveDeck.play();
        
        const targetVolume = isDucked.current ? DUCK_VOLUME : masterVolume.current;
        const oldStartVolume = activeDeckEl.volume;
        const startTime = performance.now();
        const fadeDuration = CROSSFADE_DURATION * 1000;
        
        const animateFade = (currentTime) => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / fadeDuration, 1);
          
          inactiveDeck.volume = clampVol(equalPowerIn(progress) * targetVolume);
          activeDeckEl.volume = clampVol(equalPowerOut(progress) * oldStartVolume);
          
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
        const targetVolume = isDucked.current ? DUCK_VOLUME : masterVolume.current;
        const oldStartVolume = activeDeckEl.volume;
        inactiveDeck.volume = 0;
        await inactiveDeck.play();

        const startTime = performance.now();
        const fadeDuration = MICRO_CROSSFADE_DURATION * 1000;

        const animateMicroFade = (now) => {
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / fadeDuration, 1);

          inactiveDeck.volume = clampVol(equalPowerIn(progress) * targetVolume);
          activeDeckEl.volume = clampVol(equalPowerOut(progress) * oldStartVolume);

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
        inactiveDeck.volume = clampVol(isDucked.current ? DUCK_VOLUME : masterVolume.current);
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
    let transitionTriggered = false;
    let safetyFading = false;
    
    const startSafetyFade = () => {
      if (safetyFading || crossfadeInProgressRef.current) return;
      safetyFading = true;
      const fadeStartVolume = newDeck.volume;
      const fadeStart = performance.now();
      const fadeDur = SAFETY_FADE_SECONDS * 1000;
      
      const animateOut = (now) => {
        const elapsed = now - fadeStart;
        const progress = Math.min(elapsed / fadeDur, 1);
        newDeck.volume = clampVol(equalPowerOut(progress) * fadeStartVolume);
        
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
        const capped = Math.min(realDur, MAX_SONG_DURATION);
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
  }, [loadTrack, cleanupDeck]);

  const duck = useCallback(() => {
    if (duckAnimationRef.current) {
      cancelAnimationFrame(duckAnimationRef.current);
      duckAnimationRef.current = null;
    }
    isDucked.current = true;
    const deckAEl = deckA.current;
    const deckBEl = deckB.current;
    const startVolumeA = deckAEl.volume;
    const startVolumeB = deckBEl.volume;
    const startTime = performance.now();
    const dur = DUCK_TRANSITION * 1000;
    
    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / dur, 1);
      const curved = equalPowerOut(1 - progress);
      if (!deckAEl.paused) deckAEl.volume = clampVol(DUCK_VOLUME + (startVolumeA - DUCK_VOLUME) * curved);
      if (!deckBEl.paused) deckBEl.volume = clampVol(DUCK_VOLUME + (startVolumeB - DUCK_VOLUME) * curved);
      
      if (progress < 1) {
        duckAnimationRef.current = requestAnimationFrame(animate);
      } else {
        duckAnimationRef.current = null;
        if (!deckAEl.paused) deckAEl.volume = clampVol(DUCK_VOLUME);
        if (!deckBEl.paused) deckBEl.volume = clampVol(DUCK_VOLUME);
      }
    };
    
    duckAnimationRef.current = requestAnimationFrame(animate);
  }, []);

  const unduck = useCallback(() => {
    if (duckAnimationRef.current) {
      cancelAnimationFrame(duckAnimationRef.current);
      duckAnimationRef.current = null;
    }
    if (!isDucked.current) return;
    isDucked.current = false;
    const deckAEl = deckA.current;
    const deckBEl = deckB.current;
    const startVolumeA = deckAEl.volume;
    const startVolumeB = deckBEl.volume;
    const targetVolume = masterVolume.current;
    const startTime = performance.now();
    const dur = DUCK_TRANSITION * 1000;
    
    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / dur, 1);
      const curved = equalPowerIn(progress);
      if (!deckAEl.paused) deckAEl.volume = clampVol(startVolumeA + (targetVolume - startVolumeA) * curved);
      if (!deckBEl.paused) deckBEl.volume = clampVol(startVolumeB + (targetVolume - startVolumeB) * curved);
      
      if (progress < 1) {
        duckAnimationRef.current = requestAnimationFrame(animate);
      } else {
        duckAnimationRef.current = null;
        if (!deckAEl.paused) deckAEl.volume = clampVol(targetVolume);
        if (!deckBEl.paused) deckBEl.volume = clampVol(targetVolume);
      }
    };
    
    duckAnimationRef.current = requestAnimationFrame(animate);
  }, []);

  const NEAR_END_SECONDS = 3;

  const playAnnouncement = useCallback(async (audioUrl, { autoDuck = true, onNearEnd = null } = {}) => {
    return new Promise(async (resolve) => {
      if (announcementAudio.current) {
        announcementAudio.current.pause();
        announcementAudio.current.currentTime = 0;
      }
      
      if (autoDuck) duck();
      
      const isBlobUrl = audioUrl && audioUrl.startsWith('blob:');
      let resolved = false;
      let nearEndFired = false;
      const cleanupAndResolve = () => {
        if (resolved) return;
        resolved = true;
        if (announcementAudio.current) {
          announcementAudio.current.ontimeupdate = null;
        }
        if (isBlobUrl) {
          URL.revokeObjectURL(audioUrl);
        }
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
      
      announcementAudio.current.src = audioUrl;
      announcementAudio.current.volume = 1.0;
      announcementAudio.current.loop = false;
      
      announcementAudio.current.ontimeupdate = () => {
        if (nearEndFired || !onNearEnd) return;
        const ann = announcementAudio.current;
        if (ann && ann.duration && ann.duration > NEAR_END_SECONDS && ann.currentTime >= ann.duration - NEAR_END_SECONDS) {
          nearEndFired = true;
          onNearEnd();
        }
      };
      
      announcementAudio.current.onended = cleanupAndResolve;
      announcementAudio.current.onerror = (e) => {
        console.error('❌ Announcement audio error:', e?.target?.error?.message || 'unknown');
        cleanupAndResolve();
      };
      
      try {
        await announcementAudio.current.play();
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
    try {
      getActiveDeck().play().catch(err => {
        console.error('❌ Resume play failed:', err.message);
      });
    } catch (err) {
      console.error('❌ Resume failed:', err.message);
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
  }, []);

  const setVolume = useCallback((vol) => {
    masterVolume.current = clampVol(vol);
    if (!isDucked.current) {
      getActiveDeck().volume = clampVol(vol);
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
    isPlaying,
    currentTrack,
    currentTime,
    duration
  }));

  return null;
});

AudioEngine.displayName = 'AudioEngine';

export default AudioEngine;
