# Plant Health AI

_See every change in your canopy, and why it happened._

Timelapse of a grow room's canopy, synced with that room's Growlink sensor
history. A Growlink LABS app: **https://labs.growlink.io/plant-health/**,
signed in with the LABS account. Multi-tenant: each connected Growlink
organization (a *site*) sees only its own cameras.
Cameras are plug-and-play: configured at the warehouse, plugged into PoE on
site, and claimed in the app with the code on their sticker.

```
Reolink camera ──FTPS, every 5 min──▶ FTPS gateway ──HTTPS──▶ ingest-frame ──▶ Supabase
 (pre-configured,                      (gateway/, Fly.io,       (edge function)  camera_frames
  outbound only)                        holds no secrets)                        + camera-frames bucket
                                                                                       │
labs.growlink.io/plant-health/ ──LABS token──▶ Next.js API routes (this repo) ◀───────┘
 (LABS rewrite → this Vercel           check the LABS user's site membership,
  project, basePath /plant-health)     read Supabase with the service key,
                                       call Growlink with the site's key (Vault)
```

## Growlink LABS

- **Hosting.** The LABS site (`C:Repogrowlink-labs`, `vercel.json`) rewrites
  `/plant-health/*` to this Vercel project, which builds with
  `basePath: "/plant-health"` and trailing slashes (LABS uses them; without
  them the two would redirect back and forth). The bare Vercel URL redirects
  to LABS. Listed in LABS' `site/apps.json`.
- **Sign-in** is the LABS account (Supabase Auth in the LABS project
  `mgenmllmciiijyeielak`). The browser shares LABS' session (localStorage
  `growlink.labs.auth`, same origin) and sends the access token; API routes
  check it with the LABS project (`lib/server/sites.ts`, cached 60 s).
- **Sites.** One per Growlink organization (`sites`). An owner connects it with
  an org-admin API key, checked with Growlink and kept in **Vault**
  (`set_site_key` / `get_site_key`, service role only); it never reaches a
  browser. Members (`site_members`) are owners or viewers; owners invite by
  email (`site_invites`), accepted when that verified LABS email signs in.
  Connecting an org that's already a site with a valid key for it makes you
  an owner of it.
- **Growlink data** for the browser (rooms, sensors, charts, live readings)
  goes through `POST /api/orgs/[orgId]/growlink` with the site's key —
  read-only operations only. A key Growlink rejects is deleted and owners are
  asked to reconnect it in Settings.
- **Billing** is paused while the app is in LABS beta: no Stripe keys are
  set, so nothing is enforced and the Billing tab is hidden. The code is
  kept for when it graduates.

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
- **People** sign in with their LABS account. Every API route requires a
  membership of the site connected to the org in the URL and filters every
  query by `org_id`; changes (claiming, managing cameras, site settings)
  need the owner role.
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
| `app/api/sites`, `app/api/orgs/[orgId]/site` | Connect an org, members, invites, key, background monitoring |
| `components/` | LABS sign-in → site → Facility / Cameras / Settings → player with Growlink sensor overlays |

## Environment

| Variable | Where |
|---|---|
| `SUPABASE_URL` | Vercel, server only. `https://uqbfrvtiwxukqpaxczmq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel, server only, **never** `NEXT_PUBLIC_`. Also needed at the warehouse for provisioning |
| `STRIPE_SECRET_KEY` | Vercel, server only. A restricted key (Customers, Checkout Sessions, Subscriptions, Customer portal: write; Products, Prices, PaymentMethods: read). Billing stays off (nobody locked out) until set |
| `STRIPE_WEBHOOK_SECRET` | Vercel, server only. Printed once by `scripts/stripe-setup.mjs` |

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

## Billing

$19 per active camera per month through Stripe (Growlink's account), after
a 30-day trial that needs no card. Nova is included, free during beta.

- **org_billing** holds each org's trial, Stripe customer/subscription and
  status; the webhook (`/api/stripe/webhook`) keeps it in step with Stripe,
  re-reading the subscription on every event. Nothing on a page load calls
  Stripe except the cached price lookup.
- **Trial** starts the first time an org opens the app (row created on
  first read). Adding a card during the trial saves it and first charges
  when the trial ends.
- **Camera count** follows the cameras: claim, revoke and support's
  unclaim/revoke/reactivate update the subscription quantity, prorated.
- **Access** (claiming cameras, frames, Nova) needs comp, an active trial,
  or a trialing/active/past_due subscription; otherwise those routes return
  402 and the app opens the Billing tab. Cameras keep uploading regardless.
  Without `STRIPE_SECRET_KEY` nothing is enforced.
- Checkout and the billing portal are Stripe-hosted and open in a new tab
  (they refuse to load inside the Growlink frame); `/billing/done` is where
  they return.
- **Existing Growlink customers**: support links an org to the Stripe
  customer it already pays Growlink with (fleet dashboard → Billing → Link
  customer); the customer is tagged `growlink_org_id`, which is also how
  orgs are linked automatically if Growlink's admin system sets it. The org
  can then subscribe with that card in one click. Plant Health AI is its own
  subscription and invoice; Growlink's subscriptions are never touched, and
  the webhook ignores anything not tagged `app=plant-health`.
- The billing portal only updates the card and shows invoices; cancelling
  is in the app, since the portal would also list the customer's Growlink
  subscriptions.
- Support: fleet dashboard → Billing (link customer, make free, extend
  trial). Refunds are done in Stripe.

Setup (test mode first, then again with the live key):

    STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs

It creates the product, the `plant_health_camera_monthly` price, a billing
portal configuration of its own and the webhook, and prints the webhook
signing secret once.

## Background Nova

Nova watches every room without anyone having the app open: triggered
reviews plus the daily review, both run server-side.

- **Scheduler**: pg_cron in the Plant Health Camera database calls
  `POST /plant-health/api/jobs/watch/` every 5 minutes and `…/jobs/nova/` every
  minute (via pg_net). Both are safe to call: a lock allows one watch run at
  a time, and they return only counts.
- **Watchers** (no AI, `lib/server/watch.ts`): for each camera's newest
  frame, brightness / infrared / a 32×18 thumbnail (`camera_frame_stats`)
  → lights on/off differently from the same time yesterday, or a big visual
  change vs an hour ago while lit. Live sensors (averaged per metric) →
  temperature, humidity, VPD, CO₂, pH outside broad bands, or fast swings in
  temperature/humidity. A condition must hold on two checks in a row.
- **Triggers** queue one `alert` insight (Nova reviews the last 3 hours with
  the trigger as its question). Caps: 6 alerts per camera per day, the same
  trigger at most once every 3 hours. Every trip is logged in
  `camera_events` for tuning thresholds.
- **Daily review** is queued after 1 am in the org's time zone (the
  viewer's, captured with the key); the app's own trigger still works and
  the (camera, day) index keeps it to one.
- **Key**: the site's Growlink key from Vault, used only for read-only
  sensor calls. Only sites connected in LABS are watched; owners can turn
  background monitoring off in Settings. A key Growlink rejects is deleted
  and the site shows "reconnect".
- **Small copies**: each run first makes a ~640 px copy of frames that don't
  have one (`camera_frames.small_path`, `<frame>.sm.jpg`, newest first, up to
  60 per run). Tiles and playback use them; the player loads full size for a
  paused frame, and Nova always gets full size.
