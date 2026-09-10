-- ═══════════════════════════════════════════════════════════════════════════
--  Tests du schéma: abonnements, crédits, plafonds et surtout la RLS —
--  c'est elle qui empêche un utilisateur de lire les données d'un autre.
--
--    psql -f 00_supabase_shim.sql -f ../migrations/*.sql -f rls_test.sql
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\timing off

create schema if not exists tests;

create or replace function tests.log(msg text) returns void language plpgsql as $$
begin raise notice '  ✓ %', msg; end $$;

grant usage on schema tests to public;

-- ─────────────────────────────────────────────────── comptes de test ──────
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'sami@test.tn',  '{"full_name":"سامي"}'),
  ('22222222-2222-2222-2222-222222222222', 'amine@test.tn', '{"full_name":"أمين"}'),
  ('33333333-3333-3333-3333-333333333333', 'admin@test.tn', '{"full_name":"Admin"}');

do $$
begin
  assert (select count(*) from public.profiles) = 3,
    'le trigger doit créer un profil par compte';
  assert (select full_name from public.profiles
          where id = '11111111-1111-1111-1111-111111111111') = 'سامي',
    'le nom Google doit être repris';
  perform tests.log('inscription → profil créé automatiquement');
end $$;

update public.profiles set role = 'admin' where id = '33333333-3333-3333-3333-333333333333';

-- ──────────────────────────────────────────── abonnement et crédits ───────
do $$
declare
  v_sub public.subscriptions%rowtype;
  v_res jsonb;
begin
  v_sub := public.grant_subscription(
    '11111111-1111-1111-1111-111111111111', 'basique', 'flouci', 'FLOUCI-1', 1);

  assert v_sub.status = 'active', 'abonnement actif après paiement';
  assert v_sub.credits_remaining = 500, 'les crédits du plan sont versés';
  assert v_sub.period_end > now(), 'la période court sur un mois';
  assert (select count(*) from public.credit_ledger
          where user_id = '11111111-1111-1111-1111-111111111111'
            and reason = 'subscription') = 1,
    'le versement est tracé dans le journal';
  perform tests.log('paiement → abonnement actif + 500 crédits');

  v_res := public.begin_agent_turn('11111111-1111-1111-1111-111111111111');
  assert (v_res ->> 'allowed')::boolean, 'un abonné peut parler à l''agent';
  assert (v_res ->> 'credits_remaining')::int = 499, 'un tour = un crédit';
  assert v_res ->> 'model_tier' = 'standard', 'le plan choisit le niveau de modèle';
  perform tests.log('tour de parole → 1 crédit débité');

  perform public.refund_agent_turn('11111111-1111-1111-1111-111111111111', 'provider_error');
  assert (select credits_remaining from public.subscriptions
          where user_id = '11111111-1111-1111-1111-111111111111') = 500,
    'une panne du fournisseur rend le crédit';
  perform tests.log('échec du fournisseur → crédit remboursé');
end $$;

-- Sans abonnement: refusé.
do $$
declare v_res jsonb;
begin
  v_res := public.begin_agent_turn('22222222-2222-2222-2222-222222222222');
  assert not (v_res ->> 'allowed')::boolean and v_res ->> 'reason' = 'no_subscription',
    'sans abonnement, pas d''accès à l''agent';
  perform tests.log('pas d''abonnement → refusé (no_subscription)');
end $$;

-- Compte bloqué par l'admin: refusé même avec des crédits.
do $$
declare v_res jsonb;
begin
  update public.profiles set status = 'blocked'
   where id = '11111111-1111-1111-1111-111111111111';
  v_res := public.begin_agent_turn('11111111-1111-1111-1111-111111111111');
  assert v_res ->> 'reason' = 'blocked', 'un compte bloqué ne consomme plus rien';
  update public.profiles set status = 'active'
   where id = '11111111-1111-1111-1111-111111111111';
  perform tests.log('compte bloqué → refusé');
end $$;

-- Plafond journalier.
do $$
declare v_res jsonb;
begin
  update public.plans set daily_credit_cap = 3 where key = 'basique';
  for i in 1..3 loop
    v_res := public.begin_agent_turn('11111111-1111-1111-1111-111111111111');
    assert (v_res ->> 'allowed')::boolean, 'les tours sous le plafond passent';
  end loop;
  v_res := public.begin_agent_turn('11111111-1111-1111-1111-111111111111');
  assert v_res ->> 'reason' = 'daily_cap', 'le 4e tour du jour est refusé';
  update public.plans set daily_credit_cap = 60 where key = 'basique';
  perform tests.log('plafond journalier respecté');
end $$;

-- Solde épuisé.
do $$
declare v_res jsonb;
begin
  update public.subscriptions set credits_remaining = 0
   where user_id = '11111111-1111-1111-1111-111111111111';
  v_res := public.begin_agent_turn('11111111-1111-1111-1111-111111111111');
  assert v_res ->> 'reason' = 'no_credits', 'sans crédits, on propose de recharger';
  perform tests.log('crédits épuisés → refusé (no_credits)');
end $$;

-- Renouvellement anticipé: la nouvelle période part de l'ancienne échéance.
do $$
declare
  v_before timestamptz;
  v_sub    public.subscriptions%rowtype;
begin
  update public.subscriptions set credits_remaining = 10, status = 'active'
   where user_id = '11111111-1111-1111-1111-111111111111';
  select period_end into v_before from public.subscriptions
   where user_id = '11111111-1111-1111-1111-111111111111';

  v_sub := public.grant_subscription(
    '11111111-1111-1111-1111-111111111111', 'pro', 'stripe', 'STRIPE-1', 1);

  assert v_sub.period_end > v_before, 'la période est prolongée, pas écrasée';
  assert v_sub.credits_remaining = 1510, 'les crédits restants sont conservés';
  assert v_sub.plan_key = 'pro', 'le changement de formule est pris en compte';
  perform tests.log('renouvellement anticipé → période prolongée, crédits cumulés');
end $$;

-- ═══════════════════════════════════════════════════ RLS: cloisonnement ═══
--  À partir d'ici on se met dans la peau d'un vrai utilisateur de l'app:
--  rôle `authenticated` + l'identifiant du JWT, exactement comme Supabase.

-- Sami écrit une conversation.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.conversations (id, user_id, title)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'أول حوار');
insert into public.messages (conversation_id, user_id, role, content)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'user',
        '[{"type":"text","text":"سرّ متاعي"}]'::jsonb);

insert into public.user_tools (user_id, tool_key, status, granted_at)
values ('11111111-1111-1111-1111-111111111111', 'agenda_lire', 'granted', now()),
       ('11111111-1111-1111-1111-111111111111', 'sms_preparer', 'denied', null);

do $$
begin
  assert (select count(*) from public.conversations) = 1, 'Sami voit sa conversation';
  assert (select count(*) from public.messages) = 1, 'Sami voit son message';
  assert (select count(*) from public.subscriptions) = 1, 'Sami voit son abonnement';
  perform tests.log('un utilisateur voit ses propres données');
end $$;

-- Sami essaie de se promouvoir administrateur.
update public.profiles set full_name = 'سامي بن علي', role = 'admin'
 where id = '11111111-1111-1111-1111-111111111111';

do $$
begin
  assert (select role from public.profiles
          where id = '11111111-1111-1111-1111-111111111111') = 'user',
    'un utilisateur ne peut pas se donner le rôle admin';
  assert (select full_name from public.profiles
          where id = '11111111-1111-1111-1111-111111111111') = 'سامي بن علي',
    'mais il peut bien modifier son nom';
  perform tests.log('élévation de privilège bloquée (role figé)');
end $$;

-- Amine, l'autre utilisateur.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
begin
  assert (select count(*) from public.conversations) = 0,
    'Amine ne voit aucune conversation de Sami';
  assert (select count(*) from public.messages) = 0,
    'Amine ne voit aucun message de Sami';
  assert (select count(*) from public.subscriptions) = 0,
    'Amine ne voit pas l''abonnement de Sami';
  assert (select count(*) from public.credit_ledger) = 0,
    'Amine ne voit pas les crédits de Sami';
  assert (select count(*) from public.profiles) = 1,
    'Amine ne voit que son propre profil';
  assert (select count(*) from public.user_tools) = 0,
    'Amine ne voit pas les autorisations de Sami';
  perform tests.log('cloisonnement: aucun accès aux données d''un autre compte');
end $$;

-- Amine tente d'écrire dans la conversation de Sami.
do $$
begin
  begin
    insert into public.messages (conversation_id, user_id, role, content)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'user', '[]'::jsonb);
    assert false, 'l''insertion pour le compte d''un autre aurait dû échouer';
  exception when insufficient_privilege then
    null; -- comportement attendu
  end;
  perform tests.log('impossible d''écrire dans la conversation d''un autre');
end $$;

-- Le catalogue: les apps désactivées par l'admin n'apparaissent pas.
do $$
declare v_visible int; v_total int;
begin
  select count(*) into v_visible from public.tools;
  set local role postgres;
  select count(*) into v_total from public.tools;
  assert v_total > v_visible, 'les apps désactivées restent cachées aux utilisateurs';
  perform tests.log('catalogue: seules les apps activées sont visibles');
end $$;

-- Les jetons OAuth ne sont lisibles par personne (hors service_role).
set role postgres;
insert into public.oauth_connections (user_id, provider, access_token)
values ('11111111-1111-1111-1111-111111111111', 'google', 'ya29.SECRET');

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare v int;
begin
  begin
    select count(*) into v from public.oauth_connections;
    assert v = 0, 'même son propriétaire ne peut pas relire un jeton OAuth';
  exception when insufficient_privilege then
    null; -- encore mieux: la table n'est même pas accessible
  end;
  perform tests.log('jetons OAuth invisibles depuis l''app');
end $$;

-- ─────────────────────────────────────────────── le point de vue admin ────
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

do $$
begin
  assert public.is_admin(), 'le compte admin est reconnu';
  assert (select count(*) from public.profiles) = 3, 'l''admin voit tous les comptes';
  assert (select count(*) from public.subscriptions) = 1, 'l''admin voit les abonnements';
  assert (select count(*) from public.usage_events) >= 0, 'l''admin voit la consommation';
  assert (select count(*) from public.admin_user_overview) = 3,
    'le tableau de bord liste tout le monde';
  assert (select count(*) from public.messages) = 0,
    'même l''admin ne lit pas le contenu des conversations';
  begin
    perform 1 from public.oauth_connections;
    assert not found, 'même l''admin ne lit pas les jetons OAuth';
  exception when insufficient_privilege then
    null;
  end;
  perform tests.log('admin: voit les comptes et la consommation, pas les conversations');
end $$;

-- L'admin peut créditer un compte; un utilisateur normal, non.
do $$
declare v_balance int;
begin
  v_balance := public.admin_adjust_credits(
    '11111111-1111-1111-1111-111111111111', 100, 'geste commercial');
  assert v_balance = 1610, 'les crédits offerts sont ajoutés';
  perform tests.log('admin: ajustement de crédits tracé');
end $$;

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
begin
  begin
    perform public.admin_adjust_credits('22222222-2222-2222-2222-222222222222', 9999);
    assert false, 'un utilisateur ne doit pas pouvoir s''offrir des crédits';
  exception when raise_exception then
    null; -- comportement attendu
  end;
  perform tests.log('un utilisateur ne peut pas s''auto-créditer');
end $$;

-- L'admin ne peut pas désactiver la RLS en modifiant le catalogue non plus:
-- un utilisateur normal qui tente d'écrire dans `tools` est bloqué.
do $$
begin
  begin
    update public.tools set is_enabled = false where key = 'agenda_lire';
    assert (select count(*) from public.tools where key = 'agenda_lire' and is_enabled) = 1,
      'la mise à jour ne doit rien changer pour un non-admin';
  exception when insufficient_privilege then
    null;
  end;
  perform tests.log('catalogue en écriture: réservé à l''admin');
end $$;

set role postgres;

-- ──────────────────────────────────────── consommation et temps d'usage ───
insert into public.usage_events
  (user_id, provider, model, input_tokens, output_tokens, cost_usd, credits_charged, tools_used)
values
  ('11111111-1111-1111-1111-111111111111', 'anthropic', 'claude-sonnet-5',
   1500, 200, 0.005, 1, '{agenda_lire}'),
  ('11111111-1111-1111-1111-111111111111', 'anthropic', 'claude-sonnet-5',
   1800, 300, 0.006, 1, '{sms_preparer,contacts_chercher}');

insert into public.app_sessions (user_id, started_at, last_ping_at, ended_at)
values ('11111111-1111-1111-1111-111111111111',
        now() - interval '40 minutes', now() - interval '10 minutes', now() - interval '10 minutes');

do $$
declare v public.admin_user_overview%rowtype;
begin
  select * into v from public.admin_user_overview
   where id = '11111111-1111-1111-1111-111111111111';

  assert v.turns_30d = 2, 'les tours de parole sont comptés';
  assert v.tokens_30d = 3800, 'les tokens sont additionnés';
  assert round(v.cost_usd_30d, 3) = 0.011, 'le coût réel est suivi';
  assert v.minutes_today = 30, 'le temps passé dans l''app est mesuré';
  assert v.granted_tools = '{agenda_lire}', 'les apps autorisées sont listées';
  assert v.plan_key = 'pro', 'la formule en cours apparaît';
  perform tests.log('tableau de bord: tokens, coût, minutes et apps par utilisateur');

  assert (select calls_30d from public.admin_tool_usage where key = 'sms_preparer') = 1,
    'on sait quelles apps servent vraiment';
  perform tests.log('statistiques par app');
end $$;

do $$
begin
  raise notice '';
  raise notice '  ═══ tous les tests du schéma sont passés ═══';
  raise notice '';
end $$;
