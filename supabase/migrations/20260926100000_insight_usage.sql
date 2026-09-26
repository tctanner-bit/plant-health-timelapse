-- What each Nova insight cost, from the AI proxy's usage ledger
-- (display-fleet ai_usage.id = usage_id).
alter table public.camera_insights
  add column input_tokens  integer,
  add column output_tokens integer,
  add column cost_usd      numeric(12, 6),
  add column usage_id      bigint;
