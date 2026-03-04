import { getApiConfig } from '@/components/apiConfig';
import { localIntegrations } from '@/api/localEntities';
import { trackOpenAICall, estimateTokens } from '@/utils/apiCostTracker';

const VIBE_STYLES = {
  hype: {
    tone: 'HIGH ENERGY, explosive, commanding, aggressive',
    chaos: 'maximum — rapid-fire hits, staccato delivery, dramatic pauses between punches',
    escalation: 'start at 8/10 energy, peak at 11/10, never drop below 7',
  },
  party: {
    tone: 'FUN, exciting, inviting, celebratory, infectious',
    chaos: 'high — bouncy rhythm, playful callbacks, building momentum',
    escalation: 'start at 6/10, build steadily to 9/10, land with a bang',
  },
  classy: {
    tone: 'SOPHISTICATED, smooth, exclusive, magnetic, premium',
    chaos: 'controlled — confident pacing, deliberate pauses, velvet authority',
    escalation: 'start at 5/10, build to 7/10, peak briefly at 8/10 on CTA',
  },
  chill: {
    tone: 'RELAXED, cool, laid-back, welcoming, effortless',
    chaos: 'low — conversational flow, warm phrasing, easy rhythm',
    escalation: 'start at 4/10, drift to 6/10, gentle landing',
  },
};

const RUNTIME_MODES = {
  '15': {
    name: 'Short Burst',
    range: '15-25 sec',
    wordCount: '35-55',
    sections: `FIRST IMPACT (rapid attention grab — 1-2 punchy lines)
INFO DROP (compressed — event name, date, venue in ONE explosive sentence)
CTA + HARD OUT (urgent call to action, venue name, done)`,
    pacing: 'Cut ALL filler words. Compress info delivery. Maximum chaos density — rapid hits, quick stingers. Every word earns its spot.',
  },
  '30': {
    name: 'Standard Spot',
    range: '30-45 sec',
    wordCount: '65-90',
    sections: `FIRST IMPACT (2-6 sec read time — attention grab, one punchy hook)
BUILD (5-15 sec — event name drop, begin info reveal, rising energy)
INFO DROP (5-15 sec — date, time, venue, specials woven naturally)
PEAK ESCALATION (3-8 sec — energy climax, urgency spike)
CTA + HARD OUT (3-8 sec — call to action, venue name, landing)`,
    pacing: 'High chaos density. Short punchy sentences. Dramatic pauses between sections. Build energy like a track — never flat.',
  },
  '60': {
    name: 'Extended Hype',
    range: '45-75 sec',
    wordCount: '120-165',
    sections: `FIRST IMPACT (2-6 sec read time — hook that stops you cold)
BUILD (5-20 sec — scene setting, event name drop, atmosphere building)
INFO CLUSTER (5-25 sec — date, time, venue, drink specials, dress code — woven naturally, not listed)
PEAK ESCALATION (3-10 sec — energy climax, tension build, dramatic pause before CTA)
CTA (3-8 sec — urgent call to action)
HARD OUT (2-6 sec — venue name, final punch, clean exit)`,
    pacing: 'Chaos density rises gradually toward peak. More dynamic variation — add tension phases and fake drops. Avoid stretching sentences artificially. Sustained yelling = listener fatigue, so vary intensity.',
  },
};

function buildPromoPrompt(eventDetails) {
  const { eventName, date, time, venue, details, vibe, duration } = eventDetails;
  const vibeStyle = VIBE_STYLES[vibe] || VIBE_STYLES.party;
  const runtime = RUNTIME_MODES[duration] || RUNTIME_MODES['30'];

  return `You are a veteran radio imaging producer. You write promos that sound like TRACKS, not ads. Every promo has an energy arc — it builds, peaks, and lands like a song.

EVENT DETAILS:
- Event: ${eventName}
- Date: ${date}${time ? `\n- Time: ${time}` : ''}
- Venue: ${venue}
${details ? `- Details: ${details}` : ''}

RUNTIME MODE: ${runtime.name} (${runtime.range})
TARGET WORD COUNT: ${runtime.wordCount} words

TONE & ENERGY: ${vibeStyle.tone}
CHAOS DENSITY: ${vibeStyle.chaos}
ENERGY ARC: ${vibeStyle.escalation}

TRACK STRUCTURE — write the script following these sections (the voice reads over music that's already playing):

${runtime.sections}

PACING RULES:
${runtime.pacing}

PRODUCTION RULES:
1. Write EXACTLY ${runtime.wordCount} words — this is precision radio production
2. Design it like a TRACK with dynamic sections, not a flat read
3. The VENUE NAME must appear at least 2-3 times, woven naturally
4. The EVENT NAME must appear at least 2 times
5. DATE and TIME must be included naturally (not "on the date of...")
6. Think in ENERGY ARCS — start strong, build tension, peak, land clean
7. Write how a radio DJ SPEAKS — conversational but dramatic, rhythmic but natural
8. Use periods and ellipses for natural breath points and dramatic pauses
9. Short sentences HIT HARDER. Use them at peaks
10. Longer flowing sentences work for builds. Use them to create momentum
11. Do NOT use hashtags, emojis, stage directions, or sound effect descriptions
12. Do NOT label sections — output ONLY the spoken script text, no formatting
13. The music is already playing underneath — your words ride on top of it

Write the promo script now:`;
}

export async function generatePromoScript(eventDetails) {
  const config = getApiConfig();
  const prompt = buildPromoPrompt(eventDetails);

  const openaiKey = config.openaiApiKey || '';
  const scriptModel = config.scriptModel || 'auto';

  if (openaiKey && scriptModel !== 'auto') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: scriptModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
        frequency_penalty: 0.6,
        presence_penalty: 0.4,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const usage = data.usage;
    trackOpenAICall({
      model: scriptModel,
      promptTokens: usage?.prompt_tokens || estimateTokens(prompt),
      completionTokens: usage?.completion_tokens || estimateTokens(data.choices?.[0]?.message?.content || ''),
      context: 'promo-script',
    });
    const text = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
    return text.trim().replace(/^["']|["']$/g, '');
  }

  if (typeof localIntegrations?.Core?.InvokeLLM === 'function') {
    const response = await localIntegrations.Core.InvokeLLM({ prompt });
    const text = typeof response === 'string' ? response : response?.choices?.[0]?.message?.content || '';
    return text.trim().replace(/^["']|["']$/g, '');
  }

  throw new Error('No AI service configured. Please set an OpenAI API key in Settings.');
}

export { VIBE_STYLES };
