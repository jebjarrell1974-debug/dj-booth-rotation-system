# NEON AI DJ — POS Integration Sandbox

A hosted test instance you can develop against before going live at a venue.
It implements the exact same endpoints, request/response shapes, and idempotency
behavior documented in **POS-INTEGRATION.md** — but with a fake, fixed roster and
no real venue data.

## Base URL

```
https://git-hub-meeting.replit.app
```

(HTTPS here; real units are plain HTTP on the venue LAN at `http://<unit-ip>:3001`.)

## Browser test console

For a human-friendly screen with the fake roster, clickable test controls, live
responses, and the current pretend rotation/VIP state, open:

```
https://git-hub-meeting.replit.app/api/pos/sandbox
```

This page is only a convenience for developers. The actual integration is
server-to-server: the POS sends HTTPS requests to the endpoints below; it does
not need to load or control a DJ-booth screen.

## Visual workflow demo

For a display-only, generic event-status board that updates automatically as
your POS sends sandbox events, open:

```
https://git-hub-meeting.replit.app/api/pos/demo
```

This is a deliberately separate fake workflow simulator — not a DJ booth
screen. It contains no music, real people, venue details, production controls,
or live-system access. Use it when you want to show check-in, VIP start, VIP
end, and checkout moving the fake sandbox roster through a visible workflow.

## API key

Send this in the `X-API-Key` header on every request:

```
pos_sandbox_9f3c2e7d41b8a6f0c5d2e9a17b4f8c3d6e0a5b9c2f7d4e1a
```

This sandbox key is intentionally public. Each real unit has its own private key
provided by the operator.

## Test roster (fixed)

| entertainerId | name |
| --- | --- |
| sandbox-001 | Amber |
| sandbox-002 | Brooke |
| sandbox-003 | Crystal |
| sandbox-004 | Destiny |
| sandbox-005 | Emerald |
| sandbox-006 | Faith |

Also available live via `GET /api/pos/entertainers`.

## Endpoints

Same as production (see POS-INTEGRATION.md for full details):

- `GET  /api/pos/health` — no key needed
- `GET  /api/pos/entertainers`
- `POST /api/pos/checkin` — body `{"entertainerId": "..."} ` or `{"name": "..."}`
- `POST /api/pos/vip-start`
- `POST /api/pos/vip-end`
- `POST /api/pos/checkout`

## Sandbox-only extra: see the effect of your signals

```
GET /api/pos/state
```

Returns the current rotation, who's in VIP, and the last 20 events — so you can
verify your signals did what you expected. **Real units do not have this
endpoint**; it exists only in the sandbox.

## Quick start

```bash
KEY=pos_sandbox_9f3c2e7d41b8a6f0c5d2e9a17b4f8c3d6e0a5b9c2f7d4e1a
BASE=https://git-hub-meeting.replit.app/api/pos

curl -X POST $BASE/checkin   -H "X-API-Key: $KEY" -H "Content-Type: application/json" -d '{"name":"Amber"}'
curl -X POST $BASE/vip-start -H "X-API-Key: $KEY" -H "Content-Type: application/json" -d '{"name":"Amber"}'
curl        $BASE/state      -H "X-API-Key: $KEY"
curl -X POST $BASE/vip-end   -H "X-API-Key: $KEY" -H "Content-Type: application/json" -d '{"name":"Amber"}'
curl -X POST $BASE/checkout  -H "X-API-Key: $KEY" -H "Content-Type: application/json" -d '{"name":"Amber"}'
```

## Notes

- Sandbox state is in-memory and resets from time to time (idle restarts). That's
  expected — re-send a `checkin` and continue.
- Retries are safe: repeating any signal never double-adds anyone or adds extra
  VIP time, exactly like production.
- The main base URL may show the DJ-booth display shell. It is not part of the
  POS integration. Use the browser test console URL above, or call
  `/api/pos/*` directly from your own tool or code.
