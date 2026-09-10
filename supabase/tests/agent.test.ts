/**
 * Tests de la fonction `agent`, sur une vraie base PostgreSQL et un faux
 * fournisseur d'IA. Ils couvrent le chemin complet: droit de parler,
 * crédits, apps autorisées, outils serveur, main passée au téléphone,
 * traçabilité de la consommation.
 *
 *   PG_TEST_URL=postgres://... node --test supabase/tests/*.test.ts
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fakeSupabase } from './fake_supabase.ts';
import { FakeProvider, call, text } from './fake_provider.ts';
import { setServiceClient } from '../functions/_shared/db.ts';
import { setProvider } from '../functions/_shared/llm/index.ts';
import { handler } from '../functions/agent/handler.ts';
import { toolDefs, webSearchAllowed, isUsable, pendingConsents } from '../functions/_shared/tools.ts';
import type { CatalogueEntry } from '../functions/_shared/tools.ts';
import { computeCost } from '../functions/_shared/cost.ts';
import { systemPrompt, tunisToday, addDays } from '../functions/_shared/prompt.ts';

const URL_DB = process.env.PG_TEST_URL ?? 'postgres://postgres@/maawen?host=/tmp&port=5433';
const SAMI = '11111111-1111-1111-1111-111111111111';

let db: ReturnType<typeof fakeSupabase>;
let provider: FakeProvider;

function post(body: unknown, token = SAMI): Request {
  return new Request('http://localhost/agent', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function sql(query: string, params: unknown[] = []) {
  const res = await db.pool.query(query, params);
  return res.rows;
}

before(() => {
  db = fakeSupabase(URL_DB);
  setServiceClient(db as never);
});

after(async () => {
  await db.pool.end();
});

beforeEach(async () => {
  // Base repartie de zéro pour chaque test: schéma + données de départ.
  execFileSync('bash', ['supabase/tests/reset.sh'], { stdio: 'pipe' });
  await sql(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, 'sami@test.tn', '{"full_name":"سامي"}'::jsonb)`,
    [SAMI],
  );
  provider = new FakeProvider();
  setProvider(provider);
});

async function subscribe(plan = 'basique') {
  await sql(`select public.grant_subscription($1, $2, 'flouci', 'TEST-1', 1)`, [SAMI, plan]);
}

async function grantTools(...keys: string[]) {
  for (const key of keys) {
    await sql(
      `insert into public.user_tools (user_id, tool_key, status, granted_at)
       values ($1, $2, 'granted', now())
       on conflict (user_id, tool_key) do update set status = 'granted'`,
      [SAMI, key],
    );
  }
}

describe('agent — droit de parler', () => {
  it('refuse un compte sans abonnement', async () => {
    const res = await handler(post({ message: 'أهلا' }));
    const body = await res.json();

    assert.equal(res.status, 402);
    assert.equal(body.reason, 'no_subscription');
    assert.equal(provider.calls.length, 0, 'aucun appel payant au fournisseur');
  });

  it('refuse un jeton invalide', async () => {
    const res = await handler(post({ message: 'أهلا' }, '99999999-9999-9999-9999-999999999999'));
    assert.equal(res.status, 401);
  });

  it('débite un crédit par tour de parole', async () => {
    await subscribe();
    provider.script_({ blocks: [text('أهلا بيك، شنوّة نعملك؟')] });

    const res = await handler(post({ message: 'أهلا' }));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.status, 'complete');
    assert.equal(body.reply, 'أهلا بيك، شنوّة نعملك؟');
    assert.equal(body.credits_remaining, 499);

    const [sub] = await sql('select credits_remaining from public.subscriptions where user_id = $1', [SAMI]);
    assert.equal(sub.credits_remaining, 499);
  });
});

describe('agent — mémoire et traçabilité', () => {
  it('enregistre la conversation et la consommation', async () => {
    await subscribe();
    provider.script_({ blocks: [text('سجّلتها.')] });

    const body = await (await handler(post({ message: 'عندي رونديفو غدوة' }))).json();

    const messages = await sql('select role, content from public.messages order by id');
    assert.equal(messages.length, 2, 'le message de l’utilisateur et la réponse sont gardés');
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].role, 'assistant');

    const [usage] = await sql('select * from public.usage_events');
    assert.equal(usage.user_id, SAMI);
    assert.equal(usage.model, 'claude-sonnet-5', 'le modèle vient du niveau de la formule');
    assert.equal(usage.input_tokens, 1200);
    assert.ok(Number(usage.cost_usd) > 0, 'le coût réel est calculé depuis les tarifs en base');
    assert.equal(usage.credits_charged, 1);

    const [conv] = await sql('select title from public.conversations');
    assert.equal(conv.title, 'عندي رونديفو غدوة');
    assert.ok(body.conversation_id);
  });

  it('renvoie l’historique au modèle au tour suivant', async () => {
    await subscribe();
    provider.script_({ blocks: [text('أهلا.')] }, { blocks: [text('إيه، سمعتك.')] });

    const first = await (await handler(post({ message: 'أهلا' }))).json();
    await handler(post({ conversation_id: first.conversation_id, message: 'واش سمعتني؟' }));

    const second = provider.calls[1];
    assert.equal(second.messages.length, 3, 'user + assistant + user');
    assert.equal(second.messages[0].blocks[0].type, 'text');
  });
});

describe('agent — les apps', () => {
  it('ne propose au modèle que les apps autorisées', async () => {
    await subscribe();
    await grantTools('agenda_lire');
    provider.script_({ blocks: [text('ok')] });

    await handler(post({ message: 'شنوة عندي؟' }));

    const names = provider.calls[0].tools.map((t) => t.name);
    assert.ok(names.includes('agenda_lire'), 'l’app autorisée est proposée');
    assert.ok(names.includes('notes'), 'les apps sans consentement sont toujours là');
    assert.ok(!names.includes('contacts_chercher'), 'une app non autorisée reste invisible');
    assert.equal(provider.calls[0].webSearch, false, 'recherche web non autorisée ici');
  });

  it('exécute une app serveur et repasse le résultat au modèle', async () => {
    await subscribe();
    provider.script_(
      { blocks: [call('notes', { action: 'ajouter', texte: 'نشري خبز' })] },
      { blocks: [text('سجّلتها في النوتة.')] },
    );

    const body = await (await handler(post({ message: 'اعمل note نشري خبز' }))).json();

    assert.equal(body.status, 'complete');
    assert.equal(body.reply, 'سجّلتها في النوتة.');

    const notes = await sql('select text from public.notes where user_id = $1', [SAMI]);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, 'نشري خبز');

    const secondCall = provider.calls[1];
    const lastBlocks = secondCall.messages.at(-1).blocks;
    assert.equal(lastBlocks[0].type, 'tool_result', 'le modèle reçoit le résultat de l’app');

    const events = await sql('select tools_used from public.usage_events order by id');
    assert.deepEqual(events.at(-1).tools_used, ['notes']);
  });

  it('rend la main au téléphone pour les apps du téléphone, sans reprendre un crédit', async () => {
    await subscribe();
    await grantTools('agenda_lire');
    provider.script_(
      { blocks: [call('agenda_lire', { du: '2026-09-11', au: '2026-09-11' }, 'tu_ag')] },
      { blocks: [text('عندك موعد وحيد مع الطبيب مع 3.')] },
    );

    const first = await (await handler(post({ message: 'شنوة عندي غدوة؟' }))).json();

    assert.equal(first.status, 'needs_device');
    assert.deepEqual(first.device_calls, [
      { call_id: 'tu_ag', tool: 'agenda_lire', input: { du: '2026-09-11', au: '2026-09-11' } },
    ]);
    assert.equal(first.credits_remaining, 499);

    const second = await (
      await handler(
        post({
          conversation_id: first.conversation_id,
          device_results: [{ call_id: 'tu_ag', output: { events: [{ titre: 'طبيب', heure: '15:00' }] } }],
        }),
      )
    ).json();

    assert.equal(second.status, 'complete');
    assert.equal(second.reply, 'عندك موعد وحيد مع الطبيب مع 3.');

    const [sub] = await sql('select credits_remaining from public.subscriptions where user_id = $1', [SAMI]);
    assert.equal(sub.credits_remaining, 499, 'la reprise fait partie du même tour de parole');
  });

  it('donne la recherche web seulement aux formules qui y ont droit', async () => {
    await subscribe('pro');
    await grantTools('recherche_web');
    provider.script_({ blocks: [text('ok')] });

    await handler(post({ message: 'قداش سعر الذهب اليوم؟' }));

    assert.equal(provider.calls[0].webSearch, true);
    const names = provider.calls[0].tools.map((t) => t.name);
    assert.ok(!names.includes('recherche_web'), 'outil hébergé: pas déclaré comme app cliente');
  });

  it('bloque une app réservée à une formule supérieure', async () => {
    await subscribe('basique');
    await grantTools('recherche_web');
    provider.script_({ blocks: [text('ok')] });

    await handler(post({ message: 'لوّج لي' }));

    assert.equal(provider.calls[0].webSearch, false, 'formule basique: pas de recherche web');
  });
});

describe('agent — pannes', () => {
  it('rembourse le crédit quand le fournisseur tombe', async () => {
    await subscribe();
    provider.fail(new Error('503 upstream'));

    const res = await handler(post({ message: 'أهلا' }));
    assert.equal(res.status, 502);

    const [sub] = await sql('select credits_remaining from public.subscriptions where user_id = $1', [SAMI]);
    assert.equal(sub.credits_remaining, 500, 'le crédit est rendu');

    const [usage] = await sql(`select status, error from public.usage_events`);
    assert.equal(usage.status, 'error');
    assert.match(usage.error, /503/);
  });
});

describe('unités', () => {
  const entry = (over: Partial<CatalogueEntry>): CatalogueEntry => ({
    key: 'x',
    name_ar: 'x',
    kind: 'device',
    icon: null,
    android_permissions: [],
    oauth_provider: null,
    requires_consent: true,
    min_plan: null,
    model_description: 'd',
    input_schema: { type: 'object' },
    prompt_hint: null,
    consent: null,
    available: true,
    connected: true,
    ...over,
  });

  it('le consentement décide de l’usage d’une app', () => {
    assert.equal(isUsable(entry({ consent: 'granted' })), true);
    assert.equal(isUsable(entry({ consent: 'denied' })), false);
    assert.equal(isUsable(entry({ consent: null })), false);
    assert.equal(isUsable(entry({ consent: null, requires_consent: false })), true);
    assert.equal(isUsable(entry({ consent: 'granted', available: false })), false);
    assert.equal(
      isUsable(entry({ kind: 'oauth', consent: 'granted', connected: false })),
      false,
      'une app Google non reliée reste inutilisable',
    );
  });

  it('les apps nouvellement activées attendent une réponse', () => {
    const list = [entry({ key: 'a', consent: 'granted' }), entry({ key: 'b' })];
    assert.deepEqual(pendingConsents(list).map((e) => e.key), ['b']);
  });

  it('calcule le coût à partir des tarifs', () => {
    const cost = computeCost(
      { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_tokens: 0, cache_write_tokens: 0 },
      { input_usd_per_mtok: 2, output_usd_per_mtok: 10, cache_read_usd_per_mtok: 0.2, cache_write_usd_per_mtok: 2.5 },
    );
    assert.equal(cost, 3); // 2 $ + 1 $
    assert.equal(computeCost({ input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }, null), 0);
  });

  it('le prompt donne la date de Tunis et les apps disponibles', () => {
    const now = new Date('2026-09-10T09:00:00Z');
    const prompt = systemPrompt({
      fullName: 'سامي',
      now,
      catalogue: [entry({ key: 'agenda_lire', name_ar: 'الروزنامة', consent: 'granted', icon: '📅' })],
    });
    assert.match(prompt, /سامي/);
    assert.match(prompt, /2026-09-10/);
    assert.match(prompt, /الروزنامة/);
    assert.equal(addDays(tunisToday(now), 1), '2026-09-11');
  });
});
