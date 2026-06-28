// IMPORTANT: write through the SAME database the running server serves from
// (db.js → DB_PATH/djbooth.db). The generic recordings are read by fleet-db.js
// via this exact connection, so the generator MUST use it too. An earlier
// version opened its own ../fleet.db — a dead file the server never reads — so
// regenerations silently did nothing and stale audio (e.g. "vip" instead of
// V.I.P.) lived on forever. Run this with the same env as the server so DB_PATH
// resolves to the unit's real database.
import db, { getClientSettings } from './db.js';

// MUST match FORCED_VOICE_ID in index.js — the app's single authoritative voice.
// The booth client forces this voice for every announcement (a per-unit .env or
// settings typo can't override it), so the generic fallback pool must use the
// exact same voice or the backup outros would sound like a different person.
// The env ELEVENLABS_VOICE_ID is intentionally NOT used: it is absent on units
// and, in dev, points at a different voice.
const FORCED_VOICE_ID = 'DODLEQrClDo8wCz460ld';
const ELEVENLABS_VOICE_ID = FORCED_VOICE_ID;

// API key: env first (loaded from the unit's .env via the service EnvironmentFile),
// then stored client settings as a fallback so a manual run still works.
let ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVENLABS_API_KEY) {
  try { ELEVENLABS_API_KEY = getClientSettings()?.djbooth_elevenlabs_key; } catch {}
}

if (!ELEVENLABS_API_KEY) {
  console.error('Missing ELEVENLABS_API_KEY (checked env and stored settings)');
  process.exit(1);
}

// Self-contained: the table is normally created by fleet-db.js, but keep this so
// the generator still works if run before the server has initialised the schema.
// Schema matches fleet-db.js (incl. UNIQUE(dancer_name, recording_type)); the
// upsert below is still done manually so it works regardless of who created the table.
db.exec(`
  CREATE TABLE IF NOT EXISTS voice_recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dancer_name TEXT NOT NULL,
    recording_type TEXT NOT NULL,
    processed_audio BLOB,
    raw_audio BLOB,
    processed_size INTEGER DEFAULT 0,
    raw_size INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    recorded_at INTEGER NOT NULL,
    UNIQUE(dancer_name, recording_type)
  )
`);

// script_text lets us rebuild ONLY the lines whose script actually changed, so
// editing one generic line never re-spends ElevenLabs credits on the others.
try {
  db.exec('ALTER TABLE voice_recordings ADD COLUMN script_text TEXT');
} catch {
  // column already exists — fine
}

const VOICE_SETTINGS = {
  stability: 0.45,
  similarity_boost: 0.75,
  style: 0.40,
  speed: 1.0,
  use_speaker_boost: true,
};

const GENERIC_SCRIPTS = {
  intro: [
    "Main stage, gentlemen. Your next entertainer is heading your way — and fellas, this is pay-per-view quality. Get up to that rail with some cash. She don't dance for free. Here she comes.",
    "All right, all right... main stage. She's about to do her thing, and she's the total package — top to bottom. Get those dollars out, fellas. Coming to the stage right now.",
    "Listen up, my guys. You came here for the best, and the best is about to deliver. Coming to the main stage — open those wallets wide, gentlemen.",
    "Right about now... I need all eyes up front. Your next entertainer is heading your way. Fellas, grab some cash — you're gonna need it. Here she comes.",
    "Who's got cash? I hope it's you, because she's about to earn every single dollar. Main stage, right now. Get comfortable — and get generous.",
    "You hear that music? That means one thing. Your next entertainer is on deck. She's about to light this place up. Get those ones ready, kings. Here she comes.",
    "Gentlemen... I need you to do me a favor. Put that phone down, pick that cash up. She's about to take the stage and she deserves your full attention.",
    "This next one's a problem, fellas — in the best way. About to hit the main stage. These ladies make their living off of what you're giving. Let's go.",
    "Hold on, hold on... y'all ain't ready for this one. She's about to shut this stage down. Paper up, boys. This is not a drill. Here she comes.",
    "Big spenders, this one's for you. She's about to show you why she's on this stage. Get those ones out, get up close. Show her some love.",
  ],
  round2: [
    "Round two, gentlemen. Keep it going for her.",
    "We're not done yet... she's still on that stage. Keep those dollars coming.",
    "Round two, fellas. These ladies don't dance for free — keep that cash flowing.",
    "She's still going, gentlemen. Round two — tip heavy.",
    "Oh, you thought she was done? Nah... round two.",
    "Keep that cash flowing, boys. She ain't done with y'all yet.",
    "Don't you dare put your wallets away. Round two right here.",
    "She's just getting warmed up, gentlemen. Round two.",
    "More of this beautiful lady. Keep tipping, kings.",
    "Stay at that rail, boys. She got more for you. Round two.",
  ],
  outro: [
    "All right fellas, that was incredible on the main stage. She's available for private dances now — one on one, make that connection. Don't let somebody else grab her first.",
    "That was beautiful, gentlemen. Main stage is done... but if you want more, she's available for a little one-on-one time. Go see her.",
    "Show some love, fellas. Main stage is done, but your chance for a private dance is just getting started. Don't let her slip away.",
    "That was lovely, gentlemen. If you want more of that... she's available right now for that one-on-one experience. Trust me, it's worth every dollar.",
    "Everybody give it up. Now listen... if that had you in your feelings, imagine what a private dance would do. She's available right now. Go find her.",
    "That was special, gentlemen. If you want the real experience... she's available for a little private conversation. First come, first served, fellas.",
    "Main stage is wrapped, but the night ain't over. She's taking private dances — and gentlemen, that's where the magic happens.",
    "That was fire, fellas. She just put on a show. Now she's available for private dances... face to face, one on one. Don't be the one who missed out.",
    "Stage show is done, but the real fun is a little private time with her. She's waiting — the question is, are you coming?",
    "She just danced for all of you... now she can dance for just one of you. Private dances available right now. Go treat yourself.",
  ],
  transition: [
    "Show some love for her. Now... we're keeping it back to back tonight. Your next entertainer is heading to the main stage — get up close with some of that hard-earned cash. Here she comes.",
    "That was beautiful. Right about now... your next entertainer is coming to the stage, fellas. These ladies don't dance for free — so get those dollars ready.",
    "That was lovely, gentlemen. Main stage, get ready... she's up next. We're doing it right tonight. You wanna see skin, they gotta see green.",
    "Give it up, gentlemen. Now... your next entertainer is heading your way. Get those ones out, fellas — she's about to make it worth your while.",
    "Big ups to her. All right, fellas... no rest for y'all tonight. She's up next and she's about to go crazy on that stage. Cash out, boys.",
    "That was fire, everybody. We keep it moving, gentlemen. Your next entertainer is next on the main stage. Keep that paper flowing.",
    "Everybody give it up. Now check this out... she's about to take over. If you thought that was something... wait till you see this. Get those ones ready.",
    "That was beautiful, fellas. Now I got somebody real special for you. She's heading to the stage right now. Don't go anywhere — and don't put that cash away.",
    "Give her some love, everybody. We're not slowing down, gentlemen. Coming your way next. She came to get paid tonight — help her out.",
    "That was incredible. And we keep the heat coming. She's up next. Trust me, you want to be at that rail. Cash in hand. Here she comes.",
  ],
};

