import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_REGULAR_ROTATION_SCRIPTS,
  REGULAR_ROTATION_VERSION,
  buildGenericRecordingType,
  buildLocalRegularRotationScript,
} from './regularRotationScripts.js';
import {
  REGULAR_GENERIC_AUDIO_VERSION,
  REGULAR_GENERIC_SCRIPTS,
} from '../../../api-server/server/genericRotationScripts.js';
import { buildAnnouncementPrompt } from './energyLevels.js';

const CROWD_CUE = /\b(?:fellas|gentlemen)\b/gi;
const RESPONSE_CUE = /show her some love|give her a hand/gi;
const DISALLOWED_CROWD_CUES = /give it up|make some noise|let me hear|round of applause|show some love|keep tipping|cash flowing|pay-per-view|kings|players/i;

const wordCount = text => text.replace(/\[[^\]]+\]/g, '').trim().split(/\s+/).length;
const crowdCueCount = text => (text.match(CROWD_CUE) || []).length;

test('local regular pools stay short and preserve identity/showmanship/crowd shape', () => {
  const name = 'Ava';

  for (const type of ['intro', 'outro']) {
    assert.equal(LOCAL_REGULAR_ROTATION_SCRIPTS[type].length, 5);
    for (let variant = 1; variant <= 5; variant++) {
      const script = buildLocalRegularRotationScript(type, name, variant);
      assert.ok(script);
      assert.equal((script.match(/\bAva\b/g) || []).length, 1, `${type} var${variant} names the entertainer once`);
      assert.equal(crowdCueCount(script), 1, `${type} var${variant} has one crowd cue`);
      const [minimum, maximum] = type === 'intro' ? [17, 23] : [15, 21];
      assert.ok(wordCount(script) >= minimum, `${type} var${variant} should retain a flowing ${type} baseline`);
      assert.ok(wordCount(script) <= maximum, `${type} var${variant} should remain a shortened fallback`);
      assert.ok((script.match(RESPONSE_CUE) || []).length <= 1, `${type} var${variant} should have one response cue at most`);
      assert.doesNotMatch(script, DISALLOWED_CROWD_CUES);
    }
  }
});

test('generic regular audio pool stays tasteful and excludes repetitive slang', () => {
  for (const type of ['intro', 'outro']) {
    assert.equal(REGULAR_GENERIC_SCRIPTS[type].length, 10);
    for (const script of REGULAR_GENERIC_SCRIPTS[type]) {
      assert.ok(wordCount(script) >= 15, `${type} generic line should preserve a flowing baseline`);
      assert.ok(wordCount(script) <= 21, `${type} generic line should remain a shortened fallback`);
      assert.equal(crowdCueCount(script), 1, `${type} generic line has one crowd cue`);
      assert.doesNotMatch(script, DISALLOWED_CROWD_CUES);
      if (type === 'intro') {
        assert.match(script, /your next entertainer/i);
      } else {
        assert.match(script, /\b(?:she|her)\b/i);
      }
    }
  }
});

test('normal rotation prompts require one name, one cue, and one showmanship phrase', () => {
  const intro = buildAnnouncementPrompt('intro', 'Ava', null, 4, 1, 1);
  const outro = buildAnnouncementPrompt('outro', 'Ava', null, 4, 1, 1);

  assert.match(intro, /17-23 spoken words/i);
  assert.match(outro, /15-21 spoken words/i);
  assert.match(intro, /exactly two flowing sentences/i);
  assert.match(outro, /exactly two flowing sentences/i);
  assert.match(intro, /global 5-14-word limit/i);
  assert.match(outro, /global 5-14-word limit/i);
  for (const prompt of [intro, outro]) {
    assert.match(prompt, /exactly once/i);
    assert.match(prompt, /one natural colorful\/showmanship phrase/i);
    assert.match(prompt, /one crowd address/i);
    assert.doesNotMatch(prompt, /Say "Ava" two or three times/);
    assert.match(prompt, /pay-per-view, kings, players/i);
  }
  assert.doesNotMatch(intro, /Three to five sentences\./);
  assert.doesNotMatch(outro, /Two to four sentences\./);
});

test('regular namespace is narrow and feature prompt remains separate', () => {
  assert.match(REGULAR_ROTATION_VERSION, /^REGULAR_/);
  assert.equal(REGULAR_ROTATION_VERSION, REGULAR_GENERIC_AUDIO_VERSION);
  assert.equal(buildGenericRecordingType('intro', 1), `intro_1_${REGULAR_ROTATION_VERSION}`);
  assert.equal(buildGenericRecordingType('outro', 10), `outro_10_${REGULAR_ROTATION_VERSION}`);
  assert.equal(buildGenericRecordingType('round2', 2), 'round2_2');
  const feature = buildAnnouncementPrompt('feature_intro', 'Ava', null, 4, 1, 1, {});
  assert.match(feature, /SPECIAL FEATURE ENTERTAINER/);
  assert.match(feature, /Five to eight sentences/);
  assert.doesNotMatch(feature, /REGULAR STAGE INTRODUCTION|REGULAR STAGE EXIT/);
});