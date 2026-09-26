-- Billing: one row per Growlink organization per app. Stripe is the source
-- of truth for paid subscriptions; this is the app's copy, kept current by
-- the Stripe webhook, so entitlement checks never call Stripe.
--
-- Access: an org is entitled while comped, while its own 30-day trial runs
-- (no card needed; starts the first time the org uses billing-aware parts of
-- the app), or while its Stripe subscription is trialing / active / past_due.
-- Cameras keep uploading regardless — billing never loses anyone's frames.

create table public.org_billing (
  org_id                 uuid not null,
  app                    text not null default 'plant-health',
  org_name               text,
  trial_ends_at          timestamptz not null,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  status                 text,          -- Stripe subscription status, null = never subscribed
  quantity               int,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  comp                   boolean not null default false,  -- support: free (pilots, partners)
  comp_note              text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (org_id, app)
);

-- Webhook deliveries already handled (Stripe retries and may repeat).
create table public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

alter table public.org_billing enable row level security;
alter table public.stripe_events enable row level security;
-- No policies: service role only.
