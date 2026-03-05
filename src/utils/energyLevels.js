export const ENERGY_LEVELS = {
  1: { name: 'Early Shift', short: 'L1', color: '#3b82f6', shiftType: 'EARLY_SHIFT' },
  2: { name: 'Mid Shift', short: 'L2', color: '#22c55e', shiftType: 'MID_SHIFT' },
  3: { name: 'Prime Shift', short: 'L3', color: '#eab308', shiftType: 'PRIME_SHIFT' },
  4: { name: 'Peak Prime', short: 'L4', color: '#f97316', shiftType: 'PRIME_SHIFT' },
  5: { name: 'Late Shift', short: 'L5', color: '#a855f7', shiftType: 'LATE_SHIFT' },
};

export const getAutoEnergyLevel = (openHour, closeHour) => {
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;

  let totalHours;
  if (closeHour === openHour) {
    totalHours = 24;
  } else if (closeHour > openHour) {
    totalHours = closeHour - openHour;
  } else {
    totalHours = (24 - openHour) + closeHour;
  }

  let hoursIntoShift;
  if (closeHour === openHour) {
    hoursIntoShift = currentHour - openHour;
    if (hoursIntoShift < 0) hoursIntoShift += 24;
  } else if (closeHour > openHour) {
    hoursIntoShift = currentHour - openHour;
    if (hoursIntoShift < 0) hoursIntoShift += 24;
  } else {
    if (currentHour >= openHour) {
      hoursIntoShift = currentHour - openHour;
    } else if (currentHour < closeHour) {
      hoursIntoShift = (24 - openHour) + currentHour;
    } else {
      return 1;
    }
  }

  if (hoursIntoShift < 0 || hoursIntoShift > totalHours) {
    return 1;
  }

  const pct = hoursIntoShift / totalHours;

  if (pct < 0.2) return 1;
  if (pct < 0.4) return 2;
  if (pct < 0.65) return 3;
  if (pct < 0.85) return 4;
  return 5;
};

export const getCurrentEnergyLevel = (config) => {
  const override = config?.energyOverride;
  if (override && override !== 'auto') {
    return parseInt(override, 10);
  }
  const openHour = config?.clubOpenHour ?? 11;
  const closeHour = config?.clubCloseHour ?? 2;
  return getAutoEnergyLevel(openHour, closeHour);
};

export const VOICE_SETTINGS = {
  1: {
    stability: 0.78,
    similarity_boost: 0.82,
    style: 0.10,
    speed: 0.95,
  },
  2: {
    stability: 0.70,
    similarity_boost: 0.80,
    style: 0.15,
    speed: 0.97,
  },
  3: {
    stability: 0.62,
    similarity_boost: 0.78,
    style: 0.20,
    speed: 1.0,
  },
  4: {
    stability: 0.55,
    similarity_boost: 0.78,
    style: 0.25,
    speed: 1.02,
  },
  5: {
    stability: 0.72,
    similarity_boost: 0.82,
    style: 0.12,
    speed: 0.97,
  },
};

