-- When a camera shows several sensors of the same type (e.g. three climate
-- temperature probes), show them as one room average — the same behavior as
-- the display app. Off shows each sensor separately.
alter table public.cameras add column average_same_type boolean not null default true;
