import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYSIS_BODY_TIMEOUT_MS,
  createBackgroundAnalysisQueue,
  normalizeAudioCacheKey,
  withAnalysisDeadline,
  waitForMediaReady,
} from './audioStartup.js';

const never = () => new Promise(() => {});

function createMedia({ readyState = 0 } = {}) {
  const listeners = new Map();
  return {
    readyState,
    addEventListener(type, listener) {
      const current = listeners.get(type) || new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener({ target: this, ...event });
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
  };
}

test('a never-resolving analysis is scheduled without blocking the caller', async () => {
  let started = false;
  const queue = createBackgroundAnalysisQueue();

  assert.equal(queue.schedule('track-a', async () => {
    started = true;
    return never();
  }), true);
  assert.equal(queue.has('track-a'), true);
  assert.equal(queue.schedule('track-a', never), false);
  assert.equal(started, false, 'the analyzer starts after the playback turn');

  await Promise.resolve();
  assert.equal(started, true);
  assert.equal(queue.size(), 1, 'an in-flight analysis remains deduplicated');
  queue.clear();
});

test('clearing a cancelled analysis frees a slot even if its work never settles', async () => {
  const queue = createBackgroundAnalysisQueue({ maxConcurrent: 1, maxPending: 1 });
  let replacementStarted = false;
  queue.schedule('stuck', never);
  await Promise.resolve();
  queue.clear();
  assert.equal(queue.schedule('replacement', () => {
    replacementStarted = true;
    return Promise.resolve();
  }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(replacementStarted, true);
  queue.clear();
});

test('relative metadata and browser-expanded media URLs share one cache key', () => {
  const base = 'https://booth.example/kiosk/';
  assert.equal(
    normalizeAudioCacheKey('/music/promo.mp3', base),
    normalizeAudioCacheKey('https://booth.example/music/promo.mp3', base),
  );
  assert.equal(
    normalizeAudioCacheKey('music/promo.mp3?rev=2', base),
    'https://booth.example/kiosk/music/promo.mp3?rev=2',
  );
  assert.equal(
    normalizeAudioCacheKey('blob:https://booth.example/track-id', base),
    'https://booth.example/track-id',
  );
});

test('a replacement owner can ignore a stale analysis callback', async () => {
  const queue = createBackgroundAnalysisQueue();
  const applied = [];
  let owner = 'old';
  queue.schedule('shared-track', () => Promise.resolve({ gain: 1.8 }), {
    onResult: result => {
      if (owner === 'old') applied.push(`old:${result.gain}`);
    },
  });
  queue.schedule('shared-track', () => Promise.resolve({ gain: 1.8 }), {
    onResult: result => {
      if (owner === 'new') applied.push(`new:${result.gain}`);
    },
  });
  owner = 'new';
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(applied, ['new:1.8']);
  queue.clear();
});

test('analysis queue bounds pending work and aborts it on clear', async () => {
  const queue = createBackgroundAnalysisQueue({ maxConcurrent: 1, maxPending: 2 });
  let started = 0;
  let aborted = false;
  const blocked = signal => new Promise(resolve => {
    started++;
    signal.addEventListener('abort', () => {
      aborted = true;
      resolve();
    }, { once: true });
  });

  assert.equal(queue.schedule('one', blocked), true);
  assert.equal(queue.schedule('two', blocked), true);
  assert.equal(queue.schedule('three', blocked), false);
  await Promise.resolve();
  assert.equal(started, 1, 'concurrency is capped');
  queue.clear();
  assert.equal(queue.size(), 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(aborted, true);
});

test('body/decode/render-style work gets a deterministic deadline', async () => {
  await assert.rejects(
    withAnalysisDeadline(never, {
      timeoutMs: ANALYSIS_BODY_TIMEOUT_MS > 0 ? 1 : 0,
      label: 'body',
    }),
    error => error?.name === 'TimeoutError' && /body timed out/.test(error.message),
  );

  const controller = new AbortController();
  const cancelled = withAnalysisDeadline(never, {
    signal: controller.signal,
    timeoutMs: 1000,
    label: 'decode',
  });
  controller.abort();
  await assert.rejects(cancelled, error => error?.name === 'AbortError');
});

test('readiness timeout settles a media wait with no dangling listeners', async () => {
  const media = createMedia();
  await assert.rejects(
    waitForMediaReady(media, { timeoutMs: 1 }),
    /timed out/,
  );
  assert.equal(media.listenerCount('canplay'), 0);
  assert.equal(media.listenerCount('error'), 0);
});

test('a stale owner cannot let a replacement canplay start the old wait', async () => {
  const media = createMedia();
  const oldController = new AbortController();
  let owner = 'old';
  const oldReady = waitForMediaReady(media, {
    signal: oldController.signal,
    isCurrent: () => owner === 'old',
    timeoutMs: 1000,
  });

  owner = 'new';
  oldController.abort();
  await assert.rejects(oldReady, error => error?.name === 'AbortError');

  const replacement = waitForMediaReady(media, {
    isCurrent: () => owner === 'new',
    timeoutMs: 1000,
  });
  media.readyState = 3;
  media.emit('canplay');
  await replacement;
  assert.equal(media.listenerCount('canplay'), 0);
});

test('an error settles readiness before canplay and removes ownership listeners', async () => {
  const media = createMedia();
  const ready = waitForMediaReady(media, { timeoutMs: 1000 });

  media.emit('error', { target: { error: { message: 'decode failed' } } });
  await assert.rejects(ready, /decode failed/);
  media.readyState = 3;
  media.emit('canplay');
  assert.equal(media.listenerCount('canplay'), 0);
});