async function generateTTS(text) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_v3',
      voice_settings: VOICE_SETTINGS,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs error ${response.status}: ${err}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

const findExisting = db.prepare(
  'SELECT id, script_text FROM voice_recordings WHERE dancer_name = ? AND recording_type = ?'
);
const updateAudio = db.prepare(`
  UPDATE voice_recordings
  SET processed_audio = ?, raw_audio = NULL, processed_size = ?, raw_size = 0, duration_ms = 0, recorded_at = ?, script_text = ?
  WHERE dancer_name = ? AND recording_type = ?
`);
const insertAudio = db.prepare(`
  INSERT INTO voice_recordings
  (dancer_name, recording_type, processed_audio, raw_audio, processed_size, raw_size, duration_ms, recorded_at, script_text)
  VALUES (?, ?, ?, NULL, ?, 0, 0, ?, ?)
`);
const backfillScript = db.prepare(
  'UPDATE voice_recordings SET script_text = ? WHERE dancer_name = ? AND recording_type = ?'
);

// Manual upsert (the table has no UNIQUE constraint — mirrors fleet-db.js).
function saveGeneric(recType, script, audio) {
  const existing = findExisting.get('__generic__', recType);
  if (existing) {
    updateAudio.run(audio, audio.length, Date.now(), script, '__generic__', recType);
  } else {
    insertAudio.run('__generic__', recType, audio, audio.length, Date.now(), script);
  }
}

// Matches a spelled-out acronym in the script (V.I.P., D.J., …). Legacy rows
// recorded before script tracking are only rebuilt if their current script
// contains one of these — those are the lines that could have been baked with
// the wrong pronunciation. Everything else is left alone to save credits.
const DOTTED_ACRONYM = /\b(?:[A-Z]\.){2,}/;

async function main() {
  const types = Object.keys(GENERIC_SCRIPTS);
  let total = 0;
  for (const type of types) total += GENERIC_SCRIPTS[type].length;

  let rebuilt = 0, tracked = 0, unchanged = 0, failed = 0;

  console.log(`Checking ${total} generic voiceovers (rebuilding only changed lines)...`);

  for (const type of types) {
    const scripts = GENERIC_SCRIPTS[type];
    for (let i = 0; i < scripts.length; i++) {
      const recType = `${type}_${i + 1}`;
      const script = scripts[i];
      const existing = findExisting.get('__generic__', recType);

      if (existing) {
        const stored = existing.script_text;
        if (stored === script) {
          unchanged++;
          continue;
        }
        if (stored == null && !DOTTED_ACRONYM.test(script)) {
          // Legacy recording with no spelled-out acronym → assume the existing
          // audio is correct; just record the script so future edits are tracked.
          backfillScript.run(script, '__generic__', recType);
          tracked++;
          console.log(`  🏷️  ${recType} legacy (no acronym) — kept audio, tracked script`);
          continue;
        }
        console.log(stored == null
          ? `  ♻️  ${recType} legacy with acronym — rebuilding for correct pronunciation`
          : `  ♻️  ${recType} script changed — rebuilding`);
      } else {
        console.log(`  🎤 ${recType} new — generating`);
      }

      try {
        const audio = await generateTTS(script);
        saveGeneric(recType, script, audio);
        rebuilt++;
        console.log(`  ✅ ${recType} saved (${(audio.length / 1024).toFixed(1)}KB)`);
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        failed++;
        console.error(`  ❌ ${recType} failed: ${err.message}`);
      }
    }
  }

  console.log(`\nDone. Rebuilt ${rebuilt}, kept+tracked ${tracked}, unchanged ${unchanged}, failed ${failed} (of ${total}).`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
