# NEON AI DJ — POS Integration Guide

This document describes how a point-of-sale (POS) system on the same venue network sends entertainer status signals to the NEON AI DJ rotation system.

## Overview

The DJ system runs a small HTTP server on each venue unit. The POS sends four signals as simple JSON webhooks over the local network (LAN). Each signal immediately updates the live DJ booth:

| Signal | Endpoint | Effect in the booth |
|---|---|---|
| Entertainer arrives / checks in | `POST /api/pos/checkin` | Added to the stage rotation |
| Entertainer enters VIP | `POST /api/pos/vip-start` | Removed from rotation, shown in the VIP list |
| Entertainer leaves VIP | `POST /api/pos/vip-end` | Returned to the bottom of the rotation |
| Entertainer checks out for the day | `POST /api/pos/checkout` | Removed from rotation (and VIP, if applicable) |

No polling is needed on either side — one HTTP request per event.

## Connection details

- **Base URL:** `http://<dj-unit-ip>:3001` (the DJ unit's LAN IP address; the venue operator will provide it). Plain HTTP on the trusted local network.
- **Authentication:** every request must include the header `X-API-Key: <key>`. The venue operator provides the key (found on the DJ unit under **Options → POS Integration**).
- **Content type:** `Content-Type: application/json` on all POST requests.

### Connectivity test

```
GET /api/pos/health
X-API-Key: <key>
```

Response `200`:
```json
{ "ok": true, "service": "NEON AI DJ", "unit": "neonaidj002", "time": "2026-08-17T20:15:00.000Z" }
```

A `401` means the API key is missing or wrong.

## Identifying entertainers

Each event names one entertainer, by **stable ID** (preferred) or by **exact stage name** (case-insensitive). Fetch the current roster to map your records:

```
GET /api/pos/entertainers
X-API-Key: <key>
```

Response:
```json
{
  "entertainers": [
    { "id": "a1b2c3", "name": "Amber" },
    { "id": "d4e5f6", "name": "Lauren Phillips" }
  ]
}
```

Store the `id` alongside your own customer/employee record and send it with every event. Sending `"name"` also works but breaks if the stage name is edited in the DJ system.

## The four signals

All four endpoints accept the same JSON body — provide **one** of:

```json
{ "entertainerId": "a1b2c3" }
```
or
```json
{ "name": "Amber" }
```

### 1. Check-in (arrives, joins rotation)

```
POST /api/pos/checkin
```

### 2. VIP start (leaves rotation for a VIP room)

```
POST /api/pos/vip-start
```

The entertainer stays in VIP until the POS sends `vip-end` (or the DJ manually releases her). Sending `vip-start` again while already in VIP is a no-op (harmless).

Note: if she is **currently performing on stage** when `vip-start` arrives, the system finishes her current set first and moves her to VIP as soon as it ends — it never cuts off a live set.

### 3. VIP end (returns to rotation)

```
POST /api/pos/vip-end
```

She rejoins at the bottom of the rotation.

### 4. Checkout (done for the day)

```
POST /api/pos/checkout
```

Removes her from the rotation entirely (and out of VIP if she was still marked in VIP). Send this even if she is currently in VIP — no `vip-end` needed first.

## Responses

Success (`200`):
```json
{ "ok": true, "event": "checkin", "entertainerId": "a1b2c3", "name": "Amber", "commandIds": [42] }
```

Errors:
- `400` — body missing both `entertainerId` and `name`.
- `401` — missing/invalid `X-API-Key`.
- `404` — no entertainer matched. The response message says which value failed; re-sync via `GET /api/pos/entertainers`.

```json
{ "error": "Entertainer not found for name \"Ambr\". Use GET /api/pos/entertainers for the current roster." }
```

## Example (curl)

```bash
curl -X POST http://192.168.1.50:3001/api/pos/checkin \
  -H "X-API-Key: pos_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"name": "Amber"}'
```

## Reliability notes

- All four signals are idempotent: repeating a `checkin` for someone already in rotation, a `vip-start` for someone already in VIP, a `vip-end` for someone not in VIP, or a `checkout` for someone already gone does nothing (no duplicate entries, no extra VIP time).
- If a request fails (network blip, unit rebooting), retry with backoff; the same event can be safely re-sent.
- Events are also written to the DJ system's audit log (actor "POS System"), so both sides can reconcile.
- One DJ unit per venue; if a venue has multiple units, each has its own IP and its own API key.

## Security notes

- Traffic is plain HTTP on the venue's private LAN — keep the DJ unit and POS on a trusted network segment (not guest Wi-Fi). Anyone who can sniff that segment could read the key.
- The key can be rotated at any time from the DJ unit (**Options → POS Integration → Generate new key**); the old key stops working immediately.
