-- Persist the Stripe customer a user is bound to at creation time (checkout),
-- not only after a completed subscription (the webhook's subscriptions upsert).
-- Without this, every abandoned/repeated checkout click minted a fresh orphan
-- Stripe customer because nothing remembered the one already created.
--
-- RLS enabled with no policies: only the service-role key (the Worker) can
-- read or write — same posture as the analytics tables.
create table public.billing_customers (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);
alter table public.billing_customers enable row level security;
