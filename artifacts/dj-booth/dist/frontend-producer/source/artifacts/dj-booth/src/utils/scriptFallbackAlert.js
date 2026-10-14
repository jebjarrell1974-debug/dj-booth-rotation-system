// Loud reporting for announcement-script fallback to canned scripts.
//
// Background: in ~June 2026 the OpenAI key silently vanished and the fleet ran
// for WEEKS on canned scripts + cached voiceovers with zero notification.
// Script-generation fallback must never be silent again.
//
// This module is the ONE place fallback is reported from (localEntities
// InvokeLLM + AnnouncementSystem direct-OpenAI path). It dispatches a window
// event that DJBooth turns into a diag entry; the diag log rides the booth
// state → fleet heartbeat → homebase fleet-monitor pipeline, which sends the
// Telegram alert (same channel as LOW CACHE RATE alerts).
//
// Rate limiting: once per reason per browser session (sessionStorage-backed so
// component remounts don't re-fire). The homebase monitor adds its own
// per-device cooldown on top.

const SESSION_KEY_PREFIX = 'djbooth_script_fallback_sent_';
const sentThisLoad = new Set();

export const SCRIPT_FALLBACK_REASONS = {
  NO_KEY: 'no_key',        // OpenAI key missing → canned script pool
  API_ERROR: 'api_error',  // OpenAI call failed (401/429/timeout/…) → fallback
};

export function reportScriptFallback(reason, detail = '') {
  try {
    if (sentThisLoad.has(reason)) return;
    try {
      if (sessionStorage.getItem(SESSION_KEY_PREFIX + reason)) {
        sentThisLoad.add(reason);
        return;
      }
      sessionStorage.setItem(SESSION_KEY_PREFIX + reason, String(Date.now()));
    } catch {}
    sentThisLoad.add(reason);
    console.warn(`🚨 Script generation fell back to canned scripts (${reason})${detail ? `: ${detail}` : ''}`);
    window.dispatchEvent(new CustomEvent('djbooth-script-fallback', {
      detail: { reason, detail: String(detail || '').substring(0, 160) },
    }));
  } catch {}
}
