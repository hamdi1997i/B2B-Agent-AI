-- ═══════════════════════════════════════════════════════════════════════════
--  Données de départ: formules, catalogue d'apps et tarifs des modèles.
--  Tout est modifiable ensuite depuis le tableau de bord admin.
-- ═══════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────── formules ──────
insert into public.plans
  (key, name_ar, name_fr, description_ar, price_dt, price_usd,
   monthly_credits, daily_credit_cap, model_tier, history_messages, sort)
values
  ('basique', 'أساسي',  'Basique', 'للاستعمال اليومي العادي',        15.000,  9.00,  500, 60,  'standard', 16, 1),
  ('pro',     'برو',    'Pro',     'استعمال كثيف + أجوبة أذكى',      30.000, 19.00, 1500, 150, 'advanced', 24, 2),
  ('max',     'ماكس',   'Max',     'بلا حدود تقريبًا، للمحترفين',    60.000, 39.00, 5000, 400, 'advanced', 32, 3)
on conflict (key) do nothing;

-- ─────────────────────────────────────────────── tarifs des modèles ───────
--  Sert à calculer le coût réel de chaque tour de parole. À mettre à jour
--  quand les tarifs des fournisseurs changent.
insert into public.model_prices
  (provider, model, input_usd_per_mtok, output_usd_per_mtok,
   cache_read_usd_per_mtok, cache_write_usd_per_mtok)
values
  ('anthropic', 'claude-opus-5',  5.00, 25.00, 0.50, 6.25),
  ('anthropic', 'claude-sonnet-5', 2.00, 10.00, 0.20, 2.50),
  ('anthropic', 'claude-haiku-4-5', 1.00,  5.00, 0.10, 1.25)
on conflict (provider, model) do update set
  input_usd_per_mtok  = excluded.input_usd_per_mtok,
  output_usd_per_mtok = excluded.output_usd_per_mtok,
  updated_at          = now();

-- ──────────────────────────────────────────── catalogue des « apps » ──────
--  kind = device: le téléphone exécute; server: l'Edge Function exécute;
--  oauth: l'Edge Function exécute avec le compte connecté par l'utilisateur.
insert into public.tools
  (key, name_ar, name_fr, description_ar, kind, icon, android_permissions,
   oauth_provider, oauth_scopes, requires_consent, is_enabled, min_plan,
   model_description, input_schema, sort)
values

('agenda_lire', 'الروزنامة — قراية', 'Agenda (lecture)',
 'يقرا المواعيد متاعك من روزنامة التليفون.', 'device', '📅',
 '{android.permission.READ_CALENDAR}', null, '{}', true, true, null,
 'Lire les rendez-vous de l''agenda du téléphone sur une période. « شنوة عندي اليوم؟ »، « واش عندي مواعيد غدوة؟ »',
 '{"type":"object","properties":{"du":{"type":"string","description":"YYYY-MM-DD"},"au":{"type":"string","description":"YYYY-MM-DD"}}}'::jsonb, 1),

('agenda_ajouter', 'الروزنامة — كتبة', 'Agenda (écriture)',
 'يزيد موعد جديد في الروزنامة.', 'device', '🗓️',
 '{android.permission.WRITE_CALENDAR}', null, '{}', true, true, null,
 'Créer un rendez-vous dans l''agenda du téléphone. « حط لي موعد مع الطبيب نهار الخميس مع 3 »',
 '{"type":"object","properties":{"titre":{"type":"string"},"debut":{"type":"string","description":"YYYY-MM-DDTHH:mm"},"duree_minutes":{"type":"number"},"lieu":{"type":"string"},"note":{"type":"string"}},"required":["titre","debut"]}'::jsonb, 2),

('rappel', 'تذكير', 'Rappel',
 'يحط تذكير/منبّه في التليفون.', 'device', '⏰',
 '{}', null, '{}', true, true, null,
 'Programmer un rappel ou une alarme sur le téléphone. « ذكّرني غدوة مع 10 نكلم محمد »',
 '{"type":"object","properties":{"titre":{"type":"string"},"quand":{"type":"string","description":"YYYY-MM-DDTHH:mm"}},"required":["titre","quand"]}'::jsonb, 3),

