import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createPlaybackOwnership, claimPlaybackOwnership, ownsPlaybackOperation,
  shouldHoldSkipTransition,
} from './playbackOwnership.js';
import { planSkipAdvance } from './skipPlayback.js';
import { beginActiveSet, createActiveSetCursor, ownsActiveSet } from './activeSetCursor.js';

// Execute the real component callback, including its later nextDancer lexical
// declaration. Testing a rewritten model would miss the break branch's TDZ.
const source = readFileSync(new URL('../pages/DJBooth.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  const handleSkip = useCallback(async (opts = {}) => {');
const end = source.indexOf('  handleSkipRef.current = handleSkip;', start);
assert.ok(start >= 0 && end > start, 'actual skip callback must exist');
const callback = source.slice(start, end);
// opts's default {} precedes the function body, so find the callback arrow.
const actualBody = callback.slice(callback.indexOf('=> {') + 4, callback.lastIndexOf('\n  }, ['));
assert.ok(actualBody && callback.lastIndexOf('\n  }, [') > 0);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const skip = new AsyncFunction('opts', 'env', `with (env) { ${actualBody} }`);

function fixture({ announcements = false, cached = true, playable = true, resolvable = true } = {}) {
  const track = { name: 'DJ saved break.mp3', url: '/selected-break', genre: 'Rock' };
  const queue = ['DJ saved break.mp3'];
  const cursor = beginActiveSet(createActiveSetCursor(), {
    dancerId: 'finished', setLength: 1, generation: 7,
  });
  const env = {
    console: { log() {}, warn() {}, error(...args) { env.errors.push(args); } },
    lastSkipTimeRef: { current: 0 },
    isRotationActiveRef: { current: true },
    rotationRef: { current: ['finished', 'incoming'] },
    currentDancerIndexRef: { current: 0 },
    currentSongNumberRef: { current: 1 },
    activeSetCursorRef: { current: { ...cursor, songNumber: 1 } },
    playbackOwnershipRef: { current: createPlaybackOwnership() },
    audioEngineRef: { current: {
      async cancelPendingTrackStart() {}, duck() {}, unduck() {},
    } },
    watchdogRecoveringRef: { current: false },
    transitionInProgressRef: { current: false },
    transitionStartTimeRef: { current: 0 },
    lastAudioActivityRef: { current: 0 },
    playingCommercialRef: { current: false },
    playingInterstitialRef: { current: false },
    playingInterstitialBreakKeyRef: { current: null },
    interstitialIndexRef: { current: 0 },
    announcementsEnabledRef: { current: announcements },
    isPlayingRef: { current: false },
    announcementsEnabled: announcements,
    rotationSongsRef: { current: {
      finished: [{ name: 'finishing.mp3', url: '/finishing' }],
      incoming: [{ name: 'her one.mp3', url: '/her-one' }, { name: 'her two.mp3', url: '/her-two' }],
    } },
    dancersRef: { current: [
      { id: 'finished', name: 'Finished performer' },
      { id: 'incoming', name: 'Incoming performer' },
    ] },
    interstitialSongsRef: { current: { 'after-finished': queue } },
    manualInterstitialBreaksRef: { current: { 'after-finished': true } },
    djOptionsRef: { current: {} },
    tracks: cached ? [track] : [],
    breakSongsPerSetRef: { current: 0 },
    featureSetupActiveRef: { current: null },
    pendingCommercialBoundaryRef: { current: null },
    pendingBreakHandoffRef: { current: null },
    rotationAssignmentVersionRef: { current: 0 },
    djSavedManualRef: { current: { finished: true } },
    locateCursorDancer: (active, rotation) => rotation.indexOf(active.dancerId),
    ownsActiveSet,
    effectiveSongsPerSet: () => 1,
    isManualSet: () => true,
    getSongName: track => typeof track === 'string' ? track : track?.name,
    cancelMusicAvailabilityChecks() {},
    claimPlaybackOwnership, ownsPlaybackOperation, shouldHoldSkipTransition,
    planSkipAdvance,
    auditEvent() {}, logDiag() {},
    filterAutomaticBreakSongs: songs => songs,
    consumeCommercialBoundary: () => null,
    nextCommercialBoundaryKey: () => 'test-boundary',
    clearManualSetState() {},
    flushPendingServerSongsPerSet() {},
    setRotation() {}, setCurrentDancerIndex() {}, setCurrentSongNumber() {},
    commitRotationSongs: songs => { env.rotationSongsRef.current = songs; },
    updateStageState() {},
    setActiveBreakInfo: info => { env.activeBreakInfo = info; },
    async resolveTrackByName(name) {
      env.resolvedName = name;
      return resolvable ? track : null;
    },
    async playTrack(...args) { env.played.push(args); return playable; },
    async playFallbackTrack(...args) { env.fallbacks.push(args); return true; },
    prefetchAnnouncement: async () => '/outro',
    waitForDuck: async () => {},
    playPrefetchedAnnouncement: async () => {},
    SONG_OVERLAP_DELAY_MS: 0,
    played: [], fallbacks: [], errors: [],
  };
  return env;
}

for (const announcements of [false, true]) {
  for (const cached of [false, true]) {
    test(`actual Next Song starts saved break (announcements=${announcements}, cached=${cached})`, async () => {
      const env = fixture({ announcements, cached });
      await skip({ skipBreaks: false }, env);
      assert.deepEqual(env.errors, [], 'saved break must not hit transition exception recovery');
      assert.equal(env.played.length, 1);
      assert.equal(env.played[0][0], '/selected-break');
      assert.equal(env.played[0][2], 'DJ saved break.mp3');
      assert.equal(env.played[0].length, 4, 'break music is not an incoming-performer track');
      assert.equal(env.fallbacks.length, 0, 'must not substitute a random entertainer song');
      assert.equal(env.playingInterstitialRef.current, true);
      assert.equal(env.playingInterstitialBreakKeyRef.current, 'after-finished');
      assert.equal(env.interstitialIndexRef.current, 1);
      assert.equal(env.currentSongNumberRef.current, 0, 'incoming entertainer has not started');
      assert.equal(env.transitionInProgressRef.current, false);
      assert.deepEqual(env.interstitialSongsRef.current['after-finished'], ['DJ saved break.mp3']);
      assert.deepEqual(env.rotationSongsRef.current.incoming.map(t => t.name), ['her one.mp3', 'her two.mp3']);
      if (!cached) assert.equal(env.resolvedName, 'DJ saved break.mp3');
    });
  }
}

for (const announcements of [false, true]) {
  for (const resolvable of [false, true]) {
    test(`break failure recovery does not reference an uninitialized incoming dancer (announcements=${announcements}, resolvable=${resolvable})`, async () => {
      const env = fixture({ announcements, cached: false, playable: false, resolvable });
      await skip({ skipBreaks: false }, env);
      assert.equal(env.fallbacks.length, 1);
      assert.equal(env.fallbacks[0].length, 1, 'fallback remains break music, not an incoming set');
      assert.ok(!env.errors.some(args => args.some(value => value instanceof ReferenceError)));
      assert.equal(env.transitionInProgressRef.current, false);
      assert.equal(env.currentSongNumberRef.current, 0);
    });
  }
}

test('a later Next Song plays the next queued break before handing off to the entertainer', async () => {
  const env = fixture();
  env.interstitialSongsRef.current['after-finished'].push('second saved break.mp3');
  await skip({ skipBreaks: false }, env);
  env.lastSkipTimeRef.current = 0;
  env.resolveTrackByName = async name => ({ name, url: '/second-break' });
  await skip({ skipBreaks: false }, env);
  assert.deepEqual(env.played.map(args => args[0]), ['/selected-break', '/second-break']);
  assert.equal(env.interstitialIndexRef.current, 2);
  assert.equal(env.currentSongNumberRef.current, 0);
  assert.equal(env.fallbacks.length, 0);
  assert.deepEqual(env.errors, []);
});

test('Next Entertainer still explicitly abandons an active break queue', async () => {
  const env = fixture();
  env.playingInterstitialRef.current = true;
  env.playingInterstitialBreakKeyRef.current = 'after-finished';
  env.interstitialIndexRef.current = 0;
  env.setFeatureSetupActive = () => {};
  let handoffs = 0;
  env.handleTrackEndRef = { current: async options => {
    assert.deepEqual(options, { fromExplicitSkip: true });
    handoffs += 1;
  } };
  await skip({ skipBreaks: true }, env);
  assert.equal(handoffs, 1);
  assert.equal(env.interstitialIndexRef.current, 1);
  assert.equal(env.played.length, 0);
});
