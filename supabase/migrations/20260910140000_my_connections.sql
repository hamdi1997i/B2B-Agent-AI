-- ═══════════════════════════════════════════════════════════════════════════
--  L'app a besoin de savoir si le compte Google est relié, sans jamais
--  pouvoir lire le jeton.
--
--  La table `oauth_connections` reste fermée à tout le monde. Cette vue
--  n'expose que le nécessaire (le fournisseur et les accès accordés) et,
--  comme elle s'exécute avec les droits de son propriétaire, elle filtre
--  elle-même sur l'utilisateur connecté.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.my_oauth_connections
with (security_invoker = false) as
select
  provider,
  scopes,
  created_at,
  updated_at
from public.oauth_connections
where user_id = auth.uid();

grant select on public.my_oauth_connections to authenticated;
