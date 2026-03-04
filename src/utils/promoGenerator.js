import { getApiConfig } from '@/components/apiConfig';
import { localIntegrations } from '@/api/localEntities';

const VIBE_STYLES = {
  hype: {
    tone: 'HIGH ENERGY, explosive, commanding',
    musicDesc: 'hard-hitting, bass-heavy, trap or hip-hop instrumental',
    pacing: 'fast, punchy, short sentences with dramatic pauses',
  },
  party: {
    tone: 'FUN, exciting, inviting, celebratory',
    musicDesc: 'upbeat dance, EDM, or pop instrumental',
    pacing: 'energetic and flowing, building excitement',
  },
  classy: {
    tone: 'SOPHISTICATED, smooth, exclusive, upscale',
    musicDesc: 'smooth R&B, jazz-influenced, or lounge instrumental',
    pacing: 'measured, confident, with elegant pauses',
  },
  chill: {
    tone: 'RELAXED, cool, laid-back, welcoming',
    musicDesc: 'mellow, lo-fi, or smooth instrumental',
    pacing: 'easy-going, conversational, warm',
  },
};

function buildPromoPrompt(eventDetails) {
  const { eventName, date, time, venue, details, vibe, duration } = eventDetails;
  const vibeStyle = VIBE_STYLES[vibe] || VIBE_STYLES.party;
  const wordCount = duration === '30' ? '60-80' : '120-150';
  const spotLength = duration === '30' ? '30-second' : '60-second';

  return `You are a professional radio imaging copywriter. Write a ${spotLength} radio promo spot.

EVENT DETAILS:
- Event: ${eventName}
- Date: ${date}
- Time: ${time}
- Venue: ${venue}
${details ? `- Details: ${details}` : ''}

STYLE & TONE: ${vibeStyle.tone}
PACING: ${vibeStyle.pacing}

RULES:
1. Write ${wordCount} words — this is a ${spotLength} radio spot
2. Use SHORT, PUNCHY sentences — this is radio, not a novel
3. Repeat the VENUE NAME at least 2-3 times naturally
4. Repeat the EVENT NAME at least 2 times
5. Include a CALL TO ACTION (be there, don't miss it, pull up, etc.)
6. Include the DATE and TIME naturally woven in
7. Build energy — start strong, build to a peak, land the ending
8. Write like a real radio DJ reads a promo — conversational but dramatic
9. Use natural pauses with periods and ellipses
10. Do NOT use hashtags, emojis, or social media language
11. Do NOT include sound effect descriptions or stage directions
12. Output ONLY the script text — no labels, no quotes, no formatting

EXAMPLE STRUCTURE (${spotLength}):
[Attention grab] → [Event name drop] → [Details/specials] → [Date & time] → [Venue name] → [Call to action] → [Venue name + landing]

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
        temperature: 0.85,
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        max_tokens: 400,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI ${res.status}: ${errText}`);
    }
    const data = await res.json();
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
