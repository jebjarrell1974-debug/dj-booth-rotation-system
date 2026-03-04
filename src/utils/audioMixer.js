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
    musicVolume = 0.25,
    duckLevel = 0.08,
    fadeInDuration = 1.0,
    fadeOutDuration = 2.0,
    voiceDelay = 1.5,
    duckAttack = 0.3,
    duckRelease = 0.5,
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

  const totalDuration = voiceDelay + voiceBuffer.duration + fadeOutDuration + 1.0;
  const sampleRate = 44100;
  const numChannels = Math.max(voiceBuffer.numberOfChannels, musicBuffer.numberOfChannels, 2);
  const offlineCtx = new OfflineAudioContext(numChannels, Math.ceil(totalDuration * sampleRate), sampleRate);

  const musicSource = offlineCtx.createBufferSource();
  musicSource.buffer = musicBuffer;
  musicSource.loop = true;

  const musicGain = offlineCtx.createGain();
  musicGain.gain.setValueAtTime(0, 0);
  musicGain.gain.linearRampToValueAtTime(musicVolume, fadeInDuration);

  const voiceRegions = detectVoiceActivity(voiceBuffer);
  for (const region of voiceRegions) {
    const duckStart = Math.max(fadeInDuration, voiceDelay + region.start - 0.1);
    const duckEnd = voiceDelay + region.end + 0.2;
    musicGain.gain.setValueAtTime(musicVolume, Math.max(0, duckStart - duckAttack));
    musicGain.gain.linearRampToValueAtTime(duckLevel, duckStart);
    musicGain.gain.setValueAtTime(duckLevel, duckEnd);
    musicGain.gain.linearRampToValueAtTime(musicVolume, duckEnd + duckRelease);
  }

  const fadeStart = totalDuration - fadeOutDuration;
  musicGain.gain.setValueAtTime(musicVolume, fadeStart);
  musicGain.gain.linearRampToValueAtTime(0, totalDuration);

  musicSource.connect(musicGain);
  musicGain.connect(offlineCtx.destination);
  musicSource.start(0);

  const voiceSource = offlineCtx.createBufferSource();
  voiceSource.buffer = voiceBuffer;
  const voiceGainNode = offlineCtx.createGain();
  voiceGainNode.gain.setValueAtTime(1.0, 0);
  voiceSource.connect(voiceGainNode);
  voiceGainNode.connect(offlineCtx.destination);
  voiceSource.start(voiceDelay);

  const rendered = await offlineCtx.startRendering();
  return encodeWav(rendered);
}
