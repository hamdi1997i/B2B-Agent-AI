-- ═══════════════════════════════════════════════════════════════════════════
--  المعاون (Maawen) — schéma de la plateforme
--
--  Un assistant IA personnel vendu par abonnement. Tout passe par le serveur:
--  la clé du fournisseur d'IA n'existe que dans les secrets des Edge
--  Functions, jamais dans l'app.
--
--  Règle RLS générale: chaque utilisateur ne voit que ses propres lignes;
--  l'admin voit tout. Les tables « système » (jetons OAuth, journaux bruts)
--  ne sont accessibles qu'au service_role.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────── helpers ──────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ────────────────────────────────────────────────────────── profiles ──────

create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text,
  full_name    text,
  avatar_url   text,
  phone        text,
  locale       text not null default 'ar-TN',
  role         text not null default 'user'   check (role in ('user', 'admin')),
  status       text not null default 'active' check (status in ('active', 'blocked')),
  notes        text,                          -- notes internes de l'admin
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

-- Rôle de l'appelant, en SECURITY DEFINER pour éviter la récursion RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create index profiles_role_idx   on public.profiles (role);
create index profiles_status_idx on public.profiles (status);

--  Garde-fou: un utilisateur peut modifier son profil (nom, langue…) mais
--  jamais son propre rôle, son statut ou les notes internes de l'admin —
--  sinon n'importe qui se promeut administrateur avec un simple UPDATE.
--  Quand auth.uid() est nul, l'appel vient du serveur (service_role) et non
--  d'un utilisateur: la RLS a déjà écarté les anonymes, on laisse passer.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role   := old.role;
    new.status := old.status;
    new.notes  := old.notes;
  end if;
  return new;
end;
$$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Un profil est créé automatiquement à l'inscription (Google sign-in).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────────────────────────────────────── plans ──────

create table public.plans (
  key                text primary key,
  name_ar            text not null,
  name_fr            text not null,
  description_ar     text,
  price_dt           numeric(10, 3) not null default 0,   -- prix local (Flouci)
  price_usd          numeric(10, 2) not null default 0,   -- prix international (Stripe)
  monthly_credits    integer not null default 0,          -- 1 crédit = 1 tour de parole
  daily_credit_cap   integer not null default 0,          -- 0 = pas de plafond journalier
  model_tier         text not null default 'standard'
                     check (model_tier in ('light', 'standard', 'advanced')),
  history_messages   integer not null default 20,         -- profondeur de contexte envoyée
  stripe_price_id    text,
  is_active          boolean not null default true,
  sort               integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();

-- ───────────────────────────────────────────────────── subscriptions ──────

create table public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique references public.profiles on delete cascade,
  plan_key             text references public.plans on delete restrict,
  status               text not null default 'none'
                       check (status in ('none', 'pending', 'active', 'past_due', 'canceled', 'expired')),
  provider             text check (provider in ('flouci', 'stripe', 'manual')),
  external_id          text,                              -- id abonnement/paiement côté fournisseur
  period_start         timestamptz,
  period_end           timestamptz,
  credits_remaining    integer not null default 0,
  credits_granted      integer not null default 0,
  cancel_at_period_end boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index subscriptions_status_idx on public.subscriptions (status, period_end);

create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- Journal des crédits: chaque mouvement est tracé (audit + support client).
create table public.credit_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles on delete cascade,
  delta         integer not null,
  reason        text not null,     -- 'subscription', 'usage', 'admin_grant', 'refund'
  ref_id        text,
  balance_after integer,
  created_at    timestamptz not null default now()
);

create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

-- ────────────────────────────────────────────────────────── paiements ─────

create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles on delete set null,
  plan_key    text references public.plans on delete set null,
  provider    text not null check (provider in ('flouci', 'stripe', 'manual')),
  external_id text,
  amount      numeric(10, 3) not null,
  currency    text not null default 'TND',
  status      text not null default 'pending'
              check (status in ('pending', 'paid', 'failed', 'refunded')),
  raw         jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index payments_provider_external_idx
  on public.payments (provider, external_id) where external_id is not null;

