/**
 * DJ Soundboard — Web Audio API synthesis
 * All 20 effects synthesized client-side; no audio files required.
 * playSoundboardEffect(soundId, audioCtx, gain)
 *   soundId   : string key for the effect
 *   audioCtx  : Web Audio AudioContext (caller manages lifecycle)
 *   gain      : final output level (musicVolume × boost, typically 0.5–3.0)
 */

const NOTE = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

function mkOsc(ctx, type, freq) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  return o;
}

function mkGain(ctx, val = 0) {
  const g = ctx.createGain();
  g.gain.value = val;
  return g;
}

function mkFilter(ctx, type, freq, q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function noiseBuffer(ctx, duration) {
  const len = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function playSoundboardEffect(soundId, audioCtx, gainLevel = 1.0) {
  const ctx = audioCtx;
  const t = ctx.currentTime + 0.015;
  const g = Math.max(0.01, gainLevel);

  switch (soundId) {

    case 'airhorn': {
      // Reggae air horn — sawtooth triad with low-pass shaping
      [[230, 0.7], [460, 0.35], [345, 0.25]].forEach(([freq, vol]) => {
        const o = mkOsc(ctx, 'sawtooth', freq);
        const flt = mkFilter(ctx, 'lowpass', 1800);
        const gn = mkGain(ctx, 0);
        o.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
        gn.gain.linearRampToValueAtTime(g * vol, t + 0.02);
        gn.gain.setValueAtTime(g * vol, t + 1.0);
        gn.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
        o.start(t); o.stop(t + 1.5);
      });
      break;
    }

    case 'scratch': {
      // Vinyl scratch — noise burst + pitched sweep
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.4);
      const flt = mkFilter(ctx, 'bandpass', 800, 2);
      const gn = mkGain(ctx, 0);
      src.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
      gn.gain.linearRampToValueAtTime(g * 1.1, t + 0.02);
      gn.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      src.start(t);
      // Tone overlay descending
      const o = mkOsc(ctx, 'sawtooth', 420);
      const og = mkGain(ctx, 0);
      o.connect(og); og.connect(ctx.destination);
      o.frequency.linearRampToValueAtTime(180, t + 0.35);
      og.gain.linearRampToValueAtTime(g * 0.45, t + 0.02);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      o.start(t); o.stop(t + 0.42);
      break;
    }

    case 'rewind': {
      // Tape rewind — descending sweep + flutter LFO
      const o = mkOsc(ctx, 'sawtooth', 820);
      const gn = mkGain(ctx, g * 0.55);
      o.connect(gn); gn.connect(ctx.destination);
      o.frequency.setValueAtTime(820, t);
      o.frequency.exponentialRampToValueAtTime(80, t + 0.85);
      gn.gain.setValueAtTime(g * 0.55, t);
      gn.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      // Flutter
      const lfo = mkOsc(ctx, 'sine', 22);
      const lfoG = mkGain(ctx, 90);
      lfo.connect(lfoG); lfoG.connect(o.frequency);
      lfo.start(t); lfo.stop(t + 0.9);
      o.start(t); o.stop(t + 0.95);
      break;
    }

    case 'bassdrop': {
      // Sub bass pitch-bomb: 85Hz → 28Hz
      const o = mkOsc(ctx, 'sine', 85);
      const gn = mkGain(ctx, 0);
      o.connect(gn); gn.connect(ctx.destination);
      o.frequency.setValueAtTime(85, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 0.55);
      gn.gain.linearRampToValueAtTime(g * 1.6, t + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      o.start(t); o.stop(t + 0.7);
      break;
    }

    case 'foghorn': {
      // Ship foghorn — deep sine + subtle sawtooth texture
      const o1 = mkOsc(ctx, 'sine', 92);
      const o2 = mkOsc(ctx, 'sawtooth', 92);
      const g1 = mkGain(ctx, 0);
      const g2 = mkGain(ctx, 0);
      o1.connect(g1); g1.connect(ctx.destination);
      o2.connect(g2); g2.connect(ctx.destination);
      g1.gain.linearRampToValueAtTime(g * 0.9, t + 0.3);
      g1.gain.setValueAtTime(g * 0.9, t + 1.6);
      g1.gain.exponentialRampToValueAtTime(0.001, t + 2.1);
      g2.gain.linearRampToValueAtTime(g * 0.18, t + 0.3);
      g2.gain.setValueAtTime(g * 0.18, t + 1.6);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 2.1);
      o1.start(t); o1.stop(t + 2.2);
      o2.start(t); o2.stop(t + 2.2);
      break;
    }

    case 'vinylstop': {
      // Record grinding to a halt
      const o = mkOsc(ctx, 'sawtooth', 440);
      const gn = mkGain(ctx, g * 0.5);
      o.connect(gn); gn.connect(ctx.destination);
      o.frequency.setValueAtTime(440, t);
      o.frequency.exponentialRampToValueAtTime(8, t + 0.75);
      gn.gain.setValueAtTime(g * 0.5, t);
      gn.gain.exponentialRampToValueAtTime(0.001, t + 0.82);
      o.start(t); o.stop(t + 0.9);
      break;
    }

    case 'siren': {
      // Air raid siren — two full sweeps 620→1220Hz
      const o = mkOsc(ctx, 'sawtooth', 620);
      const flt = mkFilter(ctx, 'lowpass', 2200);
      const gn = mkGain(ctx, 0);
      o.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
      o.frequency.setValueAtTime(620, t);
      o.frequency.linearRampToValueAtTime(1220, t + 0.5);
      o.frequency.linearRampToValueAtTime(620, t + 1.0);
      o.frequency.linearRampToValueAtTime(1220, t + 1.5);
      gn.gain.linearRampToValueAtTime(g * 0.5, t + 0.2);
      gn.gain.setValueAtTime(g * 0.5, t + 1.5);
      gn.gain.exponentialRampToValueAtTime(0.001, t + 1.85);
      o.start(t); o.stop(t + 2.0);
      break;
    }

    case 'woo': {
      // Ric Flair "WOOOO!" — ascending glide with vibrato tail
      const o = mkOsc(ctx, 'sine', 270);
      const gn = mkGain(ctx, 0);
      const vib = mkOsc(ctx, 'sine', 8);
      const vibG = mkGain(ctx, 0);
      vib.connect(vibG); vibG.connect(o.frequency);
      o.connect(gn); gn.connect(ctx.destination);
      o.frequency.setValueAtTime(270, t);
      o.frequency.linearRampToValueAtTime(700, t + 0.28);
      o.frequency.linearRampToValueAtTime(530, t + 0.5);
      vibG.gain.setValueAtTime(0, t + 0.3);
      vibG.gain.linearRampToValueAtTime(25, t + 0.5);
      gn.gain.linearRampToValueAtTime(g * 0.95, t + 0.05);
      gn.gain.setValueAtTime(g * 0.95, t + 0.45);
      gn.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
      o.start(t); o.stop(t + 0.8);
      vib.start(t); vib.stop(t + 0.8);
      break;
    }

    case 'crowdcheer': {
      // Crowd cheer — multi-band filtered noise
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 1.3);
      const flt = mkFilter(ctx, 'bandpass', 1100, 0.7);
      const gn = mkGain(ctx, 0);
      src.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
      gn.gain.linearRampToValueAtTime(g * 1.4, t + 0.28);
      gn.gain.setValueAtTime(g * 1.4, t + 0.9);
      gn.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      src.start(t);
      break;
    }

    case 'laser': {
      // Laser zap — frequency missile 1600→70Hz
      const o = mkOsc(ctx, 'sine', 1600);
      const gn = mkGain(ctx, 0);
      o.connect(gn); gn.connect(ctx.destination);
      o.frequency.setValueAtTime(1600, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.32);
      gn.gain.linearRampToValueAtTime(g * 0.85, t + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      o.start(t); o.stop(t + 0.42);
      break;
    }

    case 'bruh': {
      // "Bruh" — two-stage descending thud
      const o = mkOsc(ctx, 'sine', 330);
      const gn = mkGain(ctx, 0);
      o.connect(gn); gn.connect(ctx.destination);
      o.frequency.setValueAtTime(330, t);
      o.frequency.linearRampToValueAtTime(185, t + 0.13);
      o.frequency.linearRampToValueAtTime(145, t + 0.38);
      gn.gain.linearRampToValueAtTime(g * 0.9, t + 0.04);
      gn.gain.setValueAtTime(g * 0.9, t + 0.28);
      gn.gain.exponentialRampToValueAtTime(0.001, t + 0.52);
      o.start(t); o.stop(t + 0.58);
      break;
    }

    case 'vineboom': {
      // Vine boom — the one and only massive bass hit
      const o = mkOsc(ctx, 'sine', 58);
      const gn = mkGain(ctx, 0);
      o.connect(gn); gn.connect(ctx.destination);
      o.frequency.setValueAtTime(58, t);
      o.frequency.exponentialRampToValueAtTime(26, t + 0.55);
      gn.gain.linearRampToValueAtTime(g * 2.2, t + 0.005);
      gn.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
      o.start(t); o.stop(t + 0.9);
      break;
    }

    case 'johncena': {
      // John Cena 4-note brass sting: G4-C5-Bb4-Ab4 (da da da DAAA)
      [
        { midi: 67, st: 0,    dur: 0.14 },
        { midi: 72, st: 0.17, dur: 0.14 },
        { midi: 70, st: 0.34, dur: 0.14 },
        { midi: 68, st: 0.51, dur: 0.65 },
      ].forEach(({ midi, st, dur }) => {
        const freq = NOTE(midi);
        const o = mkOsc(ctx, 'sawtooth', freq);
        const flt = mkFilter(ctx, 'lowpass', 1700);
        const gn = mkGain(ctx, 0);
        o.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
        gn.gain.setValueAtTime(0, t + st);
        gn.gain.linearRampToValueAtTime(g * 0.7, t + st + 0.02);
        gn.gain.setValueAtTime(g * 0.7, t + st + dur);
        gn.gain.exponentialRampToValueAtTime(0.001, t + st + dur + 0.1);
        o.start(t + st); o.stop(t + st + dur + 0.15);
      });
      break;
    }

    case 'ohyeah': {
      // "Oh Yeah" — G4-B4-D5 ascending arpeggio (Ferris Bueller vibes)
      [67, 71, 74].forEach((midi, i) => {
        const freq = NOTE(midi);
        const o = mkOsc(ctx, 'sine', freq);
        const gn = mkGain(ctx, 0);
        o.connect(gn); gn.connect(ctx.destination);
        const st = t + i * 0.22;
        gn.gain.linearRampToValueAtTime(g * 0.82, st + 0.03);
        gn.gain.setValueAtTime(g * 0.82, st + 0.2);
        gn.gain.exponentialRampToValueAtTime(0.001, st + 0.45);
        o.start(st); o.stop(st + 0.5);
      });
      break;
    }

    case 'sadtrombone': {
      // Sad trombone — Bb4-Ab4-G4-F4 descending chromatic slides
      const melody = [70, 68, 67, 65];
      melody.forEach((midi, i) => {
        const freq = NOTE(midi);
        const nextFreq = i < melody.length - 1 ? NOTE(melody[i + 1]) : freq * 0.88;
        const o = mkOsc(ctx, 'sawtooth', freq);
        const flt = mkFilter(ctx, 'lowpass', 1200);
        const gn = mkGain(ctx, 0);
        o.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
        const st = t + i * 0.3;
        o.frequency.setValueAtTime(freq, st);
        o.frequency.linearRampToValueAtTime(nextFreq, st + 0.3);
        gn.gain.setValueAtTime(0, st);
        gn.gain.linearRampToValueAtTime(g * 0.5, st + 0.03);
        gn.gain.setValueAtTime(g * 0.5, st + 0.24);
        gn.gain.exponentialRampToValueAtTime(0.001, st + 0.32);
        o.start(st); o.stop(st + 0.38);
      });
      break;
    }

    case 'getout': {
      // "Get Out!" — sharp noise burst + low tone stab
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.18);
      const flt = mkFilter(ctx, 'highpass', 900);
      const gn = mkGain(ctx, g * 1.3);
      src.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
      gn.gain.setValueAtTime(g * 1.3, t);
      gn.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      src.start(t);
      // Low punch
      const o = mkOsc(ctx, 'square', 210);
      const og = mkGain(ctx, 0);
      o.connect(og); og.connect(ctx.destination);
      og.gain.linearRampToValueAtTime(g * 0.75, t + 0.01);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.start(t); o.stop(t + 0.26);
      break;
    }

    case 'boomshakalaka': {
      // Boomshakalaka! — 3 bouncy bass+click combos
      [0, 0.26, 0.48].forEach((delay) => {
        const bass = mkOsc(ctx, 'sine', 82);
        const bassG = mkGain(ctx, 0);
        bass.connect(bassG); bassG.connect(ctx.destination);
        const st = t + delay;
        bassG.gain.linearRampToValueAtTime(g * 1.3, st + 0.01);
        bassG.gain.exponentialRampToValueAtTime(0.001, st + 0.2);
        bass.start(st); bass.stop(st + 0.22);
        // Click transient
        const clkSrc = ctx.createBufferSource();
        clkSrc.buffer = noiseBuffer(ctx, 0.04);
        const clkG = mkGain(ctx, g * 0.5);
        clkSrc.connect(clkG); clkG.connect(ctx.destination);
        clkSrc.start(st);
      });
      break;
    }

    case 'mlghorn': {
      // MLG — 3 stacked airhorns fired in rapid succession
      [0, 0.07, 0.14].forEach((delay) => {
        [[230, 0.5], [460, 0.28], [345, 0.2]].forEach(([freq, vol]) => {
          const o = mkOsc(ctx, 'sawtooth', freq);
          const flt = mkFilter(ctx, 'lowpass', 1800);
          const gn = mkGain(ctx, 0);
          o.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
          const st = t + delay;
          gn.gain.linearRampToValueAtTime(g * vol, st + 0.02);
          gn.gain.setValueAtTime(g * vol, st + 0.75);
          gn.gain.exponentialRampToValueAtTime(0.001, st + 1.05);
          o.start(st); o.stop(st + 1.1);
        });
      });
      break;
    }

    case 'spongebob': {
      // SpongeBob transition — 4 quick goofy ascending tones
      [60, 64, 67, 72].forEach((midi, i) => {
        const freq = NOTE(midi);
        const o = mkOsc(ctx, 'sine', freq);
        const gn = mkGain(ctx, 0);
        o.connect(gn); gn.connect(ctx.destination);
        const st = t + i * 0.11;
        gn.gain.linearRampToValueAtTime(g * 0.72, st + 0.02);
        gn.gain.setValueAtTime(g * 0.72, st + 0.07);
        gn.gain.exponentialRampToValueAtTime(0.001, st + 0.13);
        o.start(st); o.stop(st + 0.18);
      });
      break;
    }

    case 'itslit': {
      // "It's Lit!" — big C major chord stab (C-E-G-C)
      [60, 64, 67, 72].forEach((midi) => {
        const freq = NOTE(midi);
        const o = mkOsc(ctx, 'sawtooth', freq);
        const flt = mkFilter(ctx, 'lowpass', 3200);
        const gn = mkGain(ctx, 0);
        o.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
        gn.gain.linearRampToValueAtTime(g * 0.5, t + 0.01);
        gn.gain.setValueAtTime(g * 0.5, t + 0.28);
        gn.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        o.start(t); o.stop(t + 0.9);
      });
      break;
    }

    default:
      console.warn('🎛️ Soundboard: unknown effect:', soundId);
  }
}
