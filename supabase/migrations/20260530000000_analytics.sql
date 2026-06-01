-- Analytics (first-party, privacy-preserving).
--
-- Three tables, all RLS-locked with NO policies, so only the service-role key
-- (the Worker) can read or write them — PostgREST denies anon/authenticated
-- access entirely. Metrics are exposed through the analytics_summary() RPC and
-- the Worker's GET /admin dashboard:
--   * landing-page unique visitors   -> analytics_pageviews     (POST /e beacon)
--   * logins                         -> analytics_logins        (auth.sessions trigger)
--   * active users (DAU/WAU/MAU)     -> analytics_user_activity (web /me heartbeat)
-- Firefox-extension active users come from the Mozilla AMO dashboard, not here.

-- 1. Landing-page pageviews. No cookies, no PII: the Worker stores only
--    visitor_hash = sha256(salt | utc-day | ip | user-agent), which rotates
--    every day and is not reversible. Distinct hashes within a day == unique
--    visitors that day.
create table public.analytics_pageviews (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  path         text,
  referrer     text,
  country      text,
  visitor_hash text not null
);
create index analytics_pageviews_created_idx
  on public.analytics_pageviews (created_at);
create index analytics_pageviews_day_visitor_idx
  on public.analytics_pageviews (created_at, visitor_hash);
alter table public.analytics_pageviews enable row level security;

-- 2. Authenticated user activity. One row per user per UTC day they were active;
--    the Worker upserts it from the /me heartbeat (the web app calls /me on load
--    and on focus for every signed-in user, free or pro). DAU/WAU/MAU = distinct
--    user_id over trailing 1 / 7 / 30 days.
create table public.analytics_user_activity (
  user_id      uuid not null references auth.users (id) on delete cascade,
  day          date not null,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index analytics_user_activity_day_idx
  on public.analytics_user_activity (day);
alter table public.analytics_user_activity enable row level security;

-- 3. Logins. Append-only, one row per sign-in. Supabase inserts a row into
--    auth.sessions on every new sign-in (token refreshes reuse the existing
--    session, so they are NOT counted), so a trigger there captures logins from
--    every surface — extension, web app, anywhere — with zero client code.
create table public.analytics_logins (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);
create index analytics_logins_created_idx
  on public.analytics_logins (created_at);
alter table public.analytics_logins enable row level security;

create or replace function public.record_login()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.analytics_logins (user_id, created_at)
  values (new.user_id, now());
  return new;
end;
$$;

drop trigger if exists analytics_on_session_created on auth.sessions;
create trigger analytics_on_session_created
  after insert on auth.sessions
  for each row execute function public.record_login();

-- Single RPC the Worker calls for the /admin dashboard. SECURITY DEFINER so the
-- service-role Worker can read the RLS-locked tables; EXECUTE is revoked from
-- anon/authenticated so a signed-in user can't call it directly. All windows are
-- calendar-day based in the database timezone (UTC on Supabase).
--
-- Note: because visitor_hash embeds the day, count(distinct visitor_hash) over a
-- multi-day window equals the SUM of each day's unique visitors (i.e. visitor-
-- days), not distinct people across the window — the daily rotation is what keeps
-- the hash non-tracking. The fields are named accordingly.
create or replace function public.analytics_summary()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'generated_at', now(),
    'pageviews', json_build_object(
      'unique_today',            (select count(distinct visitor_hash) from analytics_pageviews where created_at >= current_date),
      'unique_visitor_days_7d',  (select count(distinct visitor_hash) from analytics_pageviews where created_at >= current_date - 6),
      'unique_visitor_days_30d', (select count(distinct visitor_hash) from analytics_pageviews where created_at >= current_date - 29),
      'total_30d',               (select count(*)                     from analytics_pageviews where created_at >= current_date - 29)
    ),
    'logins', json_build_object(
      'today', (select count(*) from analytics_logins where created_at >= current_date),
      'd7',    (select count(*) from analytics_logins where created_at >= current_date - 6),
      'd30',   (select count(*) from analytics_logins where created_at >= current_date - 29)
    ),
    'active_users', json_build_object(
      'dau', (select count(distinct user_id) from analytics_user_activity where day =  current_date),
      'wau', (select count(distinct user_id) from analytics_user_activity where day >= current_date - 6),
      'mau', (select count(distinct user_id) from analytics_user_activity where day >= current_date - 29)
    ),
    'daily', (
      select coalesce(json_agg(row_to_json(d) order by d.day), '[]'::json)
      from (
        select gd::date as day,
          (select count(distinct visitor_hash) from analytics_pageviews p
             where p.created_at >= gd::date and p.created_at < gd::date + 1) as unique_visitors,
          (select count(*) from analytics_logins l
             where l.created_at >= gd::date and l.created_at < gd::date + 1) as logins,
          (select count(distinct user_id) from analytics_user_activity a
             where a.day = gd::date) as active_users
        from generate_series((current_date - 29)::timestamp, current_date::timestamp, interval '1 day') gd
      ) d
    )
  );
$$;

revoke all on function public.analytics_summary() from public;
grant execute on function public.analytics_summary() to service_role;
