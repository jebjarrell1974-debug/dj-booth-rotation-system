import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDayShiftActive, getActiveMusicGenres, filterTracksForActiveShift,
  filterAutomaticBreakSongs,
} from './shiftMusicOptions.js';

const at = (hours, minutes = 0) => new Date(2026, 9, 12, hours, minutes);
const options = {
  activeGenres: ['Night'],
  dayShift: { enabled: true, startTime: '12:00', endTime: '20:00', genres: ['Day'] },
};
const tracks = [{ name: 'day.mp3', genre: 'Day' }, { name: 'night.mp3', genre: 'Night' }];

test('Day and Night select independent pools at exact schedule boundaries', () => {
  for (const hour of [0, 11, 20, 23]) assert.deepEqual(getActiveMusicGenres(options, at(hour)), ['Night']);
  for (const hour of [12, 15, 19]) assert.deepEqual(getActiveMusicGenres(options, at(hour)), ['Day']);
});
test('day selection does not depend on whether a dancer still has playlist entries', () => {
  assert.deepEqual(getActiveMusicGenres(options, at(15)), ['Day']);
  assert.deepEqual(getActiveMusicGenres({ ...options, musicMode: 'folders_only' }, at(15)), ['Day']);
});
test('no selected Day folders means all Day music, never inherit Night selections', () => {
  const allDay = { ...options, dayShift: { ...options.dayShift, genres: [] } };
  assert.deepEqual(getActiveMusicGenres(allDay, at(15)), []);
  assert.equal(filterTracksForActiveShift(tracks, allDay, at(15)), tracks);
  assert.deepEqual(getActiveMusicGenres(allDay, at(21)), ['Night']);
});
test('no selected Night folders means all Night music without borrowing Day selections', () => {
  assert.deepEqual(getActiveMusicGenres({ ...options, activeGenres: [] }, at(21)), []);
  assert.deepEqual(getActiveMusicGenres({ ...options, activeGenres: [] }, at(15)), ['Day']);
});
test('a window across midnight selects Day on both sides and Night outside it', () => {
  const overnight = { ...options, dayShift: { ...options.dayShift, startTime: '22:30', endTime: '04:00' } };
  assert.deepEqual(getActiveMusicGenres(overnight, at(22, 29)), ['Night']);
  for (const date of [at(22, 30), at(23), at(0), at(3, 59)]) {
    assert.deepEqual(getActiveMusicGenres(overnight, date), ['Day']);
  }
  assert.deepEqual(getActiveMusicGenres(overnight, at(4)), ['Night']);
});
test('legacy missing times use the same defaults displayed in Options', () => {
  const legacy = { ...options, dayShift: { enabled: true, genres: ['Day'] } };
  assert.deepEqual(getActiveMusicGenres(legacy, at(15)), ['Day']);
  assert.deepEqual(getActiveMusicGenres(legacy, at(21)), ['Night']);
  assert.deepEqual(getActiveMusicGenres({ ...legacy, dayShift: { ...legacy.dayShift, startTime: '' } }, at(15)), ['Day']);
});
test('disabled/missing Day settings and zero-length window retain Night behavior', () => {
  assert.deepEqual(getActiveMusicGenres({ activeGenres: ['Night'] }, at(15)), ['Night']);
  assert.equal(isDayShiftActive({ ...options.dayShift, enabled: false }, at(15)), false);
  assert.equal(isDayShiftActive({ ...options.dayShift, endTime: '12:00' }, at(12)), false);
});
test('local fallback never widens an exhausted selected Day pool into Night music', () => {
  assert.deepEqual(filterTracksForActiveShift([tracks[1]], options, at(15)), []);
  assert.deepEqual(filterTracksForActiveShift(tracks, options, at(15)), [tracks[0]]);
  assert.deepEqual(filterTracksForActiveShift(tracks, options, at(21)), [tracks[1]]);
});
test('automatic prefills from the other shift are removed; manual queues remain untouched', () => {
  const names = ['night.mp3', 'day.mp3', 'unknown.mp3'];
  assert.deepEqual(filterAutomaticBreakSongs(names, options, tracks, false, at(15)), ['day.mp3']);
  assert.deepEqual(filterAutomaticBreakSongs(names, options, tracks, false, at(21)), ['night.mp3']);
  assert.equal(filterAutomaticBreakSongs(names, options, tracks, true, at(15)), names);
});
