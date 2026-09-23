import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = mkdtempSync(join(tmpdir(), 'djbooth-music-scanner-'));
process.env.DB_PATH = join(testDir, 'scanner-test.db');
process.env.VOICEOVER_PATH = join(testDir, 'voiceovers');

const { default: db, closeDatabase, stopCheckpoints, getMusicTrackCount } = await import('./db.js');
const { scanMusicFolder } = await import('./musicScanner.js');

after(() => {
  stopCheckpoints();
  closeDatabase();
  rmSync(testDir, { recursive: true, force: true });
});

test('incomplete traversal upserts discoveries but preserves existing rows and scan timestamp', () => {
  const musicDir = join(testDir, 'music');
  mkdirSync(join(musicDir, 'House'), { recursive: true });
  writeFileSync(join(musicDir, 'House', 'known.mp3'), 'fixture');

  const complete = scanMusicFolder(musicDir, true);
  assert.equal(complete.incomplete, undefined);
  assert.equal(getMusicTrackCount(), 1);
  const before = db.prepare("SELECT value FROM settings WHERE key = 'last_music_scan'").get().value;

  const incomplete = scanMusicFolder(join(testDir, 'temporarily-unreadable'), true);
  assert.equal(incomplete.incomplete, true);
  assert.equal(incomplete.removed, 0);
  assert.equal(getMusicTrackCount(), 1);
  assert.equal(
    db.prepare("SELECT value FROM settings WHERE key = 'last_music_scan'").get().value,
    before,
  );
});

test('incomplete scan with no path delta still does not stamp success or replace cache', () => {
  const emptyDir = join(testDir, 'empty');
  mkdirSync(emptyDir, { recursive: true });
  scanMusicFolder(emptyDir, true);
  const before = db.prepare("SELECT value FROM settings WHERE key = 'last_music_scan'").get().value;
  rmSync(emptyDir, { recursive: true, force: true });

  const incomplete = scanMusicFolder(emptyDir, true);
  assert.equal(incomplete.incomplete, true);
  assert.equal(incomplete.added, 0);
  assert.equal(incomplete.removed, 0);
  assert.equal(
    db.prepare("SELECT value FROM settings WHERE key = 'last_music_scan'").get().value,
    before,
  );
});