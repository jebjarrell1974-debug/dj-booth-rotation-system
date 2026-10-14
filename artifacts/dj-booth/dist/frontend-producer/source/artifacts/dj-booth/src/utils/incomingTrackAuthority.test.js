import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileIncomingPreparedTrack,
  resolveAuthoritativeNameOnlyTrack,
  resolveAuthoritativeIncomingSlot,
} from './incomingTrackAuthority.js';

const automatic = tracks => tracks.filter(track => track?.automatic !== false);

test('a Save All mutation during an ad replaces the captured incoming URL', () => {
  const state = {
    rotationSongs: { dancer: [{ url: '/music/old.mp3' }] },
    savedSongs: {},
    savedManual: {},
    version: 4,
  };
  const before = resolveAuthoritativeIncomingSlot({
    dancerId: 'dancer',
    rotationSongs: state.rotationSongs,
    savedSongs: state.savedSongs,
    savedManual: state.savedManual,
    getManualSetLength: () => 3,
    filterAutomaticTracks: automatic,
  });
  assert.equal(before.track.url, '/music/old.mp3');

  state.savedSongs.dancer = [{ url: '/music/new.mp3', name: 'New pick' }];
  state.savedManual.dancer = true;
  state.version = 5;
  const after = resolveAuthoritativeIncomingSlot({
    dancerId: 'dancer',
    rotationSongs: state.rotationSongs,
    savedSongs: state.savedSongs,
    savedManual: state.savedManual,
    getManualSetLength: () => 1,
    filterAutomaticTracks: automatic,
  });
  const reconciliation = reconcileIncomingPreparedTrack({
    preparedTrack: before.track,
    preparedVersion: 4,
    currentVersion: state.version,
    currentSlot: after,
  });

  assert.equal(after.track.url, '/music/new.mp3');
  assert.equal(reconciliation.shouldInvalidate, true);
  assert.equal(reconciliation.track.url, '/music/new.mp3');
});

test('an intentional manual empty set stays empty instead of falling back', () => {
  const current = resolveAuthoritativeIncomingSlot({
    dancerId: 'dancer',
    rotationSongs: { dancer: [{ url: '/music/stale.mp3' }] },
    savedSongs: { dancer: [{ url: '/music/also-stale.mp3' }] },
    savedManual: { dancer: true },
    manualSetLengths: { dancer: 0 },
    getManualSetLength: () => 0,
    filterAutomaticTracks: automatic,
  });
  const reconciliation = reconcileIncomingPreparedTrack({
    preparedTrack: { url: '/music/stale.mp3' },
    preparedVersion: 4,
    currentVersion: 5,
    currentSlot: current,
  });

  assert.equal(current.intentionalEmpty, true);
  assert.equal(current.track, null);
  assert.equal(reconciliation.shouldInvalidate, true);
  assert.equal(reconciliation.intentionalEmpty, true);
  assert.equal(reconciliation.track, null);
});

test('an automatic slot temporarily filtered without a version bump keeps the selected target', () => {
  const reconciliation = reconcileIncomingPreparedTrack({
    preparedTrack: { url: '/music/selected.mp3' },
    preparedVersion: 7,
    currentVersion: 7,
    currentSlot: {
      dancerId: 'dancer',
      slotIndex: 0,
      track: null,
      manual: false,
      intentionalEmpty: false,
    },
  });

  assert.equal(reconciliation.shouldInvalidate, false);
  assert.equal(reconciliation.track.url, '/music/selected.mp3');
});

test('a name-only Save All swap resolves the latest name, not a stale lookup result', async () => {
  const state = {
    version: 10,
    slot: {
      dancerId: 'dancer',
      slotIndex: 0,
      track: { name: 'Old Pick', path: 'Old Pick' },
      manual: true,
      intentionalEmpty: false,
    },
  };
  const lookups = [];
  const pending = {};
  const resolver = name => {
    lookups.push(name);
    return new Promise(resolve => { pending[name] = resolve; });
  };
  const resolving = resolveAuthoritativeNameOnlyTrack({
    currentSlot: state.slot,
    currentVersion: state.version,
    readCurrentSlot: () => ({ slot: state.slot, version: state.version }),
    resolveTrackByName: resolver,
  });

  await new Promise(resolve => setImmediate(resolve));
  state.version = 11;
  state.slot = {
    ...state.slot,
    track: { name: 'New Pick', path: 'New Pick' },
  };
  pending['Old Pick']({ url: '/music/stale-old.mp3', name: 'Old Pick' });
  await new Promise(resolve => setImmediate(resolve));
  pending['New Pick']({ url: '/music/current-new.mp3', name: 'New Pick' });

  const result = await resolving;
  assert.deepEqual(lookups, ['Old Pick', 'New Pick']);
  assert.equal(result.track.url, '/music/current-new.mp3');
  assert.equal(result.track.name, 'New Pick');
});