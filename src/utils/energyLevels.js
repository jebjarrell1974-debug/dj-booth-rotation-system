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
    stability: 0.75,
    similarity_boost: 0.80,
    style: 0.15,
    speed: 0.92,
  },
  2: {
    stability: 0.60,
    similarity_boost: 0.78,
    style: 0.25,
    speed: 1.0,
  },
  3: {
    stability: 0.50,
    similarity_boost: 0.75,
    style: 0.35,
    speed: 1.05,
  },
  4: {
    stability: 0.42,
    similarity_boost: 0.72,
    style: 0.40,
    speed: 1.1,
  },
  5: {
    stability: 0.65,
    similarity_boost: 0.80,
    style: 0.20,
    speed: 0.95,
  },
};

const SHIFT_TYPES = {
  EARLY_SHIFT: {
    tone: 'welcoming, playful, lightly suggestive',
    confidence: 'moderate',
  },
  MID_SHIFT: {
    tone: 'sharper, more assertive',
    confidence: 'building',
  },
  PRIME_SHIFT: {
    tone: 'dominant, magnetic, high authority',
    confidence: 'strong',
  },
  LATE_SHIFT: {
    tone: 'smooth, intimate, persuasive',
    confidence: 'controlled and confident',
  },
};

const SYSTEM_PROMPT = `You are an AI strip club DJ voice engine.

Your job is to generate smooth, confident, adult-toned stage announcements that sound natural, rhythmic, and intentional. Never corny. Never forced. Never robotic.

Do not use forced rhymes.
Do not stack slang awkwardly.
Avoid clichés.
Keep it sounding like a real experienced DJ speaking over music.
Keep adult tone suggestive but not explicit.

Vary sentence length for rhythm.
Do not reuse identical phrasing across announcements.

---
TERMINOLOGY LOCK (CRITICAL)
---
Use "round two" or "round three" when referring to the dancer's set progression.
Never use the word "around" when announcing rounds.
"Round" refers to the dancer's song rotation within her set.
Example: "She's on round two." / "Let's finish strong on round three."

---
RHYTHM RULES
---
Maximum 2 sentences per line.
6 to 16 words per sentence.
Avoid complex grammar.
Avoid more than 3 stressed syllables in a row.
Lines must feel speakable over bass-heavy music.
Use natural pause markers like "..." sparingly.`;

export const buildAnnouncementPrompt = (type, dancerName, nextDancerName, energyLevel, roundNumber, clubName, clubSpecials = []) => {
  const level = Math.max(1, Math.min(5, energyLevel || 3));
  const levelInfo = ENERGY_LEVELS[level];
  const shiftType = levelInfo.shiftType;
  const shift = SHIFT_TYPES[shiftType];
  const closingWindow = level >= 5;
  const clubLine = clubName ? `Club: ${clubName}` : '';

  const isGeneric = dancerName === '_GENERIC_';
  const displayName = isGeneric ? 'your next entertainer' : dancerName;
  const genericNote = isGeneric ? '\nIMPORTANT: Do NOT use a specific name. Refer to her as "your next entertainer", "this beauty", "she", or similar generic references.' : '';

  let eventInstructions = '';

  if (type === 'intro') {
    eventInstructions = `EVENT: STAGE INTRODUCTION

The performer ${displayName} is about to take the main stage.${genericNote}

Every announcement must:
- ${isGeneric ? 'Refer to her without using a specific name' : "Include the performer's name"}
- Clearly state she is coming to the main stage
- Include a persuasive call-to-action to watch and tip
- Build anticipation for her set

Output should be 3-5 sentences total.`;

  } else if (type === 'round2') {
    eventInstructions = `EVENT: CONTINUING SET

The performer ${displayName} is continuing on the main stage — this is her next round.${genericNote}

Every announcement must:
- ${isGeneric ? 'Refer to her without using a specific name' : "Include the performer's name"}
- Acknowledge she is still performing
- Encourage tipping — she's warmed up and giving more
- Keep it short and punchy

Output should be 2-4 sentences total.`;

  } else if (type === 'outro') {
    eventInstructions = `EVENT: STAGE EXIT

The performer ${displayName} has finished her main stage set.${genericNote}

Every announcement must:
- ${isGeneric ? 'Refer to her without using a specific name' : "Include the performer's name"}
- Mention she has finished or is finishing her main stage set
- Clearly state she is available for one-on-one VIP time
- Include a persuasive call-to-action
- Confirm the main stage continues running

Output should be 3-6 sentences total.`;

  } else if (type === 'transition') {
    const nextName = isGeneric ? 'the next entertainer' : (nextDancerName || 'the next performer');
    const outgoingRef = isGeneric ? 'She' : dancerName;
    eventInstructions = `EVENT: STAGE TRANSITION

The performer ${displayName} has finished her main stage set. The next performer ${nextName} is coming to the main stage.${genericNote}

Every announcement must:
- Mention ${outgoingRef} has finished and is available for VIP time
- Introduce ${nextName} coming to the main stage
- Include a persuasive call-to-action for both VIP and the incoming performer
- Confirm the main stage keeps rolling

Output should be 4-6 sentences total.`;
  }

  const shiftBlock = `SHIFT TYPE: ${shiftType}
Tone: ${shift.tone}
Confidence level: ${shift.confidence}`;

  const closingBlock = closingWindow
    ? `CLOSING WINDOW: true
- Add urgency
- Emphasize limited time
- Use slightly shorter sentences
- Strengthen the VIP call-to-action`
    : `CLOSING WINDOW: false
- No time pressure
- Focus on smooth persuasion`;

  const behaviorRule = shiftType === 'EARLY_SHIFT'
    ? 'Sound welcoming and build anticipation.'
    : shiftType === 'MID_SHIFT'
    ? 'Increase energy and push VIP more confidently.'
    : shiftType === 'PRIME_SHIFT'
    ? 'Sound authoritative and commanding without yelling.'
    : closingWindow
    ? 'Add urgency and "last chance" psychology without sounding desperate.'
    : 'Lower tempo language. Intimate tone. Controlled persuasion.';

  const parts = [
    SYSTEM_PROMPT,
    eventInstructions,
    shiftBlock,
    closingBlock,
    `BEHAVIOR: ${behaviorRule}`,
  ];

  if (clubLine) parts.push(clubLine);

  if (clubSpecials && clubSpecials.length > 0) {
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
