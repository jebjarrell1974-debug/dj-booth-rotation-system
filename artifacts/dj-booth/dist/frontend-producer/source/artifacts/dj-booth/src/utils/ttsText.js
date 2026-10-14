// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL text-prep for EVERY ElevenLabs TTS call in the app. This is LAW.
//
// THE VIP RULE: "VIP" must ALWAYS be spoken as the letters V.I.P. — never the
// word "vip". This is the #1 product callout in the venues. Every code path that
// sends text to ElevenLabs (dancer intros, house announcements, manual/promo
// announcements, remote promos, feature intros/outros) MUST run its script
// through prepareTTSText() before sending. Do NOT inline a private copy of this
// logic in any component — import it from here so the paths can never drift.
//
// (History: the VIP fix originally lived only in AnnouncementSystem.jsx, so house
// and manual/promo announcements — exactly where "VIP room" is said — still read
// "vip" as a word. This module exists so that can never happen again.)
// ─────────────────────────────────────────────────────────────────────────────

// Acronyms that must be spelled out letter-by-letter (e.g. V.I.P., D.J.).
// NOTE: brand/venue names like "XTC" are deliberately NOT here — they should be
// spoken as a word, which the all-caps normalizer handles by title-casing them.
export const SPELL_OUT = new Set(['VIP', 'DJ', 'MC', 'ATM', 'ID', 'VR', 'TV', 'AC', 'DC', 'OK', 'UV']);

export function prepareTTSText(script, pronunciationMap = {}) {
  let ttsText = String(script || '');

  // ── HARDWIRED VIP RULE — the voice must NEVER pronounce "vip" as a word ──────
  // Runs FIRST and is intentionally broad: every casing (vip / Vip / VIP) AND
  // every trailing form — singular, plain plural (vips / VIPs), and possessive
  // with a straight OR curly apostrophe (vip's / VIP's).
  ttsText = ttsText.replace(
    /\bvip(['\u2019]?s)?\b/gi,
    (_m, suffix) => 'V.I.P.' + (suffix || '')
  );

  // Spell out the rest of the SPELL_OUT acronyms, case-insensitive.
  for (const acronym of SPELL_OUT) {
    const spelled = acronym.split('').join('.') + '.';
    ttsText = ttsText.replace(
      new RegExp(`\\b${acronym}('[Ss])?\\b`, 'gi'),
      (_m, suffix) => spelled + (suffix || '')
    );
  }

  // All-caps pass: spell out any SPELL_OUT entry not yet caught; title-case every
  // other all-caps word (USA → Usa, XTC → Xtc) so ElevenLabs speaks it as a word
  // instead of shouting individual letters.
  ttsText = ttsText.replace(/\b([A-Z]{2,}(?:'[Ss])?)\b/g, (match) => {
    const base = match.replace(/'[Ss]$/, '');
    const suffix = match.slice(base.length);
    if (SPELL_OUT.has(base)) return base.split('').join('.') + '.' + suffix;
    return base.charAt(0) + base.slice(1).toLowerCase() + suffix;
  });

  // Phonetic name substitutions last (so spelled-out forms above aren't clobbered).
  for (const [name, phonetic] of Object.entries(pronunciationMap)) {
    if (!name) continue;
    ttsText = ttsText.replace(new RegExp(`\\b${name}\\b`, 'gi'), phonetic);
  }

  return ttsText;
}
