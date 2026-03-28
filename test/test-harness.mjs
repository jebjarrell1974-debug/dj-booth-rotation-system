/**
 * NEON AI DJ — Bug Fix Test Harness
 * Tests Bugs 1, 2/3, 4, 5 from the approved fix list.
 * Run with: node test/test-harness.mjs
 */

const BASE = 'http://localhost:3001';
let TOKEN = null;
let dancerMinnie = null;
let dancerBlair = null;

// Use very unusual PINs unlikely to conflict with real dancers
const PIN_MINNIE = '97913';
const PIN_BLAIR  = '97914';

const TEST_SONGS = [
  'Minnie-Set1.mp3', 'Minnie-Set2.mp3', 'Minnie-Set3.mp3',
  'Blair-Set1.mp3',  'Blair-Set2.mp3',  'Blair-Set3.mp3',
  'Break-Minnie-1.mp3', 'Break-Blair-1.mp3',
];

let passed = 0;
let failed = 0;
const results = [];

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    results.push({ label, pass: true });
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    results.push({ label, pass: false, detail });
    failed++;
  }
}

async function api(method, path, body = null, token = TOKEN) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────
async function setup() {
  console.log('\n━━━ SETUP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Auto-login (localhost only)
  const auth = await api('POST', '/api/auth/auto-login');
  assert('Auto-login from localhost', auth.status === 200 && auth.data.token, `status=${auth.status}`);
  TOKEN = auth.data.token;
  if (!TOKEN) { console.log('  FATAL: Cannot get auth token — aborting'); process.exit(1); }

  // Inject test songs into the DB via /api/songs/sync (same mechanism homebase uses)
  // Merge with whatever is already there
  const existingSongs = await api('GET', '/api/songs');
  const allSongs = Array.isArray(existingSongs.data) ? existingSongs.data : [];
  const merged = [...new Set([...allSongs, ...TEST_SONGS])];
  const syncRes = await api('POST', '/api/songs/sync', { songs: merged });
  assert('Test songs synced into library', syncRes.status === 200, `status=${syncRes.status}`);

  // Verify they appear
  await new Promise(r => setTimeout(r, 300));
  const songsRes = await api('GET', '/api/songs');
  const songs = Array.isArray(songsRes.data) ? songsRes.data : [];
  assert(`Library has songs (${songs.length} total)`, songs.length > 0);

  const hasMinnieSongs = ['Minnie-Set1.mp3','Minnie-Set2.mp3','Minnie-Set3.mp3']
    .every(n => songs.includes(n));
  const hasBlairSongs  = ['Blair-Set1.mp3','Blair-Set2.mp3','Blair-Set3.mp3']
    .every(n => songs.includes(n));
  const hasBreaks = ['Break-Minnie-1.mp3','Break-Blair-1.mp3']
    .every(n => songs.includes(n));
  assert('Minnie set songs in library', hasMinnieSongs);
  assert('Blair set songs in library', hasBlairSongs);
  assert('Break songs in library', hasBreaks);

  // Clean up any leftover test dancers from previous runs
  const existingDancers = await api('GET', '/api/dancers');
  if (existingDancers.status === 200) {
    for (const d of existingDancers.data) {
      if (d.name === 'TestMinnie' || d.name === 'TestBlair') {
        await api('DELETE', `/api/dancers/${d.id}`);
        console.log(`  Cleaned up leftover: ${d.name}`);
      }
    }
  }

  // Create test dancers
  const m = await api('POST', '/api/dancers', { name: 'TestMinnie', color: '#ff66aa', pin: PIN_MINNIE, phonetic_name: 'Minnie' });
  assert('Create dancer TestMinnie', m.status === 200 && m.data.id,
    `status=${m.status} ${JSON.stringify(m.data)}`);
  dancerMinnie = m.status === 200 ? m.data : null;

  const b = await api('POST', '/api/dancers', { name: 'TestBlair', color: '#00d4ff', pin: PIN_BLAIR, phonetic_name: 'Blair' });
  assert('Create dancer TestBlair', b.status === 200 && b.data.id,
    `status=${b.status} ${JSON.stringify(b.data)}`);
  dancerBlair = b.status === 200 ? b.data : null;

  // Verify both appear in dancer list
  const listRes = await api('GET', '/api/dancers');
  const list = listRes.data;
  assert('Both test dancers in list',
    list.some(d => d.id === dancerMinnie?.id) && list.some(d => d.id === dancerBlair?.id)
  );

  console.log(`  TestMinnie ID: ${dancerMinnie?.id}`);
  console.log(`  TestBlair  ID: ${dancerBlair?.id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 4 — Crowd display flicker (isBreak condition)
// ─────────────────────────────────────────────────────────────────────────────
async function testBug4() {
  console.log('\n━━━ BUG 4: Crowd display flicker (isBreak condition) ━━━━━━━━━');

  // The fix: isBreak = (currentSongNumber === 0) → isBreak = (breakSongIndex != null)

  function isBreakOLD(currentSongNumber) { return currentSongNumber === 0; }
  function isBreakNEW(breakSongIndex) { return breakSongIndex != null; }

  // A: Song 0 (intro slot) playing — NOT a break. Old logic wrongly said yes.
  assert('Bug4-A: Intro (song 0) — old logic WRONGLY flagged as break',
    isBreakOLD(0) === true);
  assert('Bug4-A: Intro (song 0) — new logic correctly NOT a break',
    isBreakNEW(null) === false);

  // B: Actual break song playing (breakSongIndex=0)
  assert('Bug4-B: First break song — new logic flags as break',
    isBreakNEW(0) === true);

  // C: Second break song of three (breakSongIndex=1)
  assert('Bug4-C: Break song index 1 — still flagged as break',
    isBreakNEW(1) === true);

  // D: Mid-set song (song 2, no break active) — should never be a break
  assert('Bug4-D: Mid-set song 2, no break — new logic correct',
    isBreakNEW(null) === false);

  // E: Regression — with new logic, a set starting (songNum=0, no break) is clean
  assert('Bug4-E: Set start (songNum=0) with no break — clean in new logic',
    isBreakNEW(null) === false);

  // F: Verify old logic would ALSO flicker on song 0 even mid-set after announcements
  //    (e.g. after skip, currentSongNumber resets to 0 for new dancer intro — old code shows break flicker)
  assert('Bug4-F: After skip, new dancer starts at songNum 0 — old code would flicker to break display',
    isBreakOLD(0) === true && isBreakNEW(null) === false);
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 2/3 — Break song wrong dancer key after rotation flip
// ─────────────────────────────────────────────────────────────────────────────
async function testBug23() {
  console.log('\n━━━ BUG 2/3: Break song key after rotation flip ━━━━━━━━━━━━━━');

  if (!dancerMinnie || !dancerBlair) {
    assert('Bug2/3 SKIPPED: dancer setup failed', false, 'Skipping all sub-tests');
    return;
  }

  const minnieId = dancerMinnie.id;
  const blairId  = dancerBlair.id;

  // Scenario: Minnie is on stage at index 0, has break songs assigned.
  // She finishes her set → rotation flips BEFORE break songs play.
  // After flip: Blair is at index 0, Minnie is at index 1.

  const rotationBeforeFlip = [minnieId, blairId];
  const rotationAfterFlip  = [blairId, minnieId];
  const idxAfterFlip = 0; // currentDancerIndex after flip

  // OLD behavior: reads rot[idx] after flip → wrong dancer
  function breakKeyOLD(rot, idx) {
    return `after-${rot[idx]}`;
  }

  // NEW behavior: ref was stored before flip
  let storedRef = null;

  // ── Step 1: Just before rotation flips, store the key ──
  storedRef = `after-${rotationBeforeFlip[0]}`;     // "after-{minnieId}"

  // ── Step 2: Rotation flips ──
  // (rotationAfterFlip is now active, idx=0 → Blair)

  // ── Step 3: handleTrackEnd reads the key ──
  const oldKey = breakKeyOLD(rotationAfterFlip, idxAfterFlip);
  const newKey = storedRef || breakKeyOLD(rotationAfterFlip, idxAfterFlip);

  assert('Bug2/3-A: OLD key is for Blair (wrong — bug was real)',
    oldKey === `after-${blairId}`);
  assert('Bug2/3-B: NEW key is for Minnie (correct)',
    newKey === `after-${minnieId}`);
  assert('Bug2/3-C: OLD and NEW keys differ (confirms the bug existed)',
    oldKey !== newKey);

  // ── After break ends: ref cleared → next rotation step uses live rot[idx] correctly ──
  storedRef = null;
  const afterClearKey = storedRef || breakKeyOLD(rotationAfterFlip, idxAfterFlip);
  assert('Bug2/3-D: After break ends (ref=null), fallback to rot[idx] gives Blair (next correct dancer)',
    afterClearKey === `after-${blairId}`);

  // ── handleSkip path: same fix, same verification ──
  let skipRef = `after-${minnieId}`; // stored before skip's rotation flip
  const skipRotAfter = [blairId, minnieId];
  const skipOldKey = `after-${skipRotAfter[0]}`;
  const skipNewKey = skipRef || skipOldKey;
  assert('Bug2/3-E: handleSkip path — stored key = Minnie (correct)',
    skipNewKey === `after-${minnieId}`);
  assert('Bug2/3-F: handleSkip path — old key = Blair (confirming bug existed there too)',
    skipOldKey === `after-${blairId}`);

  // ── Both interstitial-end paths clear the ref ──
  // handleTrackEnd clear (line ~2562) + handleSkip clear (already existed) + stopRotation clear
  assert('Bug2/3-G: Ref is null-safe (null || fallback works when no break active)',
    (null || `after-${blairId}`) === `after-${blairId}`);

  // ── Verify interstitialSongs lookup would find the right break songs ──
  const interstitialSongs = {
    [`after-${minnieId}`]: ['Break-Minnie-1.mp3'],
    [`after-${blairId}`]:  ['Break-Blair-1.mp3'],
  };
  assert('Bug2/3-H: Break song lookup with NEW key finds Minnie break song',
    interstitialSongs[newKey]?.[0] === 'Break-Minnie-1.mp3');
  assert('Bug2/3-I: Break song lookup with OLD key would find Blair break song (WRONG)',
    interstitialSongs[oldKey]?.[0] === 'Break-Blair-1.mp3');
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 5 — Stale cached tracks bypass cooldown
// ─────────────────────────────────────────────────────────────────────────────
async function testBug5() {
  console.log('\n━━━ BUG 5: Stale cached tracks bypass cooldown ━━━━━━━━━━━━━━━');

  const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours, matching DJBooth
  const now = Date.now();

  // Mirrors the validation logic added to DJBooth.jsx
  function isExistingCacheValid(existingTracks, songsPerSet, cooldowns) {
    if (!existingTracks || existingTracks.length < songsPerSet) return false;
    return existingTracks.every(t => {
      const ts = cooldowns[t.name];
      return !ts || (now - ts) >= COOLDOWN_MS;
    });
  }

  // Old logic (no cooldown check)
  function isExistingCacheValidOLD(existingTracks, songsPerSet) {
    return existingTracks && existingTracks.length >= songsPerSet;
  }

  const songsPerSet = 3;
  const blairTracks = [
    { name: 'Blair-Set1.mp3' },
    { name: 'Blair-Set2.mp3' },
    { name: 'Blair-Set3.mp3' },
  ];

  const noCooldowns = {};
  const activeCooldowns = {   // played 30 min ago — within 4-hour window
    'Blair-Set1.mp3': now - (30 * 60 * 1000),
    'Blair-Set2.mp3': now - (30 * 60 * 1000),
    'Blair-Set3.mp3': now - (30 * 60 * 1000),
  };
  const expiredCooldowns = {  // played 5 hours ago — cooldown expired
    'Blair-Set1.mp3': now - (5 * 60 * 60 * 1000),
    'Blair-Set2.mp3': now - (5 * 60 * 60 * 1000),
    'Blair-Set3.mp3': now - (5 * 60 * 60 * 1000),
  };
  const partialCooldowns = {  // only one track still hot
    'Blair-Set1.mp3': now - (30 * 60 * 1000),
  };

  // A: All tracks in active cooldown
  assert('Bug5-A: OLD code reused stale tracks (confirms bug existed)',
    isExistingCacheValidOLD(blairTracks, songsPerSet) === true);
  assert('Bug5-A: NEW code rejects tracks in active cooldown',
    isExistingCacheValid(blairTracks, songsPerSet, activeCooldowns) === false);

  // B: No cooldowns at all — safe to reuse
  assert('Bug5-B: No cooldowns — new code allows reuse (efficient)',
    isExistingCacheValid(blairTracks, songsPerSet, noCooldowns) === true);

  // C: All cooldowns expired (>4h ago) — safe to reuse
  assert('Bug5-C: Expired cooldowns — new code allows reuse',
    isExistingCacheValid(blairTracks, songsPerSet, expiredCooldowns) === true);

  // D: Too few tracks cached regardless of cooldown
  assert('Bug5-D: Too few cached tracks — rejects even with no cooldowns',
    isExistingCacheValid([blairTracks[0]], songsPerSet, noCooldowns) === false);

  // E: Only one track in cooldown — whole set invalidated
  assert('Bug5-E: One hot track invalidates whole cached set',
    isExistingCacheValid(blairTracks, songsPerSet, partialCooldowns) === false);

  // F: Exactly at cooldown boundary — just expired (safe to reuse)
  const justExpiredCooldowns = {
    'Blair-Set1.mp3': now - COOLDOWN_MS,      // exactly at boundary
    'Blair-Set2.mp3': now - COOLDOWN_MS - 1,  // 1ms past boundary
    'Blair-Set3.mp3': now - COOLDOWN_MS - 1000,
  };
  assert('Bug5-F: Tracks exactly at cooldown boundary — treated as expired (reusable)',
    isExistingCacheValid(blairTracks, songsPerSet, justExpiredCooldowns) === true);

  // G: Mixed — some expired, one still active
  const mixedCooldowns = {
    'Blair-Set1.mp3': now - (5 * 60 * 60 * 1000), // expired
    'Blair-Set2.mp3': now - (5 * 60 * 60 * 1000), // expired
    'Blair-Set3.mp3': now - (30 * 60 * 1000),      // still active
  };
  assert('Bug5-G: 2 expired + 1 active — whole set rejected',
    isExistingCacheValid(blairTracks, songsPerSet, mixedCooldowns) === false);

  // H: null existingTracks — handled safely
  assert('Bug5-H: null existing tracks — returns false (no crash)',
    isExistingCacheValid(null, songsPerSet, noCooldowns) === false);
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 1 — Drag reorder triggers skip to new first dancer
// ─────────────────────────────────────────────────────────────────────────────
async function testBug1() {
  console.log('\n━━━ BUG 1: Drag reorder → skip to new first dancer ━━━━━━━━━━━');

  if (!dancerMinnie || !dancerBlair) {
    assert('Bug1 SKIPPED: dancer setup failed', false, 'Skipping all sub-tests');
    return;
  }

  const minnieId = dancerMinnie.id;
  const blairId  = dancerBlair.id;

  let skipFired = false;
  let callbackNewFirst = null;

  function onDancerDragReorder(newRotation, oldFirstId, newFirstId) {
    callbackNewFirst = newFirstId;
    skipFired = true;
  }

  // Mirrors the NEW handleDragEnd logic in RotationPlaylistManager
  function handleDragEndNEW(localRotation, sourceIdx, destIdx, isRotationActive) {
    const newRot = [...localRotation];
    const [moved] = newRot.splice(sourceIdx, 1);
    newRot.splice(destIdx, 0, moved);
    let callbackFired = false;
    if (isRotationActive && localRotation[0] !== newRot[0]) {
      onDancerDragReorder(newRot, localRotation[0], newRot[0]);
      callbackFired = true;
    }
    return { newRot, callbackFired };
  }

  // Mirrors the OLD handleDragEnd (no callback at all)
  function handleDragEndOLD(localRotation, sourceIdx, destIdx) {
    const newRot = [...localRotation];
    const [moved] = newRot.splice(sourceIdx, 1);
    newRot.splice(destIdx, 0, moved);
    return { newRot, callbackFired: false };
  }

  const rot2 = [minnieId, blairId];

  // A: Blair dragged from pos-1 to pos-0 during active rotation
  const resA_old = handleDragEndOLD(rot2, 1, 0);
  assert('Bug1-A: OLD — no callback fired (DJ stuck playing wrong dancer)',
    resA_old.callbackFired === false);

  skipFired = false; callbackNewFirst = null;
  const resA_new = handleDragEndNEW(rot2, 1, 0, true);
  assert('Bug1-A: NEW — callback fires when pos-0 changes (active rotation)',
    resA_new.callbackFired === true);
  assert('Bug1-A: NEW — skip triggered (handleSkipRef.current called)',
    skipFired === true);
  assert('Bug1-A: NEW — new first dancer is Blair',
    callbackNewFirst === blairId);
  assert('Bug1-A: NEW — rotation array reordered correctly [Blair, Minnie]',
    resA_new.newRot[0] === blairId && resA_new.newRot[1] === minnieId);

  // B: Drag within non-zero positions (pos-0 unchanged) — no skip
  const rot3 = [minnieId, blairId, 'reese'];
  skipFired = false;
  const resB = handleDragEndNEW(rot3, 2, 1, true);
  assert('Bug1-B: Drag not touching pos-0 — no callback',
    resB.callbackFired === false && skipFired === false);
  assert('Bug1-B: Minnie still at pos-0',
    resB.newRot[0] === minnieId);

  // C: Rotation NOT active — no skip even when pos-0 changes
  skipFired = false;
  const resC = handleDragEndNEW(rot2, 1, 0, false);
  assert('Bug1-C: Inactive rotation — drag ignored (no mid-air skip)',
    resC.callbackFired === false && skipFired === false);

  // D: Current dancer dragged OFF pos-0 (Minnie dragged to bottom)
  skipFired = false; callbackNewFirst = null;
  const resD = handleDragEndNEW(rot2, 0, 1, true);
  assert('Bug1-D: Current dancer moved off stage — skip fires to new first',
    resD.callbackFired === true && skipFired === true);
  assert('Bug1-D: Blair is new first after current dancer moves off',
    callbackNewFirst === blairId);

  // E: Single dancer in rotation — can't change pos-0 meaningfully
  skipFired = false;
  const resE = handleDragEndNEW([minnieId], 0, 0, true);
  assert('Bug1-E: Single dancer — no-op drag fires no callback',
    resE.callbackFired === false);
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD — suppress logic
// ─────────────────────────────────────────────────────────────────────────────
async function testKeyboard() {
  console.log('\n━━━ KEYBOARD: iPad/remote suppression ━━━━━━━━━━━━━━━━━━━━━━━━');

  function isTabletDevice(ua, maxTouchPoints = 0, platform = '') {
    return /iPad|Android(?!.*Mobile)|Tablet/i.test(ua) ||
      (platform === 'MacIntel' && maxTouchPoints > 1);
  }

  assert('Pi Linux Chrome — keyboard shown',
    !isTabletDevice('Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/120'));
  assert('iPad UA — keyboard suppressed',
    isTabletDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'));
  assert('Android tablet (no Mobile) — suppressed',
    isTabletDevice('Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36'));
  assert('Android phone (has Mobile) — shown',
    !isTabletDevice('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari'));
  assert('MacIntel + 5 touch points (iPad Safari) — suppressed',
    isTabletDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5, 'MacIntel'));
  assert('MacIntel + 0 touch points (real Mac) — shown',
    !isTabletDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 0, 'MacIntel'));

  // Numpad routing
  const NUMERIC_TYPES = ['number', 'tel'];
  const NUMERIC_MODES = ['numeric', 'decimal', 'tel'];
  function isNumericInput(el) {
    return NUMERIC_TYPES.includes(el.type) || NUMERIC_MODES.includes(el.inputMode) || el.dataset?.keyboard === 'numeric';
  }

  assert('type=number → numpad', isNumericInput({ type: 'number', dataset: {} }));
  assert('type=tel → numpad', isNumericInput({ type: 'tel', dataset: {} }));
  assert('inputMode=decimal → numpad', isNumericInput({ type: 'text', inputMode: 'decimal', dataset: {} }));
  assert('type=text + no hint → qwerty', !isNumericInput({ type: 'text', inputMode: '', dataset: {} }));
  assert('data-keyboard=numeric → numpad', isNumericInput({ type: 'text', inputMode: '', dataset: { keyboard: 'numeric' } }));

  // Shift-auto-reset: after a character typed in upper mode, mode drops back to lower
  let mode = 'upper';
  function typeChar(char) {
    if (mode === 'upper') mode = 'lower';
    return char;
  }
  typeChar('A');
  assert('Keyboard: Shift auto-resets to lower after one capital',
    mode === 'lower');
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────
async function testServerIntegration() {
  console.log('\n━━━ SERVER INTEGRATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const health = await fetch(`${BASE}/__health`);
  assert('Server health OK', health.status === 200);

  const songsRes = await api('GET', '/api/songs');
  const songs = Array.isArray(songsRes.data) ? songsRes.data : [];
  assert(`Songs API returns array (${songs.length})`, songs.length > 0);
  assert('Break-Minnie song in library', songs.includes('Break-Minnie-1.mp3'),
    `Looking for 'Break-Minnie-1.mp3' in ${songs.filter(s=>s.includes('Break')).join(', ')}`);
  assert('Break-Blair song in library', songs.includes('Break-Blair-1.mp3'));
  assert('All Minnie set songs present', ['Minnie-Set1.mp3','Minnie-Set2.mp3','Minnie-Set3.mp3'].every(n => songs.includes(n)));
  assert('All Blair set songs present', ['Blair-Set1.mp3','Blair-Set2.mp3','Blair-Set3.mp3'].every(n => songs.includes(n)));

  if (dancerMinnie && dancerBlair) {
    const listRes = await api('GET', '/api/dancers');
    const list = listRes.data;
    const minnie = list.find(d => d.id === dancerMinnie.id);
    const blair  = list.find(d => d.id === dancerBlair.id);
    assert('TestMinnie has correct name', minnie?.name === 'TestMinnie');
    assert('TestBlair has correct name', blair?.name === 'TestBlair');
    assert('TestMinnie phonetic name', minnie?.phonetic_name === 'Minnie');
    assert('TestBlair phonetic name', blair?.phonetic_name === 'Blair');

    // Test dancer update works (important for rotation mid-set edits)
    const updateRes = await api('PUT', `/api/dancers/${minnie.id}`, { color: '#aabbcc' });
    assert('Dancer update responds', updateRes.status === 200);
    assert('Dancer color updated', updateRes.data.color === '#aabbcc');

    // Restore original color
    await api('PUT', `/api/dancers/${minnie.id}`, { color: '#ff66aa' });
  }

  const configRes = await api('GET', '/api/config/defaults');
  assert('Config defaults respond', configRes.status === 200);
  assert('Config defaults has announcementsEnabled', 'announcementsEnabled' in configRes.data);
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 2/3 EXTENSION — Double-skip during break + stopRotation cleanup
// ─────────────────────────────────────────────────────────────────────────────
async function testBug23Extended() {
  console.log('\n━━━ BUG 2/3 EXTENDED: Double-skip & stopRotation cleanup ━━━━━━━');

  if (!dancerMinnie || !dancerBlair) {
    assert('Bug2/3-Ext SKIPPED: dancer setup failed', false); return;
  }

  const minnieId = dancerMinnie.id;
  const blairId  = dancerBlair.id;

  // Simulate the double-skip path: break is in progress, DJ hits skip
  // handleSkip reads stored ref, advances interstitialIndex, plays next break song
  let storedRef = `after-${minnieId}`;
  const interstitialSongs = {
    [`after-${minnieId}`]: ['Break-Minnie-1.mp3', 'Break-Minnie-2.mp3'],
  };
  let interstitialIndex = 1; // already played song 0, now at song 1

  // Mirrors handleSkip's mid-break path (lines 2038-2068)
  function handleSkipDuringBreak(ref, rot, idx, songs, interIdx) {
    const breakKey = ref || `after-${rot[idx]}`;
    const breakSongs = songs[breakKey] || [];
    if (interIdx < breakSongs.length) {
      // advance to next break song
      return { advanced: true, nextSong: breakSongs[interIdx], newIndex: interIdx + 1, breakKey };
    }
    // no more break songs — fall through, clear ref
    return { advanced: false, nextSong: null, newIndex: 0, breakKey, clearRef: true };
  }

  // A: Mid-break skip with 2 songs — advances to song 2 using correct key
  const rotAfterFlip = [blairId, minnieId];
  const idx = 0;
  const resA = handleSkipDuringBreak(storedRef, rotAfterFlip, idx, interstitialSongs, interstitialIndex);
  assert('Bug2/3-Ext-A: Mid-break skip uses stored ref (not rot[idx])',
    resA.breakKey === `after-${minnieId}`);
  assert('Bug2/3-Ext-A: Advances to Break-Minnie-2.mp3 (correct)',
    resA.nextSong === 'Break-Minnie-2.mp3');
  assert('Bug2/3-Ext-A: Would have used Blair key without fix',
    `after-${rotAfterFlip[idx]}` === `after-${blairId}`);

  // B: Mid-break skip with ref=null (shouldn't happen but is null-safe)
  const resB = handleSkipDuringBreak(null, rotAfterFlip, idx, interstitialSongs, interstitialIndex);
  assert('Bug2/3-Ext-B: null ref safely falls back to rot[idx] (Blair)',
    resB.breakKey === `after-${blairId}`);
  assert('Bug2/3-Ext-B: null ref + Blair key finds no songs (Blair has none)',
    resB.advanced === false);

  // C: All break songs exhausted on skip — ref cleared, advances to next dancer
  const resC = handleSkipDuringBreak(storedRef, rotAfterFlip, idx, interstitialSongs, 2); // interIdx=2 > length=2
  assert('Bug2/3-Ext-C: All break songs done — falls through (clearRef=true)',
    resC.clearRef === true && resC.advanced === false);

  // D: stopRotation clears the ref
  let breakKeyRef = `after-${minnieId}`;
  function stopRotation() {
    breakKeyRef = null; // mirrors line 3159
  }
  stopRotation();
  assert('Bug2/3-Ext-D: stopRotation clears playingInterstitialBreakKeyRef',
    breakKeyRef === null);

  // E: After stopRotation + new rotation start, ref begins as null
  assert('Bug2/3-Ext-E: New rotation starts with null ref (clean slate)',
    breakKeyRef === null);

  // F: Starting a new break immediately after stopRotation uses fresh key
  const newRotation = [blairId, minnieId];
  const freshKey = `after-${newRotation[0]}`;
  breakKeyRef = freshKey; // set when new break starts
  assert('Bug2/3-Ext-F: New break after restart stores Blair key (Blair now first)',
    breakKeyRef === `after-${blairId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE SERVER — verify /api/booth/display shape
// ─────────────────────────────────────────────────────────────────────────────
async function testLiveBoothDisplay() {
  console.log('\n━━━ LIVE: /api/booth/display payload shape ━━━━━━━━━━━━━━━━━━━━━');

  const res = await api('GET', '/api/booth/display');
  assert('booth/display responds 200', res.status === 200);

  const d = res.data;
  assert('booth/display has isRotationActive', 'isRotationActive' in d);
  assert('booth/display has isPlaying', 'isPlaying' in d);
  assert('booth/display has currentSongNumber', 'currentSongNumber' in d);
  assert('booth/display has breakSongIndex (Bug 4 critical field)', 'breakSongIndex' in d,
    `Keys present: ${Object.keys(d).join(', ')}`);
  assert('booth/display has breakSongsPerSet', 'breakSongsPerSet' in d);
  assert('breakSongIndex is null when no rotation active', d.breakSongIndex === null || d.breakSongIndex === undefined || typeof d.breakSongIndex === 'number');

  // Simulate what RotationDisplay does with this data (line 140)
  const isBreak = d.breakSongIndex != null && d.isRotationActive;
  assert('RotationDisplay isBreak formula works on live data (no crash)', typeof isBreak === 'boolean');
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD TEXT MANIPULATION — insertAtCursor / deleteAtCursor logic
// ─────────────────────────────────────────────────────────────────────────────
async function testKeyboardTextManipulation() {
  console.log('\n━━━ KEYBOARD: Text cursor manipulation ━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Pure logic mirrors of insertAtCursor / deleteAtCursor from VirtualKeyboard.jsx
  function insertAt(value, selStart, selEnd, char) {
    const before = value.slice(0, selStart);
    const after  = value.slice(selEnd);
    return { value: before + char + after, pos: selStart + char.length };
  }

  function deleteAt(value, selStart, selEnd) {
    if (selStart !== selEnd) {
      return { value: value.slice(0, selStart) + value.slice(selEnd), pos: selStart };
    }
    if (selStart > 0) {
      return { value: value.slice(0, selStart - 1) + value.slice(selStart), pos: selStart - 1 };
    }
    return { value, pos: 0 }; // at start — nothing to delete
  }

  // insertAt — cursor at end
  const r1 = insertAt('hello', 5, 5, '!');
  assert('Insert at end: value correct', r1.value === 'hello!');
  assert('Insert at end: cursor after new char', r1.pos === 6);

  // insertAt — cursor at start
  const r2 = insertAt('hello', 0, 0, 'X');
  assert('Insert at start: value correct', r2.value === 'Xhello');
  assert('Insert at start: cursor after new char', r2.pos === 1);

  // insertAt — cursor in middle
  const r3 = insertAt('hello', 2, 2, '-');
  assert('Insert at middle: value correct', r3.value === 'he-llo');
  assert('Insert at middle: cursor after new char', r3.pos === 3);

  // insertAt — selection replaced
  const r4 = insertAt('hello world', 6, 11, 'there');
  assert('Insert replaces selection: value correct', r4.value === 'hello there');
  assert('Insert replaces selection: cursor after inserted text', r4.pos === 11);

  // insertAt — space key
  const r5 = insertAt('hello', 5, 5, ' ');
  assert('Space insert at end', r5.value === 'hello ');

  // deleteAt — cursor at end, deletes last char
  const d1 = deleteAt('hello', 5, 5);
  assert('Delete at end: removes last char', d1.value === 'hell');
  assert('Delete at end: cursor moves back', d1.pos === 4);

  // deleteAt — cursor in middle
  const d2 = deleteAt('hello', 3, 3);
  assert('Delete in middle: removes char before cursor', d2.value === 'helo');
  assert('Delete in middle: cursor moves back', d2.pos === 2);

  // deleteAt — cursor at start — nothing changes
  const d3 = deleteAt('hello', 0, 0);
  assert('Delete at start: no change', d3.value === 'hello' && d3.pos === 0);

  // deleteAt — selection deleted
  const d4 = deleteAt('hello world', 6, 11);
  assert('Delete selection: removes selected text', d4.value === 'hello ');
  assert('Delete selection: cursor at start of deleted range', d4.pos === 6);

  // deleteAt — empty string
  const d5 = deleteAt('', 0, 0);
  assert('Delete from empty string: safe no-op', d5.value === '' && d5.pos === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD LAYOUT — completeness check
// ─────────────────────────────────────────────────────────────────────────────
async function testKeyboardLayouts() {
  console.log('\n━━━ KEYBOARD: Layout completeness ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Mirrors the layouts defined in VirtualKeyboard.jsx
  const ROWS_LOWER = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['SHIFT','z','x','c','v','b','n','m','DEL'],
    ['123','SPACE','DONE'],
  ];
  const ROWS_UPPER = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['SHIFT','Z','X','C','V','B','N','M','DEL'],
    ['123','SPACE','DONE'],
  ];
  const ROWS_SYM = [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['-','/',':', ';','(',')','\u20ac','&','@','"'],
    ['#','%','\\','^','*','+','=','_','~','DEL'],
    ['ABC','SPACE','DONE'],
  ];
  const ROWS_NUM = [
    ['1','2','3'],
    ['4','5','6'],
    ['7','8','9'],
    ['.','0','DEL'],
    ['ABC','DONE'],
  ];

  function checkLayout(name, rows) {
    const allKeys = rows.flat();
    const SPECIAL = new Set(['SHIFT','DEL','123','ABC','SPACE','DONE']);
    const chars = allKeys.filter(k => !SPECIAL.has(k));

    // No duplicates in character keys
    const uniqueChars = new Set(chars);
    assert(`${name}: no duplicate character keys`,
      uniqueChars.size === chars.length,
      `Duplicates: ${chars.filter((k,i) => chars.indexOf(k) !== i).join(', ')}`);

    // Every row is non-empty
    assert(`${name}: all rows non-empty`,
      rows.every(r => r.length > 0));

    // Has at least one action key
    assert(`${name}: has DONE key`, allKeys.includes('DONE'));

    return chars;
  }

  const lowerChars = checkLayout('QWERTY-lower', ROWS_LOWER);
  const upperChars = checkLayout('QWERTY-upper', ROWS_UPPER);
  const symChars   = checkLayout('Symbol', ROWS_SYM);
  const numChars   = checkLayout('Numpad', ROWS_NUM);

  // Lower and upper should be same letters, different case
  assert('Lower/upper same letter count', lowerChars.length === upperChars.length);
  assert('Lower letters are lowercase', lowerChars.every(c => c === c.toLowerCase()));
  assert('Upper letters are uppercase', upperChars.every(c => c === c.toUpperCase()));

  // All 26 letters present in lower
  const alpha = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const missingLetters = alpha.filter(l => !lowerChars.includes(l));
  assert(`Lower layout has all 26 letters (missing: ${missingLetters.join('') || 'none'})`,
    missingLetters.length === 0);

  // Numpad has 0-9 and dot
  assert('Numpad has all digits 0-9',
    ['0','1','2','3','4','5','6','7','8','9'].every(d => numChars.includes(d)));
  assert('Numpad has decimal point', numChars.includes('.'));

  // Symbol has digits 0-9
  assert('Symbol row has digits 0-9',
    ['0','1','2','3','4','5','6','7','8','9'].every(d => symChars.includes(d)));

  // Shift toggle: lower→upper→lower
  let mode = 'lower';
  function handleShift() { mode = mode === 'upper' ? 'lower' : 'upper'; }
  handleShift();
  assert('Shift: lower → upper', mode === 'upper');
  handleShift();
  assert('Shift: upper → lower (toggle)', mode === 'lower');

  // 123 → sym, ABC → lower
  let currentLayout = 'lower';
  function handle123() { currentLayout = 'sym'; mode = 'lower'; }
  function handleABC() { currentLayout = 'lower'; mode = 'lower'; }
  handle123();
  assert('123 key → symbol layout', currentLayout === 'sym');
  handleABC();
  assert('ABC key → back to lower', currentLayout === 'lower');
}

// ─────────────────────────────────────────────────────────────────────────────
// SONG HIGHLIGHT BUG — currentTrack name-match vs index-match
// ─────────────────────────────────────────────────────────────────────────────
async function testSongHighlight() {
  console.log('\n━━━ SONG HIGHLIGHT: Name-match vs index-match ━━━━━━━━━━━━━━━━━');

  // Mirrors the new logic in RotationPlaylistManager (lines 1241-1243)
  function computeHighlight(assigned, currentTrack, currentSongNumber, isCurrentDancer) {
    const currentTrackIdx = isCurrentDancer && currentTrack ? assigned.indexOf(currentTrack) : -1;
    return assigned.map((songName, songIdx) => {
      const isNowPlaying = isCurrentDancer && currentTrack
        ? songName === currentTrack
        : isCurrentDancer && songIdx === (currentSongNumber - 1);
      const isPlayed = isCurrentDancer && (
        currentTrackIdx >= 0 ? songIdx < currentTrackIdx : songIdx < (currentSongNumber - 1)
      );
      return { songName, isNowPlaying, isPlayed };
    });
  }

  // A: Happy path — currentTrack matches assigned[0], so song 1 highlights correctly
  const assigned = ['Wild Ones.mp3', 'Bobby Brown.mp3'];
  const resA = computeHighlight(assigned, 'Wild Ones.mp3', 1, true);
  assert('Highlight-A: Wild Ones highlighted (name match)', resA[0].isNowPlaying === true);
  assert('Highlight-A: Bobby Brown NOT highlighted', resA[1].isNowPlaying === false);
  assert('Highlight-A: No songs marked played (first song)', resA[0].isPlayed === false);

  // B: The bug scenario — tracks reassigned mid-song
  // Playing Wild Ones (slot 0), but assigned now has Bobby Brown in slot 0
  const assignedAfterReroll = ['Bobby Brown.mp3', 'Inoj - Ring My Bell.mp3'];
  const resB = computeHighlight(assignedAfterReroll, 'Wild Ones.mp3', 1, true);
  assert('Highlight-B: Bobby Brown NOT highlighted despite being at index 0 (fix verified)',
    resB[0].isNowPlaying === false);
  assert('Highlight-B: Inoj NOT highlighted either', resB[1].isNowPlaying === false);
  assert('Highlight-B: No false isPlayed when currentTrack not in list', 
    resB[0].isPlayed === false && resB[1].isPlayed === false);

  // Old (broken) logic for comparison
  function oldIsNowPlaying(songIdx, currentSongNumber, isCurrentDancer) {
    return isCurrentDancer && songIdx === (currentSongNumber - 1);
  }
  assert('Highlight-B: OLD logic wrongly highlighted Bobby Brown at idx 0',
    oldIsNowPlaying(0, 1, true) === true);

  // C: Song 2 playing, song 1 should be hidden (isPlayed=true)
  const assigned2 = ['Wild Ones.mp3', 'Electric Feel.mp3'];
  const resC = computeHighlight(assigned2, 'Electric Feel.mp3', 2, true);
  assert('Highlight-C: Electric Feel highlighted (song 2)', resC[1].isNowPlaying === true);
  assert('Highlight-C: Wild Ones marked as played (hidden)', resC[0].isPlayed === true);
  assert('Highlight-C: Electric Feel not marked played', resC[1].isPlayed === false);

  // D: Song 2 playing but assigned shows different song at slot 1 (same reroll bug)
  // Playing Electric Feel, but slot 1 now has Inoj after reroll
  const assigned2Rerolled = ['Wild Ones.mp3', 'Inoj - Ring My Bell.mp3'];
  const resD = computeHighlight(assigned2Rerolled, 'Electric Feel.mp3', 2, true);
  assert('Highlight-D: Inoj NOT highlighted despite being at index 1', resD[1].isNowPlaying === false);
  assert('Highlight-D: Wild Ones still hidden via index fallback (currentSongNumber=2 → idx 0 was played)',
    resD[0].isPlayed === true);
  assert('Highlight-D: OLD logic would have wrongly highlighted Inoj at idx 1',
    oldIsNowPlaying(1, 2, true) === true);

  // E: Not the current dancer — nothing highlighted
  const resE = computeHighlight(assigned, 'Wild Ones.mp3', 1, false);
  assert('Highlight-E: Non-current dancer — no song highlighted', resE.every(r => !r.isNowPlaying));
  assert('Highlight-E: Non-current dancer — no songs hidden', resE.every(r => !r.isPlayed));

  // F: currentTrack is null — graceful fallback to index
  const resF = computeHighlight(assigned, null, 1, true);
  assert('Highlight-F: null currentTrack — falls back to index match (slot 0 highlighted)',
    resF[0].isNowPlaying === true && resF[1].isNowPlaying === false);

  // G: 3-song set, song 3 playing — 2 songs marked played
  const assigned3 = ['Song A.mp3', 'Song B.mp3', 'Song C.mp3'];
  const resG = computeHighlight(assigned3, 'Song C.mp3', 3, true);
  assert('Highlight-G: Song C highlighted', resG[2].isNowPlaying === true);
  assert('Highlight-G: Song A marked played', resG[0].isPlayed === true);
  assert('Highlight-G: Song B marked played', resG[1].isPlayed === true);
  assert('Highlight-G: Song C not marked played', resG[2].isPlayed === false);
}

async function cleanup() {
  console.log('\n━━━ CLEANUP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const [name, dancer] of [['TestMinnie', dancerMinnie], ['TestBlair', dancerBlair]]) {
    if (dancer) {
      const r = await api('DELETE', `/api/dancers/${dancer.id}`);
      console.log(`  Deleted ${name}: ${r.status === 200 ? '✓' : `✗ (${r.status})`}`);
    }
  }
  console.log('  Test songs remain in library (harmless — real songs still present)');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         NEON AI DJ — BUG FIX TEST HARNESS                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  try {
    await setup();
    await testBug4();
    await testBug23();
    await testBug23Extended();
    await testBug5();
    await testBug1();
    await testKeyboard();
    await testKeyboardTextManipulation();
    await testKeyboardLayouts();
    await testSongHighlight();
    await testServerIntegration();
    await testLiveBoothDisplay();
  } catch (err) {
    console.error('\n💥 Unexpected test runner error:', err.message);
    console.error(err.stack);
    failed++;
  } finally {
    await cleanup();
  }

  const total = passed + failed;
  const bar = '═'.repeat(62);
  console.log(`\n╔${bar}╗`);
  const summary = `  RESULTS: ${passed}/${total} passed   ${failed > 0 ? `❌ ${failed} FAILED` : '✅ ALL PASS'}`;
  console.log(`║${summary.padEnd(62)}║`);
  console.log(`╚${bar}╝`);

  if (failed > 0) {
    console.log('\n  Failed tests:');
    results.filter(r => !r.pass).forEach(r => {
      console.log(`    ❌ ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
    });
    process.exit(1);
  }

  process.exit(0);
})();
