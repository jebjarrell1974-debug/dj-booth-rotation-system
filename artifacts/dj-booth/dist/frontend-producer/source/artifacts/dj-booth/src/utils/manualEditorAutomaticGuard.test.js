import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { capSongList } from './rotationAssignments.js';

const source = fs.readFileSync(new URL('../components/dj/RotationPlaylistManager.jsx', import.meta.url), 'utf8');
const manualBody = source.match(/const isManualAssignment = useCallback\(dancerId => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1];
assert.ok(manualBody, 'actual editor manual guard must exist');
const manualGuard = new Function('dancerId', 'dirtyOverridesRef', 'djOverridesRef', 'authoritativeManualIdsRef', manualBody);
const guard = (state = {}) => id => manualGuard(id,
  { current: new Set(state.dirty || []) },
  { current: new Set(state.overrides || []) },
  { current: new Set(state.authoritative || []) });
const neededBody = source.match(/const dancersNeedingAssignment = localRotation\.filter\(dancerId => \{([\s\S]*?)\n    \}\);/)?.[1];
assert.ok(neededBody, 'actual automatic request filter must exist');
const needsPick = new Function('dancerId', 'isManualAssignment', 'songAssignmentsRef', 'songsPerSet', neededBody);
const mergeBody = source.match(/setSongAssignments\(prev => \{\s*const updated = \{ \.\.\.prev \};\s*for \(const \[dancerId, songs\] of Object\.entries\(newAssignments\)\) \{([\s\S]*?)\n          \}\s*return updated;/)?.[1];
assert.ok(mergeBody, 'actual automatic completion guard must exist');
const merge = new Function('dancerId', 'songs', 'updated', 'isManualAssignment',
  'capSongList', 'assignmentSongsPerSetRef', mergeBody);

test('actual request filter does not refill shorter or explicitly empty authoritative manual sets', () => {
  for (const songs of [['Alpha.mp3'], []]) {
    assert.equal(needsPick('a', guard({ authoritative: ['a'] }),
      { current: { a: songs } }, 2), false);
  }
});
test('manual guard covers pending edits and numeric/string dancer IDs', () => {
  assert.equal(guard({ dirty: ['7'] })(7), true);
  assert.equal(guard({ overrides: [7] })(7), true);
  assert.equal(guard({ authoritative: ['7'] })(7), true);
});
test('actual automatic completion cannot overwrite a newly authoritative empty set', () => {
  const updated = { a: [] };
  merge('a', ['Wrong.mp3'], updated, guard({ authoritative: ['a'] }), capSongList, { current: 2 });
  assert.deepEqual(updated, { a: [] });
});
test('actual automatic completion cannot overwrite a newer pending manual edit', () => {
  const updated = { a: ['Manual.mp3'] };
  merge('a', ['Wrong.mp3'], updated, guard({ dirty: ['a'] }), capSongList, { current: 2 });
  assert.deepEqual(updated, { a: ['Manual.mp3'] });
});
test('unowned automatic rows still request and accept capped automatic picks', () => {
  assert.equal(needsPick('b', guard(), { current: { b: [] } }, 2), true);
  const updated = {};
  merge('b', ['One.mp3', 'Two.mp3', 'Three.mp3'], updated, guard(), capSongList, { current: 2 });
  assert.deepEqual(updated, { b: ['One.mp3', 'Two.mp3'] });
});
test('committed manual authority changes invalidate previous automatic request generations', () => {
  assert.match(source, /authoritativeManualKeysRef\.current !== authorityKey[\s\S]*?assignmentGenerationRef\.current \+= 1/);
  assert.match(source, /requestGeneration === assignmentGenerationRef\.current/);
});