create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────── catalogue des « apps » (outils) ──

--  kind:
--    device  → exécuté sur le téléphone (agenda, contacts, SMS…)
--    server  → exécuté par l'Edge Function (notes, mémo, recherche web…)
--    oauth   → exécuté par l'Edge Function avec le jeton du service connecté
create table public.tools (
  key                 text primary key,
  name_ar             text not null,
  name_fr             text not null,
  description_ar      text not null,
  description_fr      text,
  kind                text not null check (kind in ('device', 'server', 'oauth')),
  icon                text,
  android_permissions text[] not null default '{}',
  oauth_provider      text,
  oauth_scopes        text[] not null default '{}',
  requires_consent    boolean not null default true,
  is_enabled          boolean not null default true,   -- interrupteur global de l'admin
  min_plan            text references public.plans on delete set null,
  input_schema        jsonb not null,                  -- schéma d'arguments envoyé au modèle
  model_description   text not null,                   -- description lue par le modèle
  prompt_hint         text,                            -- consigne ajoutée au system prompt
  sort                integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger tools_touch before update on public.tools
  for each row execute function public.touch_updated_at();

-- Autorisation donnée (ou refusée) par l'utilisateur, app par app.
create table public.user_tools (
  user_id    uuid not null references public.profiles on delete cascade,
  tool_key   text not null references public.tools on delete cascade,
  status     text not null check (status in ('granted', 'denied')),
  granted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, tool_key)
);

-- Jetons OAuth (Gmail, Drive…): jamais lisibles par l'utilisateur ni l'admin,
-- seulement par le service_role depuis les Edge Functions.
create table public.oauth_connections (
  user_id       uuid not null references public.profiles on delete cascade,
  provider      text not null,
  account_email text,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz,
  scopes        text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, provider)
);

create trigger oauth_touch before update on public.oauth_connections
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────── conversations ────

create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  title      text,
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_user_idx on public.conversations (user_id, updated_at desc);

create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();

--  content garde les blocs tels quels (texte, tool_use, tool_result) pour
--  pouvoir rejouer la conversation quel que soit le fournisseur d'IA.
create table public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations on delete cascade,
  user_id         uuid not null references public.profiles on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         jsonb not null,
  created_at      timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, id);

-- ────────────────────────────────────────────── consommation & séances ────

create table public.model_prices (
  provider              text not null,
  model                 text not null,
  input_usd_per_mtok    numeric(10, 4) not null,
  output_usd_per_mtok   numeric(10, 4) not null,
  cache_read_usd_per_mtok  numeric(10, 4) not null default 0,
  cache_write_usd_per_mtok numeric(10, 4) not null default 0,
  updated_at            timestamptz not null default now(),
  primary key (provider, model)
);

create table public.usage_events (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null references public.profiles on delete cascade,
  conversation_id    uuid references public.conversations on delete set null,
  provider           text not null,
  model              text not null,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd           numeric(12, 6) not null default 0,
  credits_charged    integer not null default 0,
  tools_used         text[] not null default '{}',
  duration_ms        integer,
  status             text not null default 'ok',
  error              text,
  created_at         timestamptz not null default now()
);

create index usage_events_user_idx on public.usage_events (user_id, created_at desc);
create index usage_events_day_idx  on public.usage_events (created_at);

-- Temps passé dans l'app: l'app ouvre une séance et envoie un ping régulier.
create table public.app_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles on delete cascade,
  platform     text not null default 'android',
  app_version  text,
  started_at   timestamptz not null default now(),
  last_ping_at timestamptz not null default now(),
  ended_at     timestamptz
);

create index app_sessions_user_idx on public.app_sessions (user_id, started_at desc);

-- ═══════════════════════════════════════════════════════════ RLS ══════════
--  L'app mobile parle à la base avec le jeton de l'utilisateur: les policies
--  sont la vraie frontière de sécurité, pas le code de l'app.

