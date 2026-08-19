/**
 * NEON AI DJ — POS Integration SANDBOX
 *
 * This is a hosted, self-contained emulator of the POS endpoints that run on a
 * real DJ unit. It keeps an in-memory fake roster and mirrors the exact request
 * and response shapes documented in POS-INTEGRATION.md, including idempotency
 * behavior. No real venue data, music, or voice services are involved.
 *
 * State resets whenever the sandbox instance restarts (and may reset between
 * requests on autoscale after idle periods) — that's expected for a sandbox.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";

const router: Router = Router();

// ---------------------------------------------------------------------------
// Sandbox key — intentionally fixed and public so POS developers can test.
// Real units each generate their own private key.
// ---------------------------------------------------------------------------
const SANDBOX_KEY = "pos_sandbox_9f3c2e7d41b8a6f0c5d2e9a17b4f8c3d6e0a5b9c2f7d4e1a";

// ---------------------------------------------------------------------------
// Fake roster + state
// ---------------------------------------------------------------------------
interface Entertainer {
  id: string;
  name: string;
}

const ROSTER: Entertainer[] = [
  { id: "sandbox-001", name: "Amber" },
  { id: "sandbox-002", name: "Brooke" },
  { id: "sandbox-003", name: "Crystal" },
  { id: "sandbox-004", name: "Destiny" },
  { id: "sandbox-005", name: "Emerald" },
  { id: "sandbox-006", name: "Faith" },
];

// checked-in girls in rotation order; VIP set
const rotation: string[] = []; // entertainer ids
const vip = new Set<string>(); // entertainer ids
let commandCounter = 0;
const eventLog: Array<{ time: string; event: string; name: string }> = [];

function nextCommandId(): number {
  commandCounter += 1;
  return commandCounter;
}

function logEvent(event: string, name: string) {
  eventLog.push({ time: new Date().toISOString(), event, name });
  if (eventLog.length > 200) eventLog.shift();
}

// ---------------------------------------------------------------------------
// Auth — same timing-safe scheme as real units
// ---------------------------------------------------------------------------
function requireSandboxKey(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("X-API-Key");
  if (!provided || typeof provided !== "string" || provided.length > 256) {
    res.status(401).json({ error: "Invalid or missing X-API-Key header" });
    return;
  }
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(SANDBOX_KEY).digest();
  if (!timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Invalid or missing X-API-Key header" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Entertainer resolution — same semantics as real units
// ---------------------------------------------------------------------------
function resolveEntertainer(req: Request, res: Response): Entertainer | null {
  const body = (req.body ?? {}) as { entertainerId?: unknown; name?: unknown };
  const { entertainerId, name } = body;
  if (!entertainerId && !name) {
    res.status(400).json({
      error: "Request body must include entertainerId or name",
    });
    return null;
  }
  let match: Entertainer | undefined;
  if (entertainerId && typeof entertainerId === "string") {
    match = ROSTER.find((e) => e.id === entertainerId);
  } else if (name && typeof name === "string") {
    const lower = name.trim().toLowerCase();
    match = ROSTER.find((e) => e.name.toLowerCase() === lower);
  }
  if (!match) {
    res.status(404).json({
      error:
        "Entertainer not found. Use GET /api/pos/entertainers to list the current roster (sandbox roster is fixed).",
    });
    return null;
  }
  return match;
}

// ---------------------------------------------------------------------------
// Health (deployment health check + POS health endpoint)
// ---------------------------------------------------------------------------
router.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

router.get("/pos/health", (_req, res) => {
  res.json({
    ok: true,
    service: "NEON AI DJ",
    unit: "sandbox",
    sandbox: true,
    time: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------
router.get("/pos/entertainers", requireSandboxKey, (_req, res) => {
  res.json({ entertainers: ROSTER.map(({ id, name }) => ({ id, name })) });
});

// ---------------------------------------------------------------------------
// The four signals — mirror real-unit idempotency exactly
// ---------------------------------------------------------------------------
router.post("/pos/checkin", requireSandboxKey, (req, res) => {
  const ent = resolveEntertainer(req, res);
  if (!ent) return;
  const commandIds = [nextCommandId()];
  if (!rotation.includes(ent.id) && !vip.has(ent.id)) {
    rotation.push(ent.id);
  }
  logEvent("checkin", ent.name);
  res.json({ ok: true, event: "checkin", entertainerId: ent.id, name: ent.name, commandIds });
});

router.post("/pos/vip-start", requireSandboxKey, (req, res) => {
  const ent = resolveEntertainer(req, res);
  if (!ent) return;
  const commandIds = [nextCommandId()];
  if (!vip.has(ent.id)) {
    // real unit: if she's on stage this becomes a pending VIP until her set ends
    const idx = rotation.indexOf(ent.id);
    if (idx !== -1) rotation.splice(idx, 1);
    vip.add(ent.id);
  }
  // repeated vip-start while already in VIP is a no-op (skipIfActive)
  logEvent("vip-start", ent.name);
  res.json({ ok: true, event: "vip-start", entertainerId: ent.id, name: ent.name, commandIds });
});

router.post("/pos/vip-end", requireSandboxKey, (req, res) => {
  const ent = resolveEntertainer(req, res);
  if (!ent) return;
  const commandIds = [nextCommandId()];
  if (vip.has(ent.id)) {
    vip.delete(ent.id);
    if (!rotation.includes(ent.id)) rotation.push(ent.id); // rejoins at the bottom
  }
  // vip-end for someone not in VIP is a no-op (onlyIfVip)
  logEvent("vip-end", ent.name);
  res.json({ ok: true, event: "vip-end", entertainerId: ent.id, name: ent.name, commandIds });
});

router.post("/pos/checkout", requireSandboxKey, (req, res) => {
  const ent = resolveEntertainer(req, res);
  if (!ent) return;
  const commandIds = [nextCommandId(), nextCommandId()]; // releaseFromVip + remove
  vip.delete(ent.id);
  const idx = rotation.indexOf(ent.id);
  if (idx !== -1) rotation.splice(idx, 1);
  logEvent("checkout", ent.name);
  res.json({ ok: true, event: "checkout", entertainerId: ent.id, name: ent.name, commandIds });
});

// ---------------------------------------------------------------------------
// SANDBOX-ONLY: observe the effect of your signals (not on real units)
// ---------------------------------------------------------------------------
router.get("/pos/state", requireSandboxKey, (_req, res) => {
  const byId = new Map(ROSTER.map((e) => [e.id, e.name]));
  res.json({
    sandbox: true,
    rotation: rotation.map((id) => ({ id, name: byId.get(id) })),
    vip: [...vip].map((id) => ({ id, name: byId.get(id) })),
    recentEvents: eventLog.slice(-20),
    note: "Sandbox-only endpoint. Real units do not expose /api/pos/state.",
  });
});

// ---------------------------------------------------------------------------
// SANDBOX-ONLY: a human-friendly console for POS developers. The production
// integration is API-to-API, but this removes the ambiguity of an empty DJ UI
// when a developer opens the sandbox URL in a browser.
// ---------------------------------------------------------------------------
router.get("/pos/sandbox", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NEON AI DJ — POS Sandbox</title>
  <style>
    :root { color-scheme: dark; --ink:#f6f7ff; --muted:#aeb3c8; --line:#2b3045; --panel:#151a2d; --accent:#a5ff26; --pink:#ff4ecd; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:#0a0c16; color:var(--ink); font:16px/1.5 Inter,ui-sans-serif,system-ui,sans-serif; }
    main { max-width:1020px; margin:0 auto; padding:52px 24px 72px; }
    .eyebrow { color:var(--accent); font-weight:800; font-size:.76rem; letter-spacing:.16em; }
    h1 { font-size:clamp(2rem,6vw,4.25rem); line-height:1; margin:.35rem 0 1rem; letter-spacing:-.055em; }
    .lede { color:var(--muted); max-width:720px; font-size:1.08rem; }
    .notice { margin:28px 0; padding:18px 20px; border-left:4px solid var(--accent); background:#131c19; border-radius:0 12px 12px 0; }
    .grid { display:grid; grid-template-columns:1.05fr .95fr; gap:18px; margin-top:28px; }
    .card { border:1px solid var(--line); background:var(--panel); border-radius:16px; padding:22px; }
    h2 { margin:0 0 8px; font-size:1.15rem; }
    p { margin:8px 0; } code { color:#d6fba2; overflow-wrap:anywhere; }
    .key { display:flex; gap:8px; padding:12px; margin:14px 0; background:#090b14; border:1px solid var(--line); border-radius:10px; }
    .key code { flex:1; font-size:.78rem; }
    button { cursor:pointer; appearance:none; border:1px solid #3e5063; color:var(--ink); background:#222a44; font:inherit; font-weight:750; border-radius:9px; padding:9px 12px; }
    button:hover { border-color:var(--accent); } .primary { background:var(--accent); color:#081000; border-color:var(--accent); }
    .roster { display:grid; gap:9px; margin-top:15px; }
    .person { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px; background:#0d1020; border:1px solid var(--line); border-radius:10px; }
    .person small { display:block; color:var(--muted); font-family:monospace; }
    .actions { display:flex; flex-wrap:wrap; gap:7px; justify-content:flex-end; }
    .actions button { padding:6px 8px; font-size:.76rem; }
    pre { min-height:190px; margin:14px 0 0; padding:14px; overflow:auto; white-space:pre-wrap; background:#090b14; border:1px solid var(--line); border-radius:10px; color:#cbd1e8; font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }
    .foot { margin-top:30px; color:var(--muted); font-size:.86rem; }
    @media(max-width:760px) { main { padding-top:34px; } .grid { grid-template-columns:1fr; } .person { align-items:flex-start; flex-direction:column; } .actions { justify-content:flex-start; } }
  </style>
</head>
<body>
<main>
  <div class="eyebrow">NEON AI DJ · DEVELOPER SANDBOX</div>
  <h1>POS integration<br>test console.</h1>
  <p class="lede">This is a safe, fake DJ unit for POS developers. Use it to test the four background signals your POS will send in production. There is no music or real venue data here.</p>
  <div class="notice"><strong>This is the screen you were looking for.</strong><br />The POS connection is an API, not the DJ booth display. Your system should send HTTPS requests to <code>/api/pos/…</code>; the controls below simply let you test the same messages by hand.</div>
  <div class="grid">
    <section class="card">
      <h2>Sandbox connection</h2>
      <p>Base API URL: <code id="base"></code></p>
      <p>Test API key (sandbox only):</p>
      <div class="key"><code id="key"></code><button onclick="copyKey()">Copy</button></div>
      <p><button class="primary" onclick="callApi('state')">Refresh sandbox state</button></p>
      <h2 style="margin-top:22px">Response / current state</h2>
      <pre id="output">Click “Refresh sandbox state” or try a signal.</pre>
    </section>
    <section class="card">
      <h2>Fake test roster</h2>
      <p>These six names are for sandbox testing only. Click a signal to see its API response.</p>
      <div class="roster" id="roster"></div>
    </section>
  </div>
  <p class="foot">Production uses each venue's local DJ-unit address and a private per-unit key. The <code>/api/pos/state</code> display is sandbox-only.</p>
</main>
<script>
  const key = ${JSON.stringify(SANDBOX_KEY)};
  const api = location.origin + '/api/pos';
  const roster = ${JSON.stringify(ROSTER)};
  document.getElementById('key').textContent = key;
  document.getElementById('base').textContent = api;
  document.getElementById('roster').innerHTML = roster.map(e => '<div class="person"><span><strong>' + e.name + '</strong><small>' + e.id + '</small></span><span class="actions"><button onclick="callApi(\\'checkin\\',\\'' + e.id + '\\')">Check in</button><button onclick="callApi(\\'vip-start\\',\\'' + e.id + '\\')">VIP start</button><button onclick="callApi(\\'vip-end\\',\\'' + e.id + '\\')">VIP end</button><button onclick="callApi(\\'checkout\\',\\'' + e.id + '\\')">Checkout</button></span></div>').join('');
  async function callApi(action, entertainerId) {
    const out = document.getElementById('output');
    out.textContent = 'Calling ' + action + '…';
    try {
      const options = { headers: { 'X-API-Key': key } };
      if (action !== 'state') { options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ entertainerId }); }
      const response = await fetch(api + '/' + action, options);
      out.textContent = 'HTTP ' + response.status + '\\n\\n' + JSON.stringify(await response.json(), null, 2);
    } catch (error) { out.textContent = 'Request failed: ' + error.message; }
  }
  function copyKey() { navigator.clipboard.writeText(key); event.target.textContent = 'Copied'; setTimeout(() => event.target.textContent = 'Copy', 1200); }
</script>
</body></html>`);
});

export default router;
