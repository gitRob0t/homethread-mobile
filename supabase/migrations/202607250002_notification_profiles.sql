-- Persist each member's notification profile and enforce quiet hours server-side.

alter table public.notification_preferences
  add column if not exists quiet_hours boolean not null default true,
  add column if not exists quiet_hours_start time not null default '21:00',
  add column if not exists quiet_hours_end time not null default '07:00';

comment on column public.notification_preferences.quiet_hours is
  'When enabled, non-urgent notification delivery is deferred during the member''s local quiet window.';
comment on column public.notification_preferences.quiet_hours_start is
  'Member-local start of the quiet window.';
comment on column public.notification_preferences.quiet_hours_end is
  'Member-local end of the quiet window.';
