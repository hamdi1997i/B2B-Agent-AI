-- ═══════════════════════════════════════════════════════════════════════════
--  Correctif de cloisonnement.
--
--  L'ancienne policy ne vérifiait que `user_id = auth.uid()`. Un compte qui
--  devinait l'identifiant d'une conversation pouvait donc y insérer un
--  message signé de son propre nom: il ne pouvait pas le relire, mais le
--  texte serait remonté au modèle lors du tour suivant du propriétaire —
--  une injection de prompt dans la session de quelqu'un d'autre.
--
--  On exige maintenant que la conversation appartienne aussi à l'appelant.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists messages_own on public.messages;

create policy messages_own on public.messages
  for all
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );
