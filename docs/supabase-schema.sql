-- Uncle Sam FC — profile/push schema. Paste into the Supabase SQL Editor and Run.
-- Access model: ONLY the Express server touches these tables (service-role key).
-- RLS is enabled with zero policies, so the public anon key can read/write nothing.

-- One row per browser / PWA install. id is generated client-side
-- (crypto.randomUUID) and stored in the device's localStorage.
create table public.devices (
  id           uuid primary key,
  user_id      uuid references auth.users (id) on delete set null,
  prefs        jsonb not null default
    '{"goals":true,"kickoff":true,"subbedOn":true,"fullTime":true,"injury":true}',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index devices_user_idx on public.devices (user_id);

-- Favorites always belong to a device; a signed-in device's effective set is
-- the union across that user's devices (computed by the server).
create table public.favorites (
  device_id  uuid not null references public.devices (id) on delete cascade,
  player_id  text not null, -- roster slug from players.json, e.g. 'pulisic-christian'
  created_at timestamptz not null default now(),
  primary key (device_id, player_id)
);
create index favorites_player_idx on public.favorites (player_id);

-- Web Push subscriptions (normally one per device; the endpoint rotates when a
-- device re-subscribes).
create table public.push_subscriptions (
  endpoint   text primary key,
  device_id  uuid not null references public.devices (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index push_subs_device_idx on public.push_subscriptions (device_id);

-- Dedupe log = the notifier's restart-safe state. The server inserts with
-- ignore-duplicates; a notification is sent only when the insert actually
-- inserted. Rows older than 30 days are purged by the notifier.
create table public.sent_notifications (
  event_key text not null,
  device_id uuid not null references public.devices (id) on delete cascade,
  sent_at   timestamptz not null default now(),
  primary key (event_key, device_id)
);
create index sent_sent_at_idx on public.sent_notifications (sent_at);

-- Server-only access: RLS on, zero policies.
alter table public.devices            enable row level security;
alter table public.favorites          enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.sent_notifications enable row level security;

-- Belt and suspenders: make the grants explicit regardless of the project's
-- "automatically expose new tables" setting — the server's service_role keeps
-- access, the public API roles lose even nominal privileges (RLS already
-- blocks them, but revoking removes the question entirely).
grant all on public.devices, public.favorites, public.push_subscriptions,
  public.sent_notifications to service_role;
revoke all on public.devices, public.favorites, public.push_subscriptions,
  public.sent_notifications from anon, authenticated;