const SHIFT_TYPES = {
  EARLY_SHIFT: {
    tone: 'welcoming, playful, lightly suggestive',
    confidence: 'moderate',
    excitement: 'Keep energy warm and inviting — easy pace, smooth delivery.',
  },
  MID_SHIFT: {
    tone: 'sharper, more assertive',
    confidence: 'building',
    excitement: 'Bring more punch and attitude. Project your voice like the room is filling up.',
  },
  PRIME_SHIFT: {
    tone: 'dominant, magnetic, high authority',
    confidence: 'strong and commanding',
    excitement: 'This is the peak of the night. Bring your A-game energy — charged language, drawn-out key words, bigger presence. Sound like the room is packed and you own every corner of it. Still smooth, still cool, just turned up.',
  },
  LATE_SHIFT: {
    tone: 'smooth, intimate, persuasive',
    confidence: 'controlled and confident',
    excitement: 'Cool it down. Slower cadence, smoother delivery. Intimate and enticing.',
  },
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SYSTEM_PROMPT = `You are a veteran strip club DJ with twenty years on the mic. You don't sound like an announcer or a radio host — you sound like a smooth, confident guy who runs the room every night. Your voice is conversational, laid-back, and cool. You talk the way a real person talks, with natural pauses and a relaxed rhythm.

HOW YOU SOUND:
- Conversational and relaxed, like you're talking to regulars
- Confident but never shouting or over-the-top
- You let moments breathe — short phrases with pauses between them
- You address the crowd directly: "fellas", "gentlemen", "y'all"
- You reference money naturally: "get those dollars ready", "show her some love", "tip heavy"
- You say the entertainer's name clearly and let it land — usually at the end of a phrase
- You use simple, everyday words — nothing fancy or literary

THINGS YOU NEVER DO:
- Sound like you're reading a script or making an announcement
- Use flowery or poetic language
- Stack multiple hype phrases back-to-back without breathing room
- Use the word "around" when you mean "round" (say "round two", never "around two")

TTS FORMATTING (this text is read aloud by a speech engine):
- Commas for natural breath pauses
- Ellipsis for drawn-out pauses: "right about now... here she comes"
- Em dash for emphasis breaks: "she's coming — and she's worth every dollar"
- Periods between thoughts, not run-on sentences
- No all caps — it makes the engine shout
- Maximum one exclamation mark per announcement
- Write numbers as words, "V I P" with spaces between letters
- Use contractions: "don't", "she's", "let's"
- Sentences between five and fourteen words
- End on a smooth note, no exclamation mark on the last sentence`;

export const buildAnnouncementPrompt = (type, dancerName, nextDancerName, energyLevel, roundNumber, clubName, clubSpecials = []) => {
  const level = Math.max(1, Math.min(5, energyLevel || 3));
  const levelInfo = ENERGY_LEVELS[level];
  const shiftType = levelInfo.shiftType;
  const shift = SHIFT_TYPES[shiftType];
  const closingWindow = level >= 5;
  const clubLine = clubName ? `CLUB NAME: "${clubName}"
CLUB NAME USAGE RULE: "${clubName}" is a proper noun. NEVER put "the" before it in general references. Say "here at ${clubName}", "${clubName} Nation", "${clubName} family", "welcome to ${clubName}" — NOT "the ${clubName}". The ONLY exception is "welcome to the ${clubName}" which is acceptable but "welcome to ${clubName}" is preferred. You can create compound phrases like "${clubName} Nation", "${clubName} fans", "${clubName} family" freely.` : '';

  const isGeneric = dancerName === '_GENERIC_';
  const displayName = isGeneric ? 'your next entertainer' : dancerName;
  const genericNote = isGeneric ? '\nIMPORTANT: Do NOT use a specific name. Refer to her as "your next entertainer", "this beauty", "she", or similar generic references.' : '';
  const now = new Date();
  const clubDay = now.getHours() < 6 ? new Date(now.getTime() - 6 * 60 * 60 * 1000) : now;
  const dayOfWeek = DAY_NAMES[clubDay.getDay()];

  let eventInstructions = '';

  if (type === 'intro') {
    eventInstructions = `EVENT: STAGE INTRODUCTION
Today is ${dayOfWeek}.

${displayName} is about to take the main stage.${genericNote}

Build it up naturally: get the crowd's attention, tell them to get their money ready, then bring her out. No V I P mentions, no drink plugs — just the stage intro.

${isGeneric ? 'Use generic references throughout.' : `Say "${displayName}" two or three times, spaced out. Drop the name early, weave it in the middle, land it smooth at the end. The last time you say her name should be cool and confident — not shouted.`}

EXAMPLES (match this vibe, write something original):
"All right, all right... main stage, gentlemen. Get those dollars out, because ${displayName} is about to do her thing. That's right fellas, coming to the stage... the lovely ${displayName}."
"Right about now... I need all eyes up front. ${displayName} is heading your way. Fellas, grab some cash — you're gonna need it. Give it up for ${displayName}."
"Main stage, let's go. We're doing it right on a ${dayOfWeek} night. ${displayName} is coming up, so get those ones ready. Here she comes, gentlemen... ${displayName}."

Three to five sentences.`;

  } else if (type === 'round2') {
    const roundLabel = roundNumber >= 3 ? 'round three' : 'round two';
    eventInstructions = `EVENT: CONTINUING SET (${roundLabel.toUpperCase()})

${displayName} is still on stage — this is ${roundLabel}.${genericNote}

She never left. Do not say "coming back", "returning", or "welcome back" — she's been up there the whole time. Keep it short and casual. No V I P mentions.

EXAMPLES (match this vibe, write something original):
"${roundLabel}, gentlemen. Keep it going for ${displayName}."
"We're not done yet... more of the beautiful ${displayName}."
"${roundLabel}, fellas. Keep those dollars coming for ${displayName}."
"She's still going, gentlemen. ${roundLabel} with ${displayName}."

One to two sentences. Cool and conversational, not a big entrance. ${isGeneric ? 'Do not use a specific name.' : `Her name is ${displayName}.`}`;

  } else if (type === 'outro') {
    eventInstructions = `EVENT: STAGE EXIT

${displayName} just finished her set on the main stage.${genericNote}

Wrap it up, give her props, then push the V I P and private dances — this is the upsell moment.

EXAMPLES (match this vibe, write something original):
"All right gentlemen, that was the lovely ${displayName}. She's done on the main stage... but she's available for that one-on-one V I P experience. Don't let her slip away."
"Show some love for ${displayName}, fellas. Main stage is done, but your chance for a private dance is just getting started."
"One more time for the beautiful ${displayName}. If you want more of that... she's heading to V I P. Go see her."

Two to four sentences. ${isGeneric ? 'Do not use a specific name.' : `Her name is ${displayName}.`}`;

  } else if (type === 'transition') {
    const nextName = isGeneric ? 'the next entertainer' : (nextDancerName || 'the next performer');
    const outgoingRef = isGeneric ? 'She' : dancerName;
    eventInstructions = `EVENT: STAGE TRANSITION
Today is ${dayOfWeek}.

${displayName} is done. ${nextName} is coming up next.${genericNote}

Quick love for the outgoing girl, then shift focus to who's coming. No V I P mentions here — save that for the outro.

${isGeneric ? 'Use generic references throughout.' : `Say "${nextName}" two or three times, spaced naturally. "${outgoingRef}" just needs one mention.`}

EXAMPLES (match this vibe, write something original):
"One more time for ${outgoingRef}. Now... main stage, get ready. ${nextName} is coming up next. Fellas, get those dollars out — ${nextName} is about to do her thing."
"Show some love for ${outgoingRef}. Right about now... ${nextName} is heading to the stage. That's right gentlemen, back to back. Here comes ${nextName}."

Three to five sentences. Rhyming is cool if it's natural — like "doing it right on a ${dayOfWeek} night."`;
  }

  const shiftBlock = `TONE (do not reference these labels in the spoken text — just let them guide your delivery):
Tone: ${shift.tone}. Confidence: ${shift.confidence}.
${shift.excitement}`;

  const closingBlock = closingWindow
    ? `PACING: Add urgency. Emphasize limited time. Use slightly shorter sentences.`
    : `PACING: No time pressure. Focus on smooth persuasion.`;

  const behaviorRule = shiftType === 'EARLY_SHIFT'
    ? 'Sound welcoming and build anticipation.'
    : shiftType === 'MID_SHIFT'
    ? 'Increase energy and confidence.'
    : shiftType === 'PRIME_SHIFT'
    ? 'Sound authoritative and commanding without yelling.'
    : closingWindow
    ? 'Add urgency and "last chance" psychology without sounding desperate.'
    : 'Lower tempo language. Intimate tone. Controlled persuasion.';

  const parts = [
    SYSTEM_PROMPT,
  ];

  if (clubLine) parts.push(clubLine);

  parts.push(
    eventInstructions,
    shiftBlock,
    closingBlock,
    `BEHAVIOR: ${behaviorRule}`,
  );

  if (clubSpecials && clubSpecials.length > 0 && (type === 'outro' || type === 'transition')) {
    parts.push(`CLUB SPECIALS (weave naturally into the announcement — do not list mechanically):
${clubSpecials.map(s => `- ${s}`).join('\n')}`);
  }

  parts.push(`OUTPUT FORMAT:
Write the announcement as flowing spoken text — exactly what the DJ would say over the mic.
Do not include labels, brackets, stage directions, or explanations.
Do not number the lines.
Just the spoken words, nothing else.`);

  return parts.join('\n\n');
};
