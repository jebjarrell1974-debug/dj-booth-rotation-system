import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capSongAssignments,
  capSongList,
  currentRotationDancerId,
  filterManualAssignments,
  fillSongListToLimit,
  getSongName,
  applyManualAssignments,
  normalizeSongAssignments,
  normalizeSongsPerSet,
  queueLatestManualAssignment,
  reconcileAuthoritativeAssignments,
  resolveManualSetLength,
} from './rotationAssignments.js';

test('caps stale assignments to the configured set length', () => {
  const assignments = {
    rylei: ['one.mp3', 'two.mp3', 'three.mp3'],
    lydia: ['four.mp3', 'five.mp3'],
  };

  assert.deepEqual(capSongAssignments(assignments, 2), {
    rylei: ['one.mp3', 'two.mp3'],
    lydia: ['four.mp3', 'five.mp3'],
  });
});

test('keeps the leading tracks and never mutates the original list', () => {
  const songs = [{ name: 'one' }, { name: 'two' }, { name: 'three' }];
  const capped = capSongList(songs, 2);

  assert.deepEqual(capped, songs.slice(0, 2));
  assert.equal(songs.length, 3);
});

test('preserves references when assignments already fit', () => {
  const assignments = { cash: ['one.mp3', 'two.mp3'] };
  assert.equal(capSongAssignments(assignments, 2), assignments);
  assert.equal(capSongList(assignments.cash, 2), assignments.cash);
});

test('filters automatic assignments out of the DJ override ledger', () => {
  const autoAndManual = {
    mira: [{ name: 'auto-one' }],
    rose: [{ name: 'dj-repeat' }],
  };

  assert.deepEqual(filterManualAssignments(autoAndManual, { rose: true }), {
    rose: [{ name: 'dj-repeat' }],
  });
});

test('normalizes remote string and legacy file-name track shapes', () => {
  assert.equal(getSongName({ file_name: 'Tove Lo Habits.mp3' }), 'Tove Lo Habits.mp3');
  assert.equal(getSongName({ filename: 'Hinder Lips Of An Angel.mp3' }), 'Hinder Lips Of An Angel.mp3');
  assert.equal(getSongName({ path: '/music/fallback.mp3' }), 'fallback.mp3');
  assert.deepEqual(normalizeSongAssignments({
    scarlett: [
      { file_name: 'Tove Lo Habits.mp3' },
      { name: 'Hinder Lips Of An Angel.mp3' },
      {},
    ],
  }, 3), {
    scarlett: ['Tove Lo Habits.mp3', 'Hinder Lips Of An Angel.mp3'],
  });
});

test('unchanged authoritative snapshots preserve the assignment object reference', () => {
  const current = { rose: ['full8.mp3'] };
  const next = reconcileAuthoritativeAssignments(
    current,
    { rose: [{ name: 'full8.mp3' }] },
    2,
  );
  assert.equal(next, current);
});

test('an explicit empty authoritative assignment clears stale display picks', () => {
  const current = { rose: ['full8.mp3'] };
  assert.deepEqual(reconcileAuthoritativeAssignments(current, {}, 2), {});
  assert.deepEqual(reconcileAuthoritativeAssignments(current, { rose: [] }, 2), { rose: [] });
});

test('dirty local assignment edits survive until the authoritative command is acknowledged', () => {
  const current = { rose: ['remote-edit.mp3'], lane: ['old.mp3'] };
  assert.deepEqual(
    reconcileAuthoritativeAssignments(current, { rose: ['kiosk-pick.mp3'], lane: ['new.mp3'] }, 2, ['rose']),
    { rose: ['remote-edit.mp3'], lane: ['new.mp3'] },
  );
});

test('explicit empty updates clear only that dancer and preserve duplicate picks', () => {
  assert.deepEqual(applyManualAssignments(
    { mira: ['auto-pick'], lane: ['keep-me'] },
    { mira: ['same', 'same'], lane: ['same', 'same'] },
    ['mira'],
  ), {
    mira: ['same', 'same'],
    lane: ['keep-me'],
  });
  assert.deepEqual(
    applyManualAssignments({ mira: ['stale'] }, {}, ['mira']),
    { mira: [] },
  );
});

test('allows a larger set length without adding or removing tracks', () => {
  const assignments = { rose: ['one.mp3', 'two.mp3'] };
  assert.equal(capSongAssignments(assignments, 3), assignments);
});

