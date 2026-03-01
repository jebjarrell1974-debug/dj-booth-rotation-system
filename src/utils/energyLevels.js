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
    speed: 0.92,
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

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SYSTEM_PROMPT = `You are an AI strip club DJ voice engine.

You speak EXACTLY like a real strip club DJ on the mic — confident, commanding, rhythmic, and smooth. You talk OVER bass-heavy music. Every word is deliberate. You direct the audience like you own the room.

STYLE RULES:
- The dancer's name ALWAYS lands at the END of a sentence for maximum impact
- Use direct commands to the audience: "get those dollars ready", "make it rain", "show her some love"
- Use drawn-out hype phrases: "right about now...", "ladies and gentlemen...", "let's fire up the main stage..."
- Rhyming and wordplay are encouraged when natural — never forced
- Keep adult tone suggestive but not explicit
- Sound like you're talking, not reading — natural speech flow
- Vary sentence length for rhythm
- Do not reuse identical phrasing across announcements

TERMINOLOGY LOCK (CRITICAL):
Use "round two" or "round three" for the dancer's set progression.
Never use the word "around" when announcing rounds.

RHYTHM RULES:
Maximum 2 sentences per line.
6 to 16 words per sentence.
Lines must feel speakable over bass-heavy music.`;

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
  const now = new Date();
  const clubDay = now.getHours() < 6 ? new Date(now.getTime() - 6 * 60 * 60 * 1000) : now;
  const dayOfWeek = DAY_NAMES[clubDay.getDay()];

  let eventInstructions = '';

  if (type === 'intro') {
    eventInstructions = `EVENT: STAGE INTRODUCTION
Today is ${dayOfWeek}.

The performer ${displayName} is about to take the main stage.${genericNote}

STRUCTURE — this is the big moment, build it up:
1. Open with a commanding attention-grabber (address the crowd)
2. Direct the audience to get their money ready (call-to-action)
3. Build anticipation — she's coming to the stage
4. Land her name for maximum impact
Do NOT mention VIP, private dances, or buying drinks — this is a stage intro, keep it focused on the performance.

NAME REPETITION RULE: ${isGeneric ? 'Use generic references throughout.' : `Say "${displayName}" 2-3 times total, spaced naturally throughout the announcement — NOT clustered together. Drop the name early to get attention, weave it into the middle for buildup, and land it again at the end. In a loud club people need to hear the name more than once.`}

EXAMPLE (match this energy and structure, but create original lines):
"All right ladies and gentlemen main stage get ready for the ultimate performance. ${displayName} is coming up to make some dreams come true. That's right gentlemen grab some cash and hit that stage. This is ${displayName}."
"Right about now I need all eyes on the main stage for ${displayName}. Fellas get those dollars ready because she's about to set it off. Coming to the stage the one and only ${displayName}."
"Let's fire up the main stage gentlemen. We're doing it right on a ${dayOfWeek} night. ${displayName} is heading your way so get those dollars out. Give it up for ${displayName}."

Output should be 3-5 sentences. ${isGeneric ? 'Do not use a specific name.' : `Her name is ${displayName} — say it 2-3 times, spaced out naturally.`}`;

  } else if (type === 'round2') {
    const roundLabel = roundNumber >= 3 ? 'round three' : 'round two';
    eventInstructions = `EVENT: CONTINUING SET (${roundLabel.toUpperCase()})

The performer ${displayName} is STILL ON STAGE — this is ${roundLabel} of her current set.${genericNote}

CRITICAL CONTEXT: She has NOT left the stage. She is already performing. Do NOT say she is "coming back", "returning to the stage", "back up on the stage", or anything implying she left. She is STILL THERE dancing.

STRUCTURE — keep it very short and punchy:
1. Quick hype line — acknowledge the continuation
2. Land her name
Do NOT mention VIP, private dances, or buying drinks during round continuations.

GOOD EXAMPLES (match this energy, create original lines):
"${roundLabel} gentlemen. Let's keep it going one more time for ${displayName}."
"We're not done yet. Giving you more of the beautiful ${displayName}."
"${roundLabel} boys. Keep those dollars coming for ${displayName}."
"She's still going gentlemen. ${roundLabel} with ${displayName}."

BAD EXAMPLES (NEVER do this):
"Coming back to the stage..." — WRONG, she never left
"Back up on the main stage..." — WRONG, she's already there
"Let's welcome back..." — WRONG, she didn't leave

Output should be 1-2 sentences MAX. Keep it tight and simple. ${isGeneric ? 'Do not use a specific name.' : `Her name is ${displayName} — use it.`}`;

  } else if (type === 'outro') {
    eventInstructions = `EVENT: STAGE EXIT

The performer ${displayName} has finished her main stage set.${genericNote}

STRUCTURE — wrap it up and drive VIP:
1. Signal her set is done
2. Compliment her / tell crowd to show love
3. Push VIP / one-on-one / private dances — this is the upsell moment
4. Land her name naturally

EXAMPLE (match this energy, create original lines):
"Well gentlemen that's all the time you get with the amazing ${displayName}. She's finishing up her main stage and now available for some one-on-one VIP time."
"Show some love for the beautiful ${displayName}. Don't let her walk away lonely gentlemen. She's available for that private VIP experience."
"One more time make some noise for ${displayName}. Main stage is done but your chance for a private dance is just getting started."

Output should be 2-4 sentences. ${isGeneric ? 'Do not use a specific name.' : `Her name is ${displayName} — use it.`}`;

  } else if (type === 'transition') {
    const nextName = isGeneric ? 'the next entertainer' : (nextDancerName || 'the next performer');
    const outgoingRef = isGeneric ? 'She' : dancerName;
    eventInstructions = `EVENT: STAGE TRANSITION
Today is ${dayOfWeek}.

The performer ${displayName} has finished. The next performer ${nextName} is coming up.${genericNote}

STRUCTURE — thank outgoing, hype incoming:
1. Quick thank you / love for the outgoing dancer (NO VIP or private dance mentions — save that for her outro)
2. Transition phrase — keep the energy rolling
3. Build up the incoming dancer
4. Land the incoming dancer's name

NAME REPETITION RULE: ${isGeneric ? 'Use generic references throughout.' : `Say the INCOMING dancer's name ("${nextName}") 2-3 times, spaced naturally throughout the hype-up portion. The outgoing dancer's name ("${outgoingRef}") only needs to be said once. In a loud club people need to hear the new name more than once.`}

EXAMPLE (match this energy, create original lines):
"One more time for the lovely ${outgoingRef}. Now let's fire up the main stage for ${nextName}. That's right gentlemen it's back to back. Get those dollars ready for the one and only ${nextName}."
"Show some love for ${outgoingRef} gentlemen. Right about now ${nextName} is coming to the stage. Get your cash out because ${nextName} is about to make it happen."

Output should be 3-5 sentences. Rhyming and wordplay encouraged if natural (e.g. "doing it right on a ${dayOfWeek} night"). ${isGeneric ? 'Do not use a specific name.' : `Say ${nextName} 2-3 times, spaced out naturally.`}`;
  }

  const shiftBlock = `TONE DIRECTION (internal guidance only — NEVER say these words out loud):
Your tone should be: ${shift.tone}
Your confidence level should be: ${shift.confidence}
CRITICAL: Do NOT reference the time of night, shift, energy level, or any internal labels in the spoken announcement. Just let the tone come through naturally in how you speak.`;

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
