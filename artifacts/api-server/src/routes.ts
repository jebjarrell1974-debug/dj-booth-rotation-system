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
const checkedOut = new Set<string>(); // sandbox-only durable status for the visual demo
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
  checkedOut.delete(ent.id);
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
  checkedOut.add(ent.id);
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
    checkedOut: [...checkedOut].map((id) => ({ id, name: byId.get(id) })),
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

// ---------------------------------------------------------------------------
// SANDBOX-ONLY: passive visual demo. This is intentionally a generic operations
// simulator rather than a copy of the DJ booth. It never controls production
// equipment and only reflects fake sandbox events sent by a developer's client.
// ---------------------------------------------------------------------------
router.get("/pos/demo", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SignalFlow — Event Simulator</title>
  <style>
    :root { --page:#f4f6fa; --ink:#172033; --muted:#667085; --line:#d9e0ea; --panel:#fff; --navy:#1d3157; --blue:#3266d6; --teal:#008c8a; --teal-soft:#e0f6f4; --gold:#b77000; --gold-soft:#fff2d6; --rose:#b53d61; --rose-soft:#ffedf1; --grey-soft:#eef2f7; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:var(--page); color:var(--ink); font:15px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    header { background:var(--navy); color:#fff; padding:20px clamp(20px,5vw,70px); display:flex; justify-content:space-between; align-items:center; gap:20px; }
    .brand { display:flex; align-items:center; gap:12px; font-weight:800; letter-spacing:.02em; }
    .brand-mark { width:28px; height:28px; border:3px solid #80d9d5; border-radius:50%; position:relative; }
    .brand-mark:after { content:""; width:7px; height:7px; background:#80d9d5; border-radius:50%; position:absolute; inset:0; margin:auto; }
    .sub { color:#b8c5db; font-size:.86rem; }
    .connection { display:flex; align-items:center; gap:8px; color:#d9e4f5; font-size:.84rem; white-space:nowrap; }
    .dot { width:9px; height:9px; border-radius:50%; background:#73d4a8; box-shadow:0 0 0 4px rgba(115,212,168,.16); }
    main { max-width:1380px; margin:0 auto; padding:34px clamp(20px,5vw,70px) 60px; }
    .intro { display:flex; align-items:flex-start; justify-content:space-between; gap:30px; margin-bottom:27px; }
    h1 { margin:0 0 6px; color:var(--navy); font-size:clamp(1.7rem,3vw,2.6rem); letter-spacing:-.04em; line-height:1.1; }
    .intro p { margin:0; color:var(--muted); max-width:760px; }
    .badge { border:1px solid #9db3da; color:var(--blue); background:#edf3ff; padding:7px 10px; border-radius:5px; font-size:.75rem; font-weight:800; text-transform:uppercase; letter-spacing:.08em; white-space:nowrap; }
    .notice { border:1px solid #bddbe5; background:#eaf7fb; color:#245263; padding:13px 16px; border-radius:7px; margin-bottom:24px; font-size:.9rem; }
    .notice strong { color:#163d50; }
    .board { display:grid; grid-template-columns:1.04fr 1.25fr 1.04fr .92fr; gap:15px; align-items:start; }
    .lane { background:var(--panel); border:1px solid var(--line); border-radius:10px; min-height:390px; overflow:hidden; }
    .lane-head { padding:15px 16px 13px; border-bottom:1px solid var(--line); display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .lane-title { display:flex; align-items:center; gap:9px; font-weight:800; color:var(--navy); }
    .lane-icon { width:9px; height:9px; border-radius:50%; background:var(--blue); } .lane.vip .lane-icon { background:var(--gold); } .lane.done .lane-icon { background:var(--rose); } .lane.waiting .lane-icon { background:#8795aa; }
    .count { min-width:24px; padding:2px 7px; background:var(--grey-soft); color:var(--muted); border-radius:99px; text-align:center; font-size:.78rem; font-weight:800; }
    .lane-copy { margin:0; padding:10px 16px; color:var(--muted); font-size:.78rem; border-bottom:1px solid var(--line); min-height:52px; }
    .cards { padding:10px; display:grid; gap:9px; }
    .card { padding:12px; border:1px solid var(--line); border-left:4px solid var(--blue); background:#fff; border-radius:6px; display:flex; align-items:center; justify-content:space-between; gap:10px; animation:enter .28s ease-out; }
    .vip .card { border-left-color:var(--gold); background:#fffbf2; } .done .card { border-left-color:var(--rose); background:#fff7f9; } .waiting .card { border-left-color:#a9b4c3; background:#fafbfd; }
    .card-name { font-weight:800; } .card-id { display:block; color:var(--muted); font:11px ui-monospace,SFMono-Regular,Menlo,monospace; margin-top:2px; }
    .tag { padding:3px 7px; border-radius:4px; color:var(--blue); background:#edf3ff; font-size:.68rem; font-weight:800; text-transform:uppercase; letter-spacing:.04em; } .vip .tag { color:#986000; background:var(--gold-soft); } .done .tag { color:var(--rose); background:var(--rose-soft); } .waiting .tag { color:#667085; background:var(--grey-soft); }
    .empty { padding:30px 15px; text-align:center; color:#8a96a8; font-size:.85rem; }
    .activity { margin-top:23px; display:grid; grid-template-columns:minmax(0,1fr) 240px; gap:15px; }
    .activity-card, .how { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:17px; }
    h2 { margin:0 0 10px; color:var(--navy); font-size:1rem; } .how p, .activity-card p { color:var(--muted); font-size:.84rem; margin:0 0 11px; }
    .events { display:grid; gap:7px; max-height:190px; overflow:auto; }
    .event { display:grid; grid-template-columns:91px 1fr auto; align-items:center; gap:10px; padding:9px 0; border-top:1px solid #edf0f4; font-size:.85rem; } .event:first-child { border-top:0; }
    .event-type { color:var(--blue); font-weight:800; } .event-time { color:#8a96a8; font-size:.75rem; }
    code { background:#f2f4f8; color:#364152; padding:2px 4px; border-radius:3px; font-size:.82em; overflow-wrap:anywhere; }
    .last { color:var(--muted); font-size:.75rem; text-align:right; margin-top:9px; }
    @keyframes enter { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:none; } }
    @media(max-width:1040px) { .board { grid-template-columns:repeat(2, minmax(0,1fr)); } .lane { min-height:280px; } }
    @media(max-width:620px) { header, .intro { align-items:flex-start; flex-direction:column; } .board, .activity { grid-template-columns:1fr; } main { padding-top:25px; } .event { grid-template-columns:76px 1fr; } .event-time { display:none; } }
  </style>
</head>
<body>
  <header>
    <div class="brand"><span class="brand-mark"></span>SignalFlow <span class="sub">/ sandbox simulator</span></div>
    <div class="connection"><span class="dot" id="dot"></span><span id="connection">Connecting to sandbox…</span></div>
  </header>
  <main>
    <div class="intro">
      <div><h1>Event status board</h1><p>Fake people and fake workflow data for POS integration demonstrations. This display reads the sandbox only; it cannot access, control, or reveal any live operating system.</p></div>
      <div class="badge">Demo environment</div>
    </div>
    <div class="notice"><strong>How this works:</strong> Send your normal sandbox API events from your POS client. This board refreshes automatically and reflects the resulting fake status changes. It is not a DJ interface and contains no music, venue, customer, or real-person data.</div>
    <section class="board" aria-label="Fake sandbox event workflow">
      <article class="lane waiting"><div class="lane-head"><div class="lane-title"><span class="lane-icon"></span>Available</div><span class="count" id="waiting-count">0</span></div><p class="lane-copy">Fake records ready for a check-in signal.</p><div class="cards" id="waiting"></div></article>
      <article class="lane"><div class="lane-head"><div class="lane-title"><span class="lane-icon"></span>Active queue</div><span class="count" id="queue-count">0</span></div><p class="lane-copy">Check-in places a fake record in this workflow queue.</p><div class="cards" id="queue"></div></article>
      <article class="lane vip"><div class="lane-head"><div class="lane-title"><span class="lane-icon"></span>Priority session</div><span class="count" id="vip-count">0</span></div><p class="lane-copy">VIP start moves a record here until VIP end arrives.</p><div class="cards" id="vip"></div></article>
      <article class="lane done"><div class="lane-head"><div class="lane-title"><span class="lane-icon"></span>Checked out</div><span class="count" id="done-count">0</span></div><p class="lane-copy">Records removed by a checkout signal during this demo session.</p><div class="cards" id="done"></div></article>
    </section>
    <section class="activity">
      <div class="activity-card"><h2>Recent sandbox events</h2><p>Latest messages received by the sandbox.</p><div class="events" id="events"><div class="empty">Waiting for an API event…</div></div><div class="last" id="last">Auto-refreshing every 2 seconds</div></div>
      <aside class="how"><h2>For POS developers</h2><p>Use the same API contract you tested in the developer console.</p><p>Send <code>checkin</code>, <code>vip-start</code>, <code>vip-end</code>, or <code>checkout</code> to the sandbox. This board is display-only.</p><p><a href="/api/pos/sandbox">Open API test console →</a></p></aside>
    </section>
  </main>
  <script>
    const key = ${JSON.stringify(SANDBOX_KEY)};
    const api = location.origin + '/api/pos';
    const roster = ${JSON.stringify(ROSTER)};
    const byId = Object.fromEntries(roster.map(function (person) { return [person.id, person]; }));
    function card(person, status) {
      return '<div class="card"><span><span class="card-name">' + person.name + '</span><span class="card-id">' + person.id + '</span></span><span class="tag">' + status + '</span></div>';
    }
    function renderLane(id, people, status, emptyText) {
      document.getElementById(id).innerHTML = people.length ? people.map(function (person) { return card(person, status); }).join('') : '<div class="empty">' + emptyText + '</div>';
      document.getElementById(id + '-count').textContent = String(people.length);
    }
    function display(state) {
      const queueIds = new Set(state.rotation.map(function (person) { return person.id; }));
      const vipIds = new Set(state.vip.map(function (person) { return person.id; }));
      const doneIds = new Set((state.checkedOut || []).map(function (person) { return person.id; }));
      const done = roster.filter(function (person) { return doneIds.has(person.id); });
      const available = roster.filter(function (person) { return !queueIds.has(person.id) && !vipIds.has(person.id) && !done.some(function (finished) { return finished.id === person.id; }); });
      renderLane('waiting', available, 'ready', 'No fake records waiting');
      renderLane('queue', state.rotation.map(function (person) { return byId[person.id]; }).filter(Boolean), 'checked in', 'No active check-ins');
      renderLane('vip', state.vip.map(function (person) { return byId[person.id]; }).filter(Boolean), 'in session', 'No priority sessions');
      renderLane('done', done, 'complete', 'No checkouts yet');
      const events = state.recentEvents.slice().reverse();
      document.getElementById('events').innerHTML = events.length ? events.map(function (event) {
        const date = new Date(event.time);
        return '<div class="event"><span class="event-type">' + event.event + '</span><span><strong>' + event.name + '</strong></span><span class="event-time">' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) + '</span></div>';
      }).join('') : '<div class="empty">Waiting for an API event…</div>';
    }
    async function refresh() {
      try {
        const response = await fetch(api + '/state', { headers: { 'X-API-Key': key } });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        display(await response.json());
        document.getElementById('connection').textContent = 'Sandbox connected';
        document.getElementById('dot').style.background = '#73d4a8';
        document.getElementById('last').textContent = 'Updated ' + new Date().toLocaleTimeString() + ' · auto-refreshing every 2 seconds';
      } catch (error) {
        document.getElementById('connection').textContent = 'Sandbox unavailable — retrying';
        document.getElementById('dot').style.background = '#ef8299';
        document.getElementById('last').textContent = 'Last request failed: ' + error.message;
      }
    }
    refresh(); setInterval(refresh, 2000);
  </script>
</body></html>`);
});

export default router;
