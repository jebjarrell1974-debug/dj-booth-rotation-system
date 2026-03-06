async function decodeAudio(audioContext, blob) {
  const arrayBuffer = await blob.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
}

function detectVoiceActivity(audioBuffer, threshold = 0.02, mergeGap = 0.8) {
  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const blockSize = Math.floor(sampleRate * 0.05);
  const rawRegions = [];
  let inVoice = false;
  let start = 0;

  for (let i = 0; i < data.length; i += blockSize) {
    let sum = 0;
    const end = Math.min(i + blockSize, data.length);
    for (let j = i; j < end; j++) {
      sum += Math.abs(data[j]);
    }
    const avg = sum / (end - i);

    if (avg > threshold && !inVoice) {
      inVoice = true;
      start = i / sampleRate;
    } else if (avg <= threshold && inVoice) {
      inVoice = false;
      rawRegions.push({ start, end: i / sampleRate });
    }
  }
  if (inVoice) {
    rawRegions.push({ start, end: audioBuffer.duration });
  }

  if (rawRegions.length <= 1) return rawRegions;
  const merged = [rawRegions[0]];
  for (let i = 1; i < rawRegions.length; i++) {
    const prev = merged[merged.length - 1];
    if (rawRegions[i].start - prev.end <= mergeGap) {
      prev.end = rawRegions[i].end;
    } else {
      merged.push(rawRegions[i]);
    }
  }
  return merged;
}

function encodeWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const buffer = new ArrayBuffer(44 + length * numChannels * 2);
  const view = new DataView(buffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * numChannels * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length * numChannels * 2, true);

  let offset = 44;
  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch));
  }

  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