test('growing a set adds exactly the missing number and preserves DJ picks', () => {
  const existing = [{ name: 'picked-one.mp3' }, { name: 'picked-two.mp3' }];
  const candidates = [
    { name: 'picked-two.mp3' },
    { name: 'new-three.mp3' },
    { name: 'unused-four.mp3' },
  ];

  assert.deepEqual(fillSongListToLimit(existing, candidates, 3), [
    { name: 'picked-one.mp3' },
    { name: 'picked-two.mp3' },
    { name: 'new-three.mp3' },
  ]);
});

test('fills short name-only and legacy-shaped queues without duplicate additions', () => {
  const existing = ['picked-one.mp3', { file_name: 'picked-two.mp3' }];
  const candidates = [
    { name: 'picked-two.mp3' },
    { name: 'new-three.mp3' },
  ];

  assert.deepEqual(fillSongListToLimit(existing, candidates, 3), [
    'picked-one.mp3',
    { file_name: 'picked-two.mp3' },
    { name: 'new-three.mp3' },
  ]);
});

test('a late async result is capped against the latest set length at commit time', async () => {
  let currentSetLength = 3;
  let releaseResult;
  const delayedResult = new Promise(resolve => {
    releaseResult = resolve;
  });
  let committed;

  const pendingWriter = (async () => {
    const result = await delayedResult;
    committed = capSongAssignments(result, currentSetLength);
  })();

  currentSetLength = 2;
  releaseResult({ rylei: ['one.mp3', 'two.mp3', 'late-three.mp3'] });
  await pendingWriter;

  assert.deepEqual(committed, { rylei: ['one.mp3', 'two.mp3'] });
});

test('a late automatic result cannot replace a newer DJ assignment', async () => {
  let assignmentVersion = 0;
  let rotationSongs = {};
  let releaseAutomaticPick;
  const automaticPick = new Promise(resolve => {
    releaseAutomaticPick = resolve;
  });

  const capturedVersion = assignmentVersion;
  const pendingAutomaticWriter = (async () => {
    const result = await automaticPick;
    if (capturedVersion !== assignmentVersion) return;
    rotationSongs = capSongAssignments(result, 2);
  })();

  assignmentVersion += 1;
  rotationSongs = { rylei: ['dj-one.mp3', 'dj-two.mp3'] };
  releaseAutomaticPick({ rylei: ['auto-one.mp3', 'auto-two.mp3', 'auto-three.mp3'] });
  await pendingAutomaticWriter;

  assert.deepEqual(rotationSongs, { rylei: ['dj-one.mp3', 'dj-two.mp3'] });
});

test('normalizes invalid set lengths safely', () => {
  assert.equal(normalizeSongsPerSet('2'), 2);
  assert.equal(normalizeSongsPerSet(0), 1);
  assert.deepEqual(capSongList(['one', 'two'], 0), ['one']);
});

test('uses the actual current rotation index when identifying the active dancer', () => {
  assert.equal(currentRotationDancerId(['pending', 'on-stage', 'next'], 1), 'on-stage');
  assert.equal(currentRotationDancerId(['first'], 99), 'first');
});

test('manual metadata owns empty and oversized set lengths across reload/default changes', () => {
  const assignments = {
    dancer20: Array.from({ length: 20 }, (_, index) => `song-${index}`),
    cleared: [],
  };
  const manualLengths = { dancer20: 20, cleared: 0 };
  assert.equal(resolveManualSetLength(assignments, manualLengths, 'dancer20', 2), 20);
  assert.equal(resolveManualSetLength(assignments, manualLengths, 'cleared', 2), 0);
  assert.deepEqual(
    reconcileAuthoritativeAssignments(
      assignments,
      {},
      2,
      [],
      ['dancer20', 'cleared'],
    ),
    assignments,
  );
});

test('a rapid edit sequence resolves to the latest manual assignment', () => {
  let queued = {};
  queued = queueLatestManualAssignment(queued, 'dancer', ['one.mp3']);
  queued = queueLatestManualAssignment(queued, 'dancer', ['one.mp3', 'two.mp3']);
  queued = queueLatestManualAssignment(queued, 'dancer', ['final.mp3']);
  assert.deepEqual(queued, { dancer: ['final.mp3'] });
});