('contacts_chercher', 'الرقيمات', 'Contacts',
 'يلوّج على نمرة في رقيمات التليفون.', 'device', '👤',
 '{android.permission.READ_CONTACTS}', null, '{}', true, true, null,
 'Chercher un contact par nom dans le répertoire du téléphone, pour obtenir son numéro.',
 '{"type":"object","properties":{"nom":{"type":"string"}},"required":["nom"]}'::jsonb, 4),

('sms_preparer', 'رسالة SMS', 'SMS',
 'يحضّر رسالة ويحلّ تطبيق الرسائل — أنت اللي تأكّد الإرسال.', 'device', '💬',
 '{}', null, '{}', true, true, null,
 'Préparer un SMS: le message s''ouvre dans l''app de messagerie et l''utilisateur confirme l''envoi lui-même. Ne jamais affirmer que le message est parti.',
 '{"type":"object","properties":{"numero":{"type":"string"},"nom":{"type":"string"},"message":{"type":"string"}},"required":["message"]}'::jsonb, 5),

('appel', 'مكالمة', 'Appel',
 'يحضّر المكالمة ويحلّ الclavier — أنت اللي تعيّط.', 'device', '📞',
 '{}', null, '{}', true, true, null,
 'Ouvrir le composeur téléphonique avec un numéro pré-rempli. L''utilisateur lance l''appel lui-même.',
 '{"type":"object","properties":{"numero":{"type":"string"},"nom":{"type":"string"}},"required":["numero"]}'::jsonb, 6),

('notes', 'النوتة', 'Notes',
 'يكتب ويقرا النوتات متاعك (محفوظة في الحساب).', 'server', '📝',
 '{}', null, '{}', false, true, null,
 'Écrire, lire, chercher et cocher les notes et pense-bêtes de l''utilisateur. Mémoire persistante de l''assistant.',
 '{"type":"object","properties":{"action":{"type":"string","enum":["ajouter","lister","chercher","terminer","supprimer"]},"texte":{"type":"string"},"note_id":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}}},"required":["action"]}'::jsonb, 7),

('recherche_web', 'البحث في الويب', 'Recherche web',
 'يلوّج في الإنترنت ويجيبلك الجواب.', 'server', '🌐',
 '{}', null, '{}', true, true, 'pro',
 'Rechercher sur le web des informations à jour (prix, horaires, actualités, définitions).',
 '{"type":"object","properties":{"requete":{"type":"string"}},"required":["requete"]}'::jsonb, 8),

('google_agenda', 'Google Agenda', 'Google Agenda',
 'يوصل بالروزنامة متاع Google.', 'oauth', '📆',
 '{}', 'google', '{https://www.googleapis.com/auth/calendar.events}', true, false, null,
 'Lire et créer des événements dans Google Agenda du compte connecté.',
 '{"type":"object","properties":{"action":{"type":"string","enum":["lister","ajouter"]},"titre":{"type":"string"},"debut":{"type":"string"},"fin":{"type":"string"}},"required":["action"]}'::jsonb, 9),

('google_drive', 'Google Drive', 'Google Drive',
 'يلوّج ويقرا الملفات متاع Drive.', 'oauth', '📂',
 '{}', 'google', '{https://www.googleapis.com/auth/drive.file}', true, false, null,
 'Chercher et lire les fichiers que l''utilisateur a partagés avec l''app dans Google Drive.',
 '{"type":"object","properties":{"action":{"type":"string","enum":["chercher","lire"]},"requete":{"type":"string"},"file_id":{"type":"string"}},"required":["action"]}'::jsonb, 10),

('gmail', 'Gmail', 'Gmail',
 'يقرا ويحضّر الإيمايلات.', 'oauth', '✉️',
 '{}', 'google', '{https://www.googleapis.com/auth/gmail.modify}', true, false, 'pro',
 'Lire les derniers e-mails et préparer un brouillon de réponse. L''envoi demande toujours une confirmation.',
 '{"type":"object","properties":{"action":{"type":"string","enum":["lister","lire","brouillon"]},"requete":{"type":"string"},"message_id":{"type":"string"},"a":{"type":"string"},"objet":{"type":"string"},"corps":{"type":"string"}},"required":["action"]}'::jsonb, 11)

on conflict (key) do nothing;