async function encodeMp3(audioBuffer, bitrate = 320) {
  const lamejs = await import('@breezystack/lamejs');
  const Mp3Encoder = lamejs.Mp3Encoder;

  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;

  const encoder = new Mp3Encoder(numChannels, sampleRate, bitrate);
  const mp3Data = [];
  const blockSize = 1152;

  if (numChannels === 1) {
    const chan = audioBuffer.getChannelData(0);
    const int16 = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      const s = Math.max(-1, Math.min(1, chan[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    for (let i = 0; i < int16.length; i += blockSize) {
      const chunk = int16.subarray(i, i + blockSize);
      const buf = encoder.encodeBuffer(chunk);
      if (buf.length > 0) mp3Data.push(buf);
    }
  } else {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(Math.min(1, numChannels - 1));
    const leftInt16 = new Int16Array(length);
    const rightInt16 = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      let s = Math.max(-1, Math.min(1, left[i]));
      leftInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      s = Math.max(-1, Math.min(1, right[i]));
      rightInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    for (let i = 0; i < leftInt16.length; i += blockSize) {
      const lChunk = leftInt16.subarray(i, i + blockSize);
      const rChunk = rightInt16.subarray(i, i + blockSize);
      const buf = encoder.encodeBuffer(lChunk, rChunk);
      if (buf.length > 0) mp3Data.push(buf);
    }
  }

  const flush = encoder.flush();
  if (flush.length > 0) mp3Data.push(flush);

  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

function applyTruePeakLimiting(audioBuffer, ceiling = -1.0) {
  const ceilingLinear = Math.pow(10, ceiling / 20);
  const attack = 0.001;
  const release = 0.05;
  const sampleRate = audioBuffer.sampleRate;
  const attackSamples = Math.ceil(attack * sampleRate);
  const releaseSamples = Math.ceil(release * sampleRate);

  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    const gainReduction = new Float32Array(data.length);
    gainReduction.fill(1.0);

    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > ceilingLinear) {
        const neededGain = ceilingLinear / abs;
        for (let j = Math.max(0, i - attackSamples); j <= i; j++) {
          const blend = (i - j) / attackSamples;
          const g = 1.0 - (1.0 - neededGain) * (1.0 - blend);
          if (g < gainReduction[j]) gainReduction[j] = g;
        }
        for (let j = i; j < Math.min(data.length, i + releaseSamples); j++) {
          const blend = (j - i) / releaseSamples;
          const g = neededGain + (1.0 - neededGain) * blend;
          if (g < gainReduction[j]) gainReduction[j] = g;
        }
      }
    }

    for (let i = 0; i < data.length; i++) {
      data[i] *= gainReduction[i];
    }
  }
}

export const SFX_OPTIONS = [
  { id: 'none', label: 'None' },
  { id: 'deep-impact', label: 'Deep Impact' },
  { id: 'cinematic-hit', label: 'Cinematic Hit' },
  { id: 'whoosh-rise', label: 'Whoosh Rise' },
  { id: 'whoosh-fall', label: 'Whoosh Fall' },
  { id: 'bass-drop', label: 'Bass Drop' },
  { id: 'laser-sweep', label: 'Laser Sweep' },
  { id: 'reverse-cymbal', label: 'Reverse Cymbal' },
  { id: 'air-horn', label: 'Air Horn' },
  { id: 'dj-scratch', label: 'DJ Scratch' },
  { id: 'power-down', label: 'Power Down' },
];

async function loadSfx(audioContext, sfxId) {
  if (!sfxId || sfxId === 'none') return null;
  const res = await fetch(`/sfx/${sfxId}.wav`);
  if (!res.ok) return null;
  const blob = await res.blob();
  return decodeAudio(audioContext, blob);
}

export async function mixPromo(voiceBlob, musicBlob, options = {}) {
  const {
    fullMusicIntro = 5.0,
    fullMusicOutro = 5.0,
    duckLevel = 0.12,
    voiceDelay = 0.5,
    duckAttack = 0.5,
    duckRelease = 0.8,
    voiceGain = 1.3,
    introSfx = 'none',
    outroSfx = 'none',
    sfxGain = 0.7,
    outputFormat = 'mp3',
  } = options;

  const tempCtx = new AudioContext({ sampleRate: 44100 });
  let voiceBuffer, musicBuffer, introSfxBuffer, outroSfxBuffer;
  try {
    const decodePromises = [
      decodeAudio(tempCtx, voiceBlob),
      decodeAudio(tempCtx, musicBlob),
    ];

    if (introSfx && introSfx !== 'none') {
      decodePromises.push(loadSfx(tempCtx, introSfx));
    }
    if (outroSfx && outroSfx !== 'none') {
      decodePromises.push(loadSfx(tempCtx, outroSfx));
    }

    const results = await Promise.all(decodePromises);
    voiceBuffer = results[0];
    musicBuffer = results[1];
    if (introSfx && introSfx !== 'none') introSfxBuffer = results[2];
    if (outroSfx && outroSfx !== 'none') {
      outroSfxBuffer = results[introSfx && introSfx !== 'none' ? 3 : 2];
    }
  } finally {
    tempCtx.close();
  }

  const introSfxDur = introSfxBuffer ? introSfxBuffer.duration : 0;
  const outroSfxDur = outroSfxBuffer ? outroSfxBuffer.duration : 0;

  const introSfxOffset = introSfxBuffer ? Math.max(0, fullMusicIntro - introSfxDur * 0.5) : 0;
  const voiceStart = fullMusicIntro + voiceDelay;
  const voiceEnd = voiceStart + voiceBuffer.duration;
  const outroSfxOffset = outroSfxBuffer ? voiceEnd + 0.3 : 0;
  const totalDuration = Math.max(
    voiceEnd + fullMusicOutro,
    outroSfxBuffer ? outroSfxOffset + outroSfxDur + 0.5 : 0
  );

  const sampleRate = 44100;
  const numChannels = Math.max(voiceBuffer.numberOfChannels, musicBuffer.numberOfChannels, 2);
  const offlineCtx = new OfflineAudioContext(numChannels, Math.ceil(totalDuration * sampleRate), sampleRate);

  const musicSource = offlineCtx.createBufferSource();
  musicSource.buffer = musicBuffer;
  musicSource.loop = true;

  const musicGainNode = offlineCtx.createGain();
  musicGainNode.gain.setValueAtTime(1.0, 0);

  const voiceRegions = detectVoiceActivity(voiceBuffer);
  if (voiceRegions.length > 0) {
    const firstVoiceStart = voiceStart + voiceRegions[0].start;
    const duckBegin = Math.max(0, firstVoiceStart - duckAttack);
    musicGainNode.gain.setValueAtTime(1.0, duckBegin);
    musicGainNode.gain.linearRampToValueAtTime(duckLevel, firstVoiceStart);

    for (let i = 0; i < voiceRegions.length; i++) {
      const region = voiceRegions[i];
      const regionStart = voiceStart + region.start;
      const regionEnd = voiceStart + region.end;

      musicGainNode.gain.setValueAtTime(duckLevel, regionStart);

      if (i < voiceRegions.length - 1) {
        const nextRegionStart = voiceStart + voiceRegions[i + 1].start;
        const gap = nextRegionStart - regionEnd;
        if (gap > duckRelease + duckAttack + 0.5) {
          musicGainNode.gain.linearRampToValueAtTime(1.0, regionEnd + duckRelease);
          musicGainNode.gain.setValueAtTime(1.0, nextRegionStart - duckAttack);
          musicGainNode.gain.linearRampToValueAtTime(duckLevel, nextRegionStart);
        } else {
          musicGainNode.gain.setValueAtTime(duckLevel, regionEnd);
        }
      }
    }

    const lastVoiceEnd = voiceStart + voiceRegions[voiceRegions.length - 1].end;
    musicGainNode.gain.setValueAtTime(duckLevel, lastVoiceEnd);
    musicGainNode.gain.linearRampToValueAtTime(1.0, lastVoiceEnd + duckRelease);
  }

  musicGainNode.gain.setValueAtTime(1.0, totalDuration - 0.01);

  musicSource.connect(musicGainNode);
  musicGainNode.connect(offlineCtx.destination);
  musicSource.start(0);

  const voiceSource = offlineCtx.createBufferSource();
  voiceSource.buffer = voiceBuffer;
  const voiceGainNode = offlineCtx.createGain();
  voiceGainNode.gain.setValueAtTime(voiceGain, 0);
  voiceSource.connect(voiceGainNode);
  voiceGainNode.connect(offlineCtx.destination);
  voiceSource.start(voiceStart);

  if (introSfxBuffer) {
    const sfxSource = offlineCtx.createBufferSource();
    sfxSource.buffer = introSfxBuffer;
    const sfxGainNode = offlineCtx.createGain();
    sfxGainNode.gain.setValueAtTime(sfxGain, 0);
    sfxSource.connect(sfxGainNode);
    sfxGainNode.connect(offlineCtx.destination);
    sfxSource.start(introSfxOffset);
  }

  if (outroSfxBuffer) {
    const sfxSource = offlineCtx.createBufferSource();
    sfxSource.buffer = outroSfxBuffer;
    const sfxGainNode = offlineCtx.createGain();
    sfxGainNode.gain.setValueAtTime(sfxGain, 0);
    sfxSource.connect(sfxGainNode);
    sfxGainNode.connect(offlineCtx.destination);
    sfxSource.start(outroSfxOffset);
  }

  const rendered = await offlineCtx.startRendering();

  const targetLUFS = -10;

  let sumSquares = 0;
  let sampleCount = 0;
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    const data = rendered.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      sumSquares += data[i] * data[i];
      sampleCount++;
    }
  }
  const rms = Math.sqrt(sumSquares / Math.max(sampleCount, 1));
  const currentLUFS = 20 * Math.log10(Math.max(rms, 1e-10));
  const lufsGain = Math.pow(10, (targetLUFS - currentLUFS) / 20);

  let maxSample = 0;
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    const data = rendered.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > maxSample) maxSample = abs;
    }
  }

  const peakCeiling = 0.89;
  const peakAfterLufs = maxSample * lufsGain;
  const finalGain = peakAfterLufs > peakCeiling
    ? lufsGain * (peakCeiling / peakAfterLufs)
    : lufsGain;

  if (Math.abs(finalGain - 1.0) > 0.01) {
    for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
      const data = rendered.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] *= finalGain;
      }
    }
    console.log(`🔊 PromoMix: LUFS=${currentLUFS.toFixed(1)}dB → target=${targetLUFS}dB, gain=${finalGain.toFixed(2)}x, peak=${(peakAfterLufs).toFixed(2)}`);
  }

  applyTruePeakLimiting(rendered, -1.0);

  if (outputFormat === 'mp3') {
    return encodeMp3(rendered, 320);
  }
  return encodeWav(rendered);
}
