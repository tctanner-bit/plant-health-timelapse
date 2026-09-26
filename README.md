# Plant Health AI

_See every change in your canopy, and why it happened._

Timelapse of a grow room's canopy, synced with that room's Growlink sensor
history. Multi-tenant: every Growlink organization sees only its own cameras.
Cameras are plug-and-play: configured at the warehouse, plugged into PoE on
site, and claimed in the app with the code on their sticker.

```
Reolink camera ──FTPS, every 5 min──▶ FTPS gateway ──HTTPS──▶ ingest-frame ──▶ Supabase
 (pre-configured,                      (gateway/, Fly.io,       (edge function)  camera_frames
  outbound only)                        holds no secrets)                        + camera-frames bucket
                                                                                       │
Browser / Builder ──Growlink API key──▶ Next.js API routes (this repo) ◀──────────────┘
        │                               verify org membership with Growlink,
        └──────────▶ Growlink API       then read Supabase with the service key
                     (rooms, sensors, sensor history, called directly)
```

## Camera lifecycle

1. **Warehouse.** Run `node scripts/provision-camera.mjs --serial <serial>`.
   It registers an unclaimed camera and prints:
   - the sticker, with an `XXXX-XXXX` claim code;
   - the Reolink settings to enter: FTPS server, login, 5-minute picture
     upload, NTP.

   The FTP password is the camera's ingest token. It's shown once, then only
   its hash is kept.
2. **Site.** Plug the camera into PoE on any network with internet access.
   It gets an address by DHCP and uploads outbound. No port forwarding, no
   relay, no on-site setup. Until it's claimed, frames are dropped but the
   camera shows as online.
3. **Claim.** In the app: **Add camera** → sticker code → room → name. The
   claim is atomic and single-use, and it ties the camera to the org and room.
   Frames are stored from the next upload.
4. **Revoke** (stolen or decommissioned unit): the FTP login stops working
   immediately and frames are kept. Reusing the unit means provisioning it
   again.

## Tenancy

- **A tenant is a Growlink organization.** `cameras.org_id` / `room_id` are
  Growlink GUIDs, and they're null until the camera is claimed.
- **Viewers** sign in with their Growlink API key (kept in `sessionStorage`
  only). Every API route checks the key against Growlink
  `GET /api/v2/organizations` (cached 5 min per key hash), refuses any org the
  key can't see, and filters every query by `org_id`.
- **Cameras** authenticate with a per-camera token. It resolves to one camera
  row, which carries the org and room. The camera never names a tenant, and
  the token can't read anything.
- **Supabase** has RLS on with no policies, and the bucket is private. Only the
  service role (API routes, edge function) can read or write.

## Pieces

| Where | What |
|---|---|
| `supabase/migrations/` | `cameras` (claimable), `camera_frames`, private `camera-frames` bucket |
| `supabase/functions/ingest-frame/` | The single entry point for frames. Stores JPEGs for claimed cameras and records check-ins for unclaimed ones. A retried frame isn't stored twice |
| `gateway/` | FTPS gateway for Fly.io. See [gateway/README.md](gateway/README.md) |
| `scripts/provision-camera.mjs` | Warehouse provisioning: token, claim code, sticker, camera settings |
| `app/api/orgs/[orgId]/cameras/…` | List, claim, rename/move, revoke, list frames, sign frame URLs |
| `components/` | API key → org → cameras by room → player with Growlink sensor overlays |

## Environment

| Variable | Where |
|---|---|
| `SUPABASE_URL` | Vercel, server only. `https://uqbfrvtiwxukqpaxczmq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel, server only, **never** `NEXT_PUBLIC_`. Also needed at the warehouse for provisioning |

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are left over
from the prototype and unused now.

## Local run

```
npm install
cp .env.local.example .env.local   # fill in the two values
npm run dev
```

## Edge function

Deployed as `ingest-frame` with JWT verification **off** (it checks camera
tokens itself): `supabase functions deploy ingest-frame --no-verify-jwt`.

## To verify on a real RLC-810A before rollout

- FTPS (explicit TLS) is available and works against a self-signed certificate.
- Scheduled picture upload at a 5-minute interval, pictures only.
- Picture resolution can be set to 1920×1080.
- The FTP password field accepts the 31-character `phc_…` token.

## Storage math

At 1920×1080 (~300–500 KB), one camera at 5-minute intervals is about
3–4 GB/month. A retention job isn't built yet.

## Nova insights

Nova reads a camera's frames against its room's sensor history and returns
structured observations. Each observation cites the frames and sensors it
relies on, and each insight carries a concern level (none / watch / action).

- **Daily review:** three lights-on frames from a completed day, plus the
  same time a day and a week earlier. It's made the first time anyone opens
  the camera after that day ends, and shared with the org
  (`camera_insights`, one per camera per day). The server can't run it on a
  schedule, because it never stores a Growlink key.
- **Ask about this frame:** the chosen frame, an hour earlier, and the same
  time yesterday, with the six hours of sensor data before it, plus an
  optional question. Capped at 20 per organization per hour.
- **Facility tiles** flag rooms whose latest insight is Watch or Action.

The model call goes through the Growlink AI proxy (display-fleet Supabase
project, function `ai`), the same one the display app's Nova uses. The OpenAI
key, model and token caps live there. This app authenticates with a service
key:

| Where | Setting |
|---|---|
| display-fleet Supabase → Edge Function secrets | `AI_SERVICE_KEYS` = the key (comma-separate several) |
| Vercel (server only) | `NOVA_SERVICE_KEY` = the same key |
| Vercel (optional) | `NOVA_PROXY_URL` to point at a different proxy |

Without the key, Nova shows "Nova isn't configured on this server yet" and
nothing else breaks.
