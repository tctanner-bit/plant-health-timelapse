-- Nova range reviews: an analysis of whatever period the viewer selected
-- (last hour, 24 hours, 7 days, a custom From/To), on demand.
alter table public.camera_insights drop constraint camera_insights_kind_check;
alter table public.camera_insights
  add constraint camera_insights_kind_check check (kind in ('daily', 'moment', 'range'));
