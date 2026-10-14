// REGRESSION GUARD for the Day/Night defect in automatic set assignment.
//
// The defect: RotationPlaylistManager derived the genres for AUTOMATIC assignment straight from
// `djOptions.activeGenres` - the NIGHT list - so the set published when a performer entered the
// rotation came from the wrong pool while the Day shift was active. The resolver that knows about
// shifts is `getActiveMusicGenres` in utils/shiftMusicOptions.js, and the manager never called it.
//
// This test is written in the style of the repo's other "callers" tests: it reads the ACTUAL
// component source and asserts where the resolver is and is not used. Two properties matter and
// both are checked, because a test that only checks the first would pass on a fix that over-
// applied the resolver:
//
//   1. every AUTOMATIC genre site calls the resolver;
//   2. the MANUAL browsing list does NOT - a DJ searching the library must not have tracks hidden
//      by the active shift.
//
// A missing anchor is a FAILURE, never a silent skip: if the component is restructured so these
// lines cannot be found, this test must go red and be rewritten rather than quietly pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getActiveMusicGenres, isDayShiftActive } from './shiftMusicOptions.js';

const COMPONENT = path.join(import.meta.dirname, '..', 'components', 'dj',
  'RotationPlaylistManager.jsx');

function source() {
  assert.ok(fs.existsSync(COMPONENT), 'RotationPlaylistManager.jsx is not where this test expects '
    + 'it; the guard cannot run and must be rewritten rather than skipped');
  return fs.readFileSync(COMPONENT, 'utf8');
}

const AUTOMATIC_SITES = 4;

test('every automatic genre site uses the shared active-shift resolver', () => {
  const text = source();
  const direct = text.match(
    /^[ \t]*const activeGenres = djOptions\?\.activeGenres\?\.length > 0 \? djOptions\.activeGenres : \[\];[ \t]*$/gm) || [];
  assert.equal(direct.length, 0,
    'an automatic assignment path still reads djOptions.activeGenres directly, so it will use the '
    + 'Night list while the Day shift is active: ' + JSON.stringify(direct));
  const resolved = text.match(/const activeGenres = getActiveMusicGenres\(djOptions\);/g) || [];
  assert.equal(resolved.length, AUTOMATIC_SITES,
    'expected the resolver at exactly ' + AUTOMATIC_SITES + ' automatic sites (initial assignment, '
    + 'songs-per-set reassignment, top-up, reroll), found ' + resolved.length);
  assert.match(text, /import \{ getActiveMusicGenres \} from '@\/utils\/shiftMusicOptions';/,
    'the resolver is called but not imported');
});

test('MANUAL library browsing is NOT shift-filtered', () => {
  const text = source();
  assert.match(text, /filterByGenres\(serverTracks, djOptions\?\.activeGenres\)/,
    'the browse/search list no longer reads djOptions.activeGenres directly. If the resolver was '
    + 'applied here too, a DJ deliberately searching the library would have tracks hidden by the '
    + 'active shift, which is a different feature and not this fix');
});

// ---- the resolver's own behaviour in the shapes automatic assignment actually meets
const DAY = ['DAY-A', 'DAY-B'];
const NIGHT = ['NIGHT-A', 'NIGHT-B'];
const at = (h, m = 0) => new Date(2026, 9, 12, h, m, 0, 0);

test('inside the Day window the automatic pool is the DAY genres', () => {
  const opts = { activeGenres: NIGHT,
    dayShift: { enabled: true, startTime: '12:00', endTime: '20:00', genres: DAY } };
  assert.equal(isDayShiftActive(opts.dayShift, at(14)), true);
  assert.deepEqual(getActiveMusicGenres(opts, at(14)), DAY);
});

test('outside the Day window the automatic pool is the NIGHT genres', () => {
  const opts = { activeGenres: NIGHT,
    dayShift: { enabled: true, startTime: '12:00', endTime: '20:00', genres: DAY } };
  assert.equal(isDayShiftActive(opts.dayShift, at(22)), false);
  assert.deepEqual(getActiveMusicGenres(opts, at(22)), NIGHT);
});

test('an OVERNIGHT Day window is honoured on both sides of midnight', () => {
  const opts = { activeGenres: NIGHT,
    dayShift: { enabled: true, startTime: '22:00', endTime: '04:00', genres: DAY } };
  assert.deepEqual(getActiveMusicGenres(opts, at(23)), DAY);
  assert.deepEqual(getActiveMusicGenres(opts, at(2)), DAY);
  assert.deepEqual(getActiveMusicGenres(opts, at(12)), NIGHT);
});

test('a DISABLED Day shift leaves the Night list in force, so the fix is a no-op there', () => {
  const opts = { activeGenres: NIGHT,
    dayShift: { enabled: false, startTime: '12:00', endTime: '20:00', genres: DAY } };
  const before = opts.activeGenres?.length > 0 ? opts.activeGenres : [];
  assert.deepEqual(getActiveMusicGenres(opts, at(14)), before);
});

test('NO selections for the active shift means ALL for that shift, never the other shift', () => {
  const dayEmpty = { activeGenres: NIGHT,
    dayShift: { enabled: true, startTime: '12:00', endTime: '20:00', genres: [] } };
  assert.deepEqual(getActiveMusicGenres(dayEmpty, at(14)), [],
    'an empty Day selection must mean ALL for the Day shift - it must NOT fall back to the Night '
    + 'list, which is exactly what the old expression did');
  const nightEmpty = { activeGenres: [],
    dayShift: { enabled: true, startTime: '12:00', endTime: '20:00', genres: DAY } };
  assert.deepEqual(getActiveMusicGenres(nightEmpty, at(22)), []);
});

test('the empty result keeps the delivered "empty means ALL" pool semantics', () => {
  // this is the property that lets the resolver be a drop-in: `filterByGenres` treats [] as ALL,
  // so an unselected shift still offers the whole library and exhaustion behaviour is unchanged
  const filterByGenres = (list, genres) =>
    (!genres || genres.length === 0) ? list : list.filter(t => genres.includes(t.genre));
  const pool = [{ name: 'a', genre: 'DAY-A' }, { name: 'b', genre: 'NIGHT-A' }];
  const opts = { activeGenres: NIGHT,
    dayShift: { enabled: true, startTime: '12:00', endTime: '20:00', genres: [] } };
  assert.deepEqual(filterByGenres(pool, getActiveMusicGenres(opts, at(14))), pool);
});

test('Folders Only does not change which POOL is active', () => {
  // folders_only changes whether the dancer's personal playlist is consulted, not which shift's
  // folders are eligible, so the resolver must answer identically for both music modes
  const base = { activeGenres: NIGHT,
    dayShift: { enabled: true, startTime: '12:00', endTime: '20:00', genres: DAY } };
  assert.deepEqual(getActiveMusicGenres({ ...base, musicMode: 'folders_only' }, at(14)),
    getActiveMusicGenres({ ...base, musicMode: 'dancer_first' }, at(14)));
});
