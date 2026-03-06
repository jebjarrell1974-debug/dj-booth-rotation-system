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

export async function mixPromo(voiceBlob, musicBlob, options = {}) {
  const {
    fullMusicIntro = 5.0,
    fullMusicOutro = 5.0,
    duckLevel = 0.12,
    voiceDelay = 0.5,
    duckAttack = 0.5,
    duckRelease = 0.8,
    voiceGain = 1.3,
  } = options;

  const tempCtx = new AudioContext({ sampleRate: 44100 });
  let voiceBuffer, musicBuffer;
  try {
    [voiceBuffer, musicBuffer] = await Promise.all([
      decodeAudio(tempCtx, voiceBlob),
      decodeAudio(tempCtx, musicBlob),
    ]);
  } finally {
    tempCtx.close();
  }

  const voiceStart = fullMusicIntro + voiceDelay;
  const voiceEnd = voiceStart + voiceBuffer.duration;
  const totalDuration = voiceEnd + fullMusicOutro;
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

  const rendered = await offlineCtx.startRendering();

  const targetPeak = 0.95;
  let maxSample = 0;
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    const data = rendered.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > maxSample) maxSample = abs;
    }
  }
  if (maxSample > 0.001) {
    const normFactor = targetPeak / maxSample;
    if (normFactor > 1.0 || normFactor < 0.95) {
      for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
        const data = rendered.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
          data[i] *= normFactor;
        }
      }
    }
  }

  return encodeWav(rendered);
}