alter table public.profiles          enable row level security;
alter table public.plans             enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.credit_ledger     enable row level security;
alter table public.payments          enable row level security;
alter table public.tools             enable row level security;
alter table public.user_tools        enable row level security;
alter table public.oauth_connections enable row level security;
alter table public.conversations     enable row level security;
alter table public.messages          enable row level security;
alter table public.usage_events      enable row level security;
alter table public.app_sessions      enable row level security;
alter table public.model_prices      enable row level security;

-- profiles: chacun le sien; l'admin lit et modifie tout.
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- plans et tools: catalogue public en lecture, écriture réservée à l'admin.
create policy plans_read on public.plans
  for select using (is_active or public.is_admin());
create policy plans_admin on public.plans
  for all using (public.is_admin()) with check (public.is_admin());

create policy tools_read on public.tools
  for select using (is_enabled or public.is_admin());
create policy tools_admin on public.tools
  for all using (public.is_admin()) with check (public.is_admin());

create policy model_prices_read on public.model_prices
  for select using (public.is_admin());
create policy model_prices_admin on public.model_prices
  for all using (public.is_admin()) with check (public.is_admin());

-- Abonnement, crédits, paiements: lecture seule pour l'utilisateur.
-- Toute écriture passe par les fonctions SECURITY DEFINER ou le service_role.
create policy subscriptions_read on public.subscriptions
  for select using (user_id = auth.uid() or public.is_admin());
create policy subscriptions_admin on public.subscriptions
  for all using (public.is_admin()) with check (public.is_admin());

create policy credit_ledger_read on public.credit_ledger
  for select using (user_id = auth.uid() or public.is_admin());
create policy credit_ledger_admin on public.credit_ledger
  for all using (public.is_admin()) with check (public.is_admin());

create policy payments_read on public.payments
  for select using (user_id = auth.uid() or public.is_admin());
create policy payments_admin on public.payments
  for all using (public.is_admin()) with check (public.is_admin());

-- Autorisations d'apps: l'utilisateur décide, l'admin observe.
create policy user_tools_own on public.user_tools
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_tools_admin_read on public.user_tools
  for select using (public.is_admin());

-- Jetons OAuth: personne, à part le service_role (qui contourne la RLS).
create policy oauth_no_access on public.oauth_connections
  for select using (false);

-- Conversations et messages: strictement privés à leur propriétaire.
-- L'admin voit le compteur d'usage, jamais le contenu des discussions.
create policy conversations_own on public.conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy messages_own on public.messages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy usage_events_read on public.usage_events
  for select using (user_id = auth.uid() or public.is_admin());

create policy app_sessions_own on public.app_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy app_sessions_admin_read on public.app_sessions
  for select using (public.is_admin());

-- ═════════════════════════════════════════════ logique métier (RPC) ═══════

--  Un « tour de parole » = 1 crédit. La fonction vérifie l'abonnement, le
--  solde et le plafond journalier, puis débite — le tout dans une seule
--  transaction pour qu'on ne puisse pas la contourner en spammant l'API.
create or replace function public.begin_agent_turn(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile  public.profiles%rowtype;
  v_sub      public.subscriptions%rowtype;
  v_plan     public.plans%rowtype;
  v_used_today integer;
begin
  select * into v_profile from public.profiles where id = p_user;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_user');
  end if;
  if v_profile.status = 'blocked' then
    return jsonb_build_object('allowed', false, 'reason', 'blocked');
  end if;

  select * into v_sub from public.subscriptions where user_id = p_user for update;
  if not found or v_sub.status <> 'active'
     or v_sub.period_end is null or v_sub.period_end < now() then
    return jsonb_build_object('allowed', false, 'reason', 'no_subscription');
  end if;

  select * into v_plan from public.plans where key = v_sub.plan_key;

  if v_sub.credits_remaining <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'no_credits');
  end if;

  if coalesce(v_plan.daily_credit_cap, 0) > 0 then
    -- les tours remboursés (usage_refund) s'annulent avec leur débit
    select coalesce(-sum(delta), 0) into v_used_today
    from public.credit_ledger
    where user_id = p_user
      and reason in ('usage', 'usage_refund')
      and (created_at at time zone 'Africa/Tunis')::date
          = (now() at time zone 'Africa/Tunis')::date;

    if v_used_today >= v_plan.daily_credit_cap then
      return jsonb_build_object('allowed', false, 'reason', 'daily_cap',
                                'daily_cap', v_plan.daily_credit_cap);
    end if;
  end if;

  update public.subscriptions
     set credits_remaining = credits_remaining - 1
   where user_id = p_user
   returning credits_remaining into v_sub.credits_remaining;

  insert into public.credit_ledger (user_id, delta, reason, balance_after)
  values (p_user, -1, 'usage', v_sub.credits_remaining);

  update public.profiles set last_seen_at = now() where id = p_user;

  return jsonb_build_object(
    'allowed', true,
    'plan', v_sub.plan_key,
    'model_tier', coalesce(v_plan.model_tier, 'standard'),
    'history_messages', coalesce(v_plan.history_messages, 20),
    'credits_remaining', v_sub.credits_remaining
  );
