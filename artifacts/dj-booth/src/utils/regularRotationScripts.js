// Regular rotation intros/outros intentionally stay short.  These are the
// no-LLM scripts used on units that do not have an OpenAI key; keep the
// entertainer identity, one showmanship phrase, and one crowd cue in each
// line.  Feature, house, promo, round-two, and stage-transition copy lives
// elsewhere and must not be added to this pool.

export const REGULAR_ROTATION_VERSION = 'REGULAR_V2';

export const LOCAL_REGULAR_ROTATION_SCRIPTS = Object.freeze({
  intro: Object.freeze([
    (name) => `[energetically] Bringing a little temptation to your night, welcome the lovely ${name}! Gentlemen, show her some love tonight.`,
    (name) => `[excitedly] Fellas, welcome the beautiful ${name} — she is bringing a touch of magic to the main stage tonight.`,
    (name) => `[playfully] Gentlemen, the lovely ${name} is here to turn your ordinary night into something unforgettable on the main stage.`,
    (name) => `[impressed] Fellas, welcome ${name} — she carries enough sparkle to make this stage feel like the main event tonight.`,
    (name) => `[energetically] Gentlemen, here is ${name}, bringing a little mischief and plenty of charm to the main stage tonight.`,
  ]),
  outro: Object.freeze([
    (name) => `[impressed] The gorgeous ${name}, gentlemen — leaving you wanting just a little more. Give her a hand right now!`,
    (name) => `[excitedly] Fellas, that was the captivating ${name}, leaving a little magic in the air. Find her for private time.`,
    (name) => `[playfully] That was the radiant ${name}, gentlemen — she left the stage glowing. Catch her for a private dance.`,
    (name) => `[triumphantly] The lovely ${name}, fellas — she made the whole room feel a little more alive. Private time is waiting.`,
    (name) => `[impressed] Gentlemen, ${name} just turned the stage into a little bit of magic. Find her for private time.`,
  ]),
});

const GENERIC_DANCER_NAME = '_GENERIC_';

export function buildGenericRecordingType(type, varNum = 1) {
  const index = Math.max(1, Number(varNum) || 1);
  const base = `${type}_${index}`;
  return (type === 'intro' || type === 'outro')
    ? `${base}_${REGULAR_ROTATION_VERSION}`
    : base;
}

export function buildLocalRegularRotationScript(type, dancerName, varNum = 1) {
  const pool = LOCAL_REGULAR_ROTATION_SCRIPTS[type];
  if (!pool) return null;

  const rawName = typeof dancerName === 'string' ? dancerName.trim() : '';
  const name = rawName && rawName !== GENERIC_DANCER_NAME
    ? rawName
    : 'your next entertainer';
  const index = (Math.max(1, Number(varNum) || 1) - 1) % pool.length;
  return pool[index](name);
}