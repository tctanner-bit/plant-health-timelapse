-- Nova / AI usage ledger for every Growlink product that goes through the
-- display-fleet AI proxy (display panels, Plant Health AI, ...).
--
--   ai_usage    one row per proxied call: who, which org, what feature,
--               tokens, cost. Written only by the proxy (service role).
--   ai_prices   price per model/op, with an effective date, so a call's cost
--               is fixed when it's recorded and past costs never shift.
--   ai_budgets  optional monthly spend limit and on/off switch per org,
--               enforced by the proxy. No row = no limit.
--
-- Fleet admins (fleet_admins allow list) can read everything and edit
-- prices and budgets from the fleet dashboard.

create table public.ai_prices (
  model            text not null,
  op               text not null check (op in ('chat', 'transcribe', 'speak')),
  input_per_mtok   numeric(10, 4),   -- USD per 1M input tokens
  output_per_mtok  numeric(10, 4),   -- USD per 1M output tokens
  per_1k_chars     numeric(10, 5),   -- USD per 1k input characters (speech, which reports no tokens)
  effective_from   timestamptz not null default now(),
  note             text,
  primary key (model, op, effective_from)
);

-- List prices at time of writing — check against the OpenAI pricing page and
-- add a new row (new effective_from) whenever they change.
insert into public.ai_prices (model, op, input_per_mtok, output_per_mtok, per_1k_chars, effective_from, note) values
  ('gpt-4o-mini',            'chat',       0.15,  0.60, null,  '2026-01-01', 'text + image input tokens'),
  ('gpt-4o-mini-transcribe', 'transcribe', 1.25,  5.00, null,  '2026-01-01', 'audio input tokens'),
  ('gpt-4o-mini-tts',        'speak',      null,  null, 0.015, '2026-01-01', 'estimate: ~$0.015 per minute of speech ≈ per 1k characters');

create table public.ai_usage (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  product        text not null,                 -- 'display' | 'plant-health' | ...
  caller         text not null check (caller in ('display', 'user', 'service')),
  display_id     uuid,
  org_id         text,                          -- Growlink org GUID, lowercase
  org_name       text,
  feature        text,                          -- e.g. 'daily_review', 'moment', 'scout', 'ask'
  ref            text,                          -- e.g. 'camera:<id>;insight:<id>'
  op             text not null,
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  image_count    integer,
  input_chars    integer,
  cost_usd       numeric(12, 6),
  latency_ms     integer,
  http_status    integer,
  ok             boolean not null,
  blocked        text                           -- 'budget' | 'disabled' when the proxy refused
);
create index ai_usage_org_at_idx on public.ai_usage (org_id, at desc);
create index ai_usage_at_idx on public.ai_usage (at desc);
create index ai_usage_product_at_idx on public.ai_usage (product, at desc);

create table public.ai_budgets (
  org_id             text primary key,         -- lowercase GUID
  org_name           text,
  monthly_usd_limit  numeric(10, 2),           -- null = unlimited
  enabled            boolean not null default true,
  note               text,
  updated_at         timestamptz not null default now(),
  updated_by         text
);

-- Month-to-date spend for one org (UTC calendar month). Used by the proxy
-- before each call, so it stays one indexed range scan.
create or replace function public.ai_month_spend(p_org text)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)
  from ai_usage
  where org_id = p_org
    and at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;
revoke all on function public.ai_month_spend(text) from public, anon, authenticated;
grant execute on function public.ai_month_spend(text) to service_role;

-- Daily roll-up for dashboards and billing exports. security_invoker so the
-- caller's RLS applies (fleet admins only), not the view owner's.
create view public.ai_usage_daily
with (security_invoker = true) as
select
  date_trunc('day', at at time zone 'utc')::date as day,
  product,
  org_id,
  max(org_name) as org_name,
  feature,
  count(*) as calls,
  count(*) filter (where not ok) as failed,
  count(*) filter (where blocked is not null) as blocked,
  coalesce(sum(input_tokens), 0) as input_tokens,
  coalesce(sum(output_tokens), 0) as output_tokens,
  coalesce(sum(image_count), 0) as images,
  coalesce(sum(cost_usd), 0) as cost_usd
from public.ai_usage
group by 1, 2, 3, 5;

alter table public.ai_prices  enable row level security;
alter table public.ai_usage   enable row level security;
alter table public.ai_budgets enable row level security;

create policy "fleet admins read ai usage"   on public.ai_usage   for select to authenticated using (is_fleet_admin());
create policy "fleet admins read ai prices"  on public.ai_prices  for select to authenticated using (is_fleet_admin());
create policy "fleet admins add ai prices"   on public.ai_prices  for insert to authenticated with check (is_fleet_admin());
create policy "fleet admins read budgets"    on public.ai_budgets for select to authenticated using (is_fleet_admin());
create policy "fleet admins add budgets"     on public.ai_budgets for insert to authenticated with check (is_fleet_admin());
create policy "fleet admins change budgets"  on public.ai_budgets for update to authenticated using (is_fleet_admin()) with check (is_fleet_admin());
