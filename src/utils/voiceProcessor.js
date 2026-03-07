export function trimSilence(audioBuffer, threshold = 0.01) {
  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const blockSize = Math.floor(sampleRate * 0.01);

  let startSample = 0;
  let endSample = data.length;

  for (let i = 0; i < data.length; i += blockSize) {
    const end = Math.min(i + blockSize, data.length);
    let sum = 0;
    for (let j = i; j < end; j++) {
      sum += data[j] * data[j];
    }
    const rms = Math.sqrt(sum / (end - i));
    if (rms > threshold) {
      startSample = Math.max(0, i - blockSize);
      break;
    }
  }

  for (let i = data.length - blockSize; i >= 0; i -= blockSize) {
    const end = Math.min(i + blockSize, data.length);
    let sum = 0;
    for (let j = i; j < end; j++) {
      sum += data[j] * data[j];
    }
    const rms = Math.sqrt(sum / (end - i));
    if (rms > threshold) {
      endSample = Math.min(data.length, end + blockSize);
      break;
    }
  }

  if (startSample >= endSample) {
    return audioBuffer;
  }

  const trimmedLength = endSample - startSample;
  const numChannels = audioBuffer.numberOfChannels;
  const trimmedBuffer = new OfflineAudioContext(numChannels, trimmedLength, sampleRate).createBuffer(numChannels, trimmedLength, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const src = audioBuffer.getChannelData(ch);
    const dst = trimmedBuffer.getChannelData(ch);
    for (let i = 0; i < trimmedLength; i++) {
      dst[i] = src[startSample + i];
    }
  }

  return trimmedBuffer;
}

export function normalizeBuffer(audioBuffer, targetPeak = -1) {
  const targetLinear = Math.pow(10, targetPeak / 20);

  let maxSample = 0;
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > maxSample) maxSample = abs;
    }
  }

  if (maxSample === 0) return audioBuffer;

  const gain = targetLinear / maxSample;

  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      data[i] *= gain;
    }
  }

  return audioBuffer;
}

export async function encodeToMp3(audioBuffer, bitrate = 192) {
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

async function processWithAuphonic(audioBlob, authHeaders) {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

  const resp = await fetch('/api/auphonic/process', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({ audio_base64: base64 }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || 'Auphonic processing failed');
  }

  const data = await resp.json();
  const binaryStr = atob(data.audio_base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const processedBlob = new Blob([bytes], { type: 'audio/mpeg' });

  const tempCtx = new AudioContext();
  const decoded = await tempCtx.decodeAudioData(bytes.buffer.slice(0));
  tempCtx.close();
  const durationMs = Math.round(decoded.duration * 1000);

  return { processedMp3Blob: processedBlob, durationMs };
}

function processLocally(decoded) {
  const sampleRate = 44100;
  const numChannels = 1;
  const offlineCtx = new OfflineAudioContext(numChannels, decoded.length, sampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;

  const hpf = offlineCtx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 60;
  hpf.Q.value = 0.707;

  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.15;

  const presenceEq = offlineCtx.createBiquadFilter();
  presenceEq.type = 'peaking';
  presenceEq.frequency.value = 5000;
  presenceEq.gain.value = 1.5;
  presenceEq.Q.value = 1.0;

  source.connect(hpf);
  hpf.connect(compressor);
  compressor.connect(presenceEq);
  presenceEq.connect(offlineCtx.destination);

  source.start(0);
  return offlineCtx.startRendering();
}

export async function processRecording(audioBlob, authHeaders = {}) {
  const rawBlob = new Blob([audioBlob], { type: audioBlob.type });

  try {
    const result = await processWithAuphonic(audioBlob, authHeaders);
    return {
      processedMp3Blob: result.processedMp3Blob,
      rawBlob,
      durationMs: result.durationMs,
      processedBy: 'auphonic',
    };
  } catch (auphonicErr) {
    console.warn('Auphonic unavailable, falling back to local processing:', auphonicErr.message);
  }

  const arrayBuffer = await audioBlob.arrayBuffer();
  const tempCtx = new AudioContext({ sampleRate: 44100 });
  let decoded;
  try {
    decoded = await tempCtx.decodeAudioData(arrayBuffer);
  } finally {
    tempCtx.close();
  }

  let processed = await processLocally(decoded);
  processed = trimSilence(processed, 0.01);
  normalizeBuffer(processed, -1);

  const durationMs = Math.round((processed.length / processed.sampleRate) * 1000);
  const processedMp3Blob = await encodeToMp3(processed, 192);

  return {
    processedMp3Blob,
    rawBlob,
    durationMs,
    processedBy: 'local',
  };
}