end;
$$;

--  Le tour a échoué (panne du fournisseur): on rend le crédit. La ligne est
--  marquée 'usage_refund' pour qu'elle annule aussi le décompte journalier.
create or replace function public.refund_agent_turn(p_user uuid, p_cause text default 'provider_error')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  update public.subscriptions
     set credits_remaining = credits_remaining + 1
   where user_id = p_user
   returning credits_remaining into v_balance;

  if v_balance is null then
    return null;
  end if;

  insert into public.credit_ledger (user_id, delta, reason, ref_id, balance_after)
  values (p_user, 1, 'usage_refund', p_cause, v_balance);

  return v_balance;
end;
$$;

--  Active (ou prolonge) un abonnement après un paiement confirmé.
--  Appelée par les webhooks Flouci/Stripe et par l'admin.
create or replace function public.grant_subscription(
  p_user        uuid,
  p_plan        text,
  p_provider    text,
  p_external_id text default null,
  p_months      integer default 1
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    public.plans%rowtype;
  v_sub     public.subscriptions%rowtype;
  v_start   timestamptz;
  v_credits integer;
begin
  select * into v_plan from public.plans where key = p_plan;
  if not found then
    raise exception 'plan inconnu: %', p_plan;
  end if;

  select * into v_sub from public.subscriptions where user_id = p_user for update;

  -- Renouvellement avant échéance: on repart de la fin de la période en cours.
  v_start := case
    when v_sub.period_end is not null and v_sub.period_end > now() and v_sub.status = 'active'
    then v_sub.period_end
    else now()
  end;

  v_credits := v_plan.monthly_credits * greatest(p_months, 1);

  insert into public.subscriptions as s (
    user_id, plan_key, status, provider, external_id,
    period_start, period_end, credits_remaining, credits_granted
  )
  values (
    p_user, p_plan, 'active', p_provider, p_external_id,
    v_start, v_start + (p_months || ' months')::interval,
    v_credits, v_credits
  )
  on conflict (user_id) do update set
    plan_key             = excluded.plan_key,
    status               = 'active',
    provider             = excluded.provider,
    external_id          = excluded.external_id,
    period_start         = excluded.period_start,
    period_end           = excluded.period_end,
    credits_remaining    = s.credits_remaining + excluded.credits_remaining,
    credits_granted      = s.credits_granted + excluded.credits_granted,
    cancel_at_period_end = false
  returning * into v_sub;

  insert into public.credit_ledger (user_id, delta, reason, ref_id, balance_after)
  values (p_user, v_credits, 'subscription', p_external_id, v_sub.credits_remaining);

  return v_sub;
end;
$$;

-- Ajustement manuel par l'admin (geste commercial, correction, remboursement).
create or replace function public.admin_adjust_credits(
  p_user   uuid,
  p_delta  integer,
  p_reason text default 'admin_grant'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if not public.is_admin() then
    raise exception 'réservé à l''administrateur';
  end if;

  update public.subscriptions
     set credits_remaining = greatest(credits_remaining + p_delta, 0)
   where user_id = p_user
   returning credits_remaining into v_balance;

  if v_balance is null then
    raise exception 'cet utilisateur n''a pas d''abonnement';
  end if;

  insert into public.credit_ledger (user_id, delta, reason, balance_after)
  values (p_user, p_delta, p_reason, v_balance);

  return v_balance;
end;
$$;

-- À passer en cron quotidien: ferme les abonnements arrivés à échéance.
create or replace function public.expire_subscriptions()
returns integer
language sql
security definer
set search_path = public
as $$
  with done as (
    update public.subscriptions
       set status = 'expired'
     where status = 'active' and period_end is not null and period_end < now()
    returning 1
  )
  select count(*)::integer from done;
$$;

-- ═══════════════════════════════════ vues pour le tableau de bord admin ═══
--  security_invoker: les vues héritent de la RLS, donc un utilisateur normal
--  n'y voit que ses propres lignes et l'admin voit tout le monde.

-- Séances d'app agrégées par jour (temps passé dans l'app).
create or replace view public.v_session_minutes
with (security_invoker = true) as
select
  user_id,
  (started_at at time zone 'Africa/Tunis')::date as day,
  round(sum(
    extract(epoch from (coalesce(ended_at, last_ping_at) - started_at))
  ) / 60.0, 1) as minutes,
  count(*) as sessions
from public.app_sessions
group by 1, 2;

-- Consommation IA agrégée par jour.
create or replace view public.v_usage_daily
with (security_invoker = true) as
select
  user_id,
  (created_at at time zone 'Africa/Tunis')::date as day,
  count(*)                       as turns,
  sum(input_tokens)              as input_tokens,
  sum(output_tokens)             as output_tokens,
  sum(cache_read_tokens)         as cache_read_tokens,
  sum(cost_usd)                  as cost_usd,
  sum(credits_charged)           as credits,
  count(*) filter (where status <> 'ok') as errors
from public.usage_events
group by 1, 2;

-- La ligne principale du tableau de bord: un utilisateur = une ligne.
create or replace view public.admin_user_overview
with (security_invoker = true) as
select
  p.id,
  p.email,
  p.full_name,
  p.role,
  p.status,
  p.created_at,
  p.last_seen_at,
  s.plan_key,
  s.status              as subscription_status,
  s.period_end,
  s.credits_remaining,
  s.credits_granted,
  coalesce(u30.turns, 0)       as turns_30d,
  coalesce(u30.tokens, 0)      as tokens_30d,
  coalesce(u30.cost_usd, 0)    as cost_usd_30d,
  coalesce(uall.cost_usd, 0)   as cost_usd_total,
  coalesce(uall.turns, 0)      as turns_total,
  coalesce(m.minutes_today, 0) as minutes_today,
  coalesce(m.minutes_30d, 0)   as minutes_30d,
  coalesce(m.active_days_30d, 0) as active_days_30d,
  coalesce(t.granted_tools, '{}') as granted_tools
from public.profiles p
left join public.subscriptions s on s.user_id = p.id
left join lateral (
  select count(*) as turns,
         sum(input_tokens + output_tokens) as tokens,
         sum(cost_usd) as cost_usd
  from public.usage_events e
  where e.user_id = p.id and e.created_at > now() - interval '30 days'
) u30 on true
left join lateral (
  select count(*) as turns, sum(cost_usd) as cost_usd
  from public.usage_events e where e.user_id = p.id
) uall on true
left join lateral (
  select
    sum(minutes) filter (where day = (now() at time zone 'Africa/Tunis')::date) as minutes_today,
    sum(minutes) filter (where day > (now() at time zone 'Africa/Tunis')::date - 30) as minutes_30d,
    count(*) filter (where day > (now() at time zone 'Africa/Tunis')::date - 30) as active_days_30d
  from public.v_session_minutes v where v.user_id = p.id
) m on true
left join lateral (
  select array_agg(tool_key order by tool_key) as granted_tools
  from public.user_tools ut where ut.user_id = p.id and ut.status = 'granted'
) t on true;

-- Consommation jour par jour, avec le temps passé dans l'app à côté.
create or replace view public.admin_daily_usage
with (security_invoker = true) as
select
  coalesce(u.user_id, m.user_id) as user_id,
  coalesce(u.day, m.day)         as day,
  coalesce(u.turns, 0)           as turns,
  coalesce(u.input_tokens, 0)    as input_tokens,
  coalesce(u.output_tokens, 0)   as output_tokens,
  coalesce(u.cost_usd, 0)        as cost_usd,
  coalesce(u.errors, 0)          as errors,
  coalesce(m.minutes, 0)         as minutes,
  coalesce(m.sessions, 0)        as sessions
from public.v_usage_daily u
full outer join public.v_session_minutes m
  on u.user_id = m.user_id and u.day = m.day;

-- Quelles « apps » servent vraiment (pour décider quoi ajouter ensuite).
create or replace view public.admin_tool_usage
with (security_invoker = true) as
select
  t.key,
  t.name_ar,
  t.kind,
  t.is_enabled,
  count(distinct ut.user_id) filter (where ut.status = 'granted') as users_granted,
  count(distinct ut.user_id) filter (where ut.status = 'denied')  as users_denied,
  coalesce(c.calls_30d, 0) as calls_30d
from public.tools t
left join public.user_tools ut on ut.tool_key = t.key
left join lateral (
  select count(*) as calls_30d
  from public.usage_events e
  where t.key = any (e.tools_used) and e.created_at > now() - interval '30 days'
) c on true
group by t.key, t.name_ar, t.kind, t.is_enabled, c.calls_30d;

-- Revenu encaissé par mois et par fournisseur de paiement.
create or replace view public.admin_revenue_monthly
with (security_invoker = true) as
select
  date_trunc('month', created_at at time zone 'Africa/Tunis')::date as month,
  provider,
  currency,
  count(*)      as payments,
  sum(amount)   as total
from public.payments
where status = 'paid'
group by 1, 2, 3
order by 1 desc;

-- ─────────────────────────────────── mémoire de l'assistant (outil serveur) ─
--  Les notes vivent côté serveur pour que l'agent les retrouve depuis
--  n'importe quel appareil, contrairement à l'agenda ou aux contacts qui
--  restent sur le téléphone.
create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  text       text not null,
  tags       text[] not null default '{}',
  done       boolean not null default false,
  due_at     timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_user_idx on public.notes (user_id, created_at desc);

create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

alter table public.notes enable row level security;

create policy notes_own on public.notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════ privilèges ══════
--  La RLS filtre les lignes; les GRANT décident qui peut toucher la table.
--  Le service_role (Edge Functions) contourne la RLS: c'est lui qui débite
--  les crédits et écrit la consommation.

grant select on public.plans, public.tools to anon, authenticated;

grant select on
  public.profiles, public.subscriptions, public.credit_ledger,
  public.payments, public.usage_events, public.model_prices,
  public.v_usage_daily, public.v_session_minutes,
  public.admin_user_overview, public.admin_daily_usage,
  public.admin_tool_usage, public.admin_revenue_monthly
to authenticated;

grant update on public.profiles to authenticated;

grant select, insert, update, delete on
  public.conversations, public.messages, public.notes,
  public.user_tools, public.app_sessions
to authenticated;

grant insert, update, delete on
  public.plans, public.tools, public.subscriptions, public.credit_ledger,
  public.payments, public.model_prices
to authenticated;   -- utilisable seulement par l'admin: la RLS bloque les autres

grant usage on all sequences in schema public to authenticated;

revoke execute on function public.begin_agent_turn(uuid)   from public, anon, authenticated;
revoke execute on function public.refund_agent_turn(uuid, text) from public, anon, authenticated;
revoke execute on function public.grant_subscription(uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.expire_subscriptions() from public, anon, authenticated;

grant execute on function public.admin_adjust_credits(uuid, integer, text) to authenticated;
grant execute on function public.is_admin() to authenticated;
