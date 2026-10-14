import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createActiveSetCursor, resizeActiveSet } from './activeSetCursor.js';

const source = readFileSync(new URL('../pages/DJBooth.jsx', import.meta.url), 'utf8');
const fragments = {
  remoteBulk: source.match(/for \(const dancerId of overrideSet\) \{\n(              if \(nextSongs\[dancerId\][\s\S]*?)\n            \}/)?.[1],
  remoteSingle: source.match(/Object.keys\(cmd.payload.assignments\).forEach\(dancerId => \{\n([\s\S]*?)\n            \}\);/)?.[1],
  kioskBulk: source.match(/for \(const \[dancerId, immediate\] of Object.entries\(immediateSavedUpdates\)\) \{\n([\s\S]*?)\n                  \}/)?.[1],
};
for (const [name, body] of Object.entries(fragments)) {
  test(`executed ${name} edit retains active dancer authority and resizes only the owned turn`, () => {
    assert.ok(body, 'actual product branch must be present');
    for (const dancerId of ['A', 'B']) {
      for (const setLength of [0, 1, 4]) {
        const cursor = createActiveSetCursor({ dancerId: 'A', songNumber: 2, setLength: 3, generation: 7 });
        const songs = Array.from({ length: setLength }, (_, i) => ({ name: `Fixture ${i}` }));
        const context = {
          dancerId, nextSongs: { [dancerId]: songs }, newSongs: { [dancerId]: songs },
          immediate: songs, resizeActiveSet,
          djSavedSongsRef: { current: { [dancerId]: ['previous'] } },
          djSavedManualRef: { current: { [dancerId]: true } },
          activeSetCursorRef: { current: cursor },
        };
        vm.runInNewContext(body, context);
        assert.equal(context.activeSetCursorRef.current.dancerId, 'A');
        assert.equal(context.activeSetCursorRef.current.songNumber, 2);
        assert.equal(context.activeSetCursorRef.current.generation, 7);
        assert.equal(context.activeSetCursorRef.current.setLength, dancerId === 'A' ? setLength : 3);
        assert.equal(context.djSavedManualRef.current[dancerId], setLength ? true : undefined);
        if (setLength) assert.equal(context.djSavedSongsRef.current[dancerId], songs);
        else assert.equal(context.djSavedSongsRef.current[dancerId], undefined);
      }
    }
  });
}
test('accepted owned-edit resize and existing numeric setting resize coexist', () => {
  const cursor = createActiveSetCursor({ dancerId: 'A', songNumber: 2, setLength: 4, generation: 7 });
  assert.equal(resizeActiveSet(cursor, { dancerId: 'B', setLength: 6 }), cursor);
  assert.equal(resizeActiveSet(cursor, { dancerId: 'A', setLength: 1 }).setLength, 1);
  assert.equal(resizeActiveSet(cursor, 1).setLength, 2);
  assert.equal(resizeActiveSet(cursor, 6).setLength, 6);
});
