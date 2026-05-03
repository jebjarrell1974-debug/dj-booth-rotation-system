# NEON AI DJ — `/aichat` setup (homebase only)

Read-only fleet-monitoring API for an external AI client (OpenAI Custom GPT, Claude connector, etc.). **Only deploy to homebase. Never to a venue Dell.**

## What this is

Six read-only tools mounted at `/aichat/*`:

- `GET /aichat/booth-state/:deviceId` — currently playing track, dancer, queue
- `GET /aichat/device-health` — fleet-wide health summary
- `GET /aichat/device-health/:deviceId` — detail for one device
- `GET /aichat/play-history/:deviceId?date=YYYY-MM-DD&limit=N`
- `GET /aichat/diag-log/:deviceId?since=ISO&limit=N`
- `GET /aichat/audit-log?days=N&limit=N`
- `GET /aichat/settings`

Plus an unauthenticated OpenAPI spec at `/aichat/openapi.yaml` (the Custom GPT reads this).

`deviceId` accepts numeric id, device name (e.g. `neonaidj003`), or club name.

All endpoints require `Authorization: Bearer <token>`. No write endpoints exist in this module — adding them is intentionally out of scope.

## Step 1 — generate the token (homebase, one time)

```bash
openssl rand -hex 32 > ~/.djbooth-aichat-token
chmod 600 ~/.djbooth-aichat-token
cat ~/.djbooth-aichat-token   # copy this for step 4
```

The api-server reads this file at startup. If the file is missing AND `AICHAT_TOKEN` env var is unset, every `/aichat/*` request returns `503 aichat disabled`. Restart the api-server after creating/changing the token.

## Step 2 — install cloudflared (homebase)

```bash
# Debian/Ubuntu
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
  -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
cloudflared --version
```

## Step 3 — run the tunnel

**Quick path (free `*.trycloudflare.com` URL, no account required):**

```bash
cloudflared tunnel --url http://localhost:3001
```

This prints a URL like `https://random-words-1234.trycloudflare.com`. The URL changes every time you restart. Good for first-time testing.

**Permanent path (named tunnel, stable URL, free Cloudflare account):**

```bash
cloudflared tunnel login                       # browser auth, one time
cloudflared tunnel create neon-fleet
cloudflared tunnel route dns neon-fleet monitor.<your-future-domain>
# Or use the assigned <uuid>.cfargotunnel.com hostname if no domain yet.
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: neon-fleet
credentials-file: /home/<user>/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: monitor.<your-future-domain>
    service: http://localhost:3001
  - service: http_status:404
```

Install as a systemd service so it survives reboots:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

When you eventually buy a domain, just update the `hostname` in `config.yml`, run `cloudflared tunnel route dns neon-fleet <new-hostname>`, and restart the service. **No api-server changes required.**

## Step 4 — create the Custom GPT (chatgpt.com)

1. ChatGPT → **Explore GPTs** → **Create**
2. Name: `NEON Fleet Monitor`
3. Instructions:

   > You are a read-only operations assistant for the NEON AI DJ fleet of nightclub automation systems. Use the provided tools to answer questions about device health, currently playing tracks, play history, diagnostics, audit log, and settings. When the user mentions a venue (e.g. "003" or "lounge"), pass it directly to the tool — the server resolves device id, name, or club name. Be concise. Surface anomalies (offline devices, dead-air events, license expiry, errors) without being asked. You cannot make any changes — if the user asks to restart, update, or modify anything, say so and suggest doing it from the homebase dashboard.

4. **Configure → Actions → Create new action**
5. **Schema**: paste the contents of `https://<your-tunnel-url>/aichat/openapi.yaml` (or click "Import from URL")
6. **Authentication**: API Key → Auth Type **Bearer** → paste the token from step 1
7. Privacy policy URL: anything (required by OpenAI; can be a placeholder)
8. Save → set visibility to **Only me**

## Step 5 — verify

In the GPT chat:

> What's the current state of the whole fleet?

Expected: it calls `get_fleet_health` and returns a per-device summary. If you get a 401, the token doesn't match. If 503, the dotfile isn't being read (check homedir + restart api-server). If timeout, cloudflared isn't running or isn't pointed at port 3001.

## Token rotation

```bash
openssl rand -hex 32 > ~/.djbooth-aichat-token
sudo systemctl restart djbooth-api   # or however the api-server is supervised
```

Then update the bearer token in the Custom GPT's Action settings.

## Out of scope (intentional)

- **No write tools.** Adding `send_command` is Phase 2 and lives in a separate module.
- **No venue-Dell exposure.** Only homebase runs the tunnel.
- **No push notifications.** GPT is pull-only; you ask, it answers.
