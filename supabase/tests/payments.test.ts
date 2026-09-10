/**
 * Tests du parcours d'abonnement: création du paiement, webhooks Flouci et
 * Stripe, et surtout ce qu'un attaquant ne doit PAS pouvoir faire —
 * s'activer un abonnement avec un faux webhook.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fakeSupabase } from './fake_supabase.ts';
import { setServiceClient } from '../functions/_shared/db.ts';
import { handler as checkout } from '../functions/checkout/handler.ts';
import { handler as flouciWebhook } from '../functions/flouci-webhook/handler.ts';
import { handler as stripeWebhook } from '../functions/stripe-webhook/handler.ts';
import { verifyWebhook } from '../functions/_shared/stripe.ts';

const URL_DB = process.env.PG_TEST_URL ?? 'postgres://postgres@/maawen?host=/tmp&port=5433';
const SAMI = '11111111-1111-1111-1111-111111111111';

let db: ReturnType<typeof fakeSupabase>;
let requests: Array<{ url: string; init?: RequestInit }>;
let responder: (url: string, init?: RequestInit) => unknown;

const realFetch = globalThis.fetch;

before(() => {
  process.env.FLOUCI_PUBLIC_KEY = 'pub_test';
  process.env.FLOUCI_SECRET_KEY = 'sec_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  db = fakeSupabase(URL_DB);
  setServiceClient(db as never);

  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    requests.push({ url: href, init });
    const body = responder(href, init);
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  await db.pool.end();
});

beforeEach(async () => {
  execFileSync('bash', ['supabase/tests/reset.sh'], { stdio: 'pipe' });
  await db.pool.query(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, 'sami@test.tn', '{"full_name":"سامي"}'::jsonb)`,
    [SAMI],
  );
  requests = [];
  responder = () => ({});
});

const post = (body: unknown, token = SAMI) =>
  new Request('http://localhost/checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

async function rows(query: string, params: unknown[] = []) {
  return (await db.pool.query(query, params)).rows;
}

describe('checkout', () => {
  it('crée un paiement Flouci au prix de la base', async () => {
    responder = () => ({
      result: { success: true, payment_id: 'FLOUCI-XYZ', link: 'https://checkout.flouci.com/x/FLOUCI-XYZ' },
    });

    const res = await checkout(post({ plan: 'pro', provider: 'flouci' }));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.url, 'https://checkout.flouci.com/x/FLOUCI-XYZ');

    const sent = JSON.parse(String(requests[0].init?.body));
    assert.equal(sent.amount, '30000', '30 DT = 30000 millimes, pris dans la base');
    assert.equal(sent.developer_tracking_id, body.payment_id);
    assert.match(String(requests[0].url), /generate_payment$/);

    const [payment] = await rows('select * from public.payments');
    assert.equal(payment.status, 'pending');
    assert.equal(payment.external_id, 'FLOUCI-XYZ');
    assert.equal(Number(payment.amount), 30);
    assert.equal(payment.currency, 'TND');

    const [sub] = await rows('select count(*)::int as n from public.subscriptions');
    assert.equal(sub.n, 0, "rien n'est activé avant le paiement");
  });

  it('ignore un prix envoyé par le client', async () => {
    responder = () => ({ result: { payment_id: 'P1', link: 'https://x' } });
    await checkout(post({ plan: 'basique', provider: 'flouci', amount: 1, price_dt: 1 }));

    const sent = JSON.parse(String(requests[0].init?.body));
    assert.equal(sent.amount, '15000', 'le prix vient toujours du plan en base');
  });

  it('refuse une formule inconnue et un fournisseur inconnu', async () => {
    assert.equal((await checkout(post({ plan: 'gratuit-a-vie', provider: 'flouci' }))).status, 400);
    assert.equal((await checkout(post({ plan: 'pro', provider: 'bitcoin' }))).status, 400);
  });

  it('crée une session Stripe avec la référence interne', async () => {
    responder = () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/cs_test_1' });

    const body = await (await checkout(post({ plan: 'max', provider: 'stripe' }))).json();
    assert.equal(body.url, 'https://checkout.stripe.com/c/cs_test_1');

    const sent = new URLSearchParams(String(requests[0].init?.body));
    assert.equal(sent.get('client_reference_id'), body.payment_id);
    assert.equal(sent.get('metadata[user_id]'), SAMI);
    assert.equal(sent.get('line_items[0][price_data][unit_amount]'), '3900', '39,00 $ en cents');
  });
});

describe('webhook Flouci', () => {
  async function startPayment(plan = 'pro') {
    responder = () => ({ result: { payment_id: 'FLOUCI-XYZ', link: 'https://x' } });
    const body = await (await checkout(post({ plan, provider: 'flouci' }))).json();
    return body.payment_id as string;
  }

  it("active l'abonnement quand Flouci confirme l'encaissement", async () => {
    const paymentId = await startPayment();
    responder = () => ({
      result: { status: 'SUCCESS', amount: 30000, developer_tracking_id: paymentId },
    });

    const res = await flouciWebhook(
      new Request('http://localhost/flouci-webhook', {
        method: 'POST',
        body: JSON.stringify({ payment_id: 'FLOUCI-XYZ' }),
      }),
    );
    const body = await res.json();

    assert.equal(body.status, 'activated');
    assert.match(String(requests.at(-1)?.url), /verify_payment\/FLOUCI-XYZ$/);

    const [sub] = await rows('select * from public.subscriptions where user_id = $1', [SAMI]);
    assert.equal(sub.status, 'active');
    assert.equal(sub.plan_key, 'pro');
    assert.equal(sub.credits_remaining, 1500);

    const [payment] = await rows('select status from public.payments');
    assert.equal(payment.status, 'paid');
  });

  it('ne redonne pas de crédits si le webhook est rejoué', async () => {
    const paymentId = await startPayment();
    responder = () => ({ result: { status: 'SUCCESS', amount: 30000, developer_tracking_id: paymentId } });

    const call = () =>
      flouciWebhook(
        new Request('http://localhost/flouci-webhook', {
          method: 'POST',
          body: JSON.stringify({ payment_id: 'FLOUCI-XYZ' }),
        }),
      );

    await call();
    const second = await (await call()).json();

    assert.equal(second.status, 'already_done');
    const [sub] = await rows('select credits_remaining from public.subscriptions where user_id = $1', [SAMI]);
    assert.equal(sub.credits_remaining, 1500, 'toujours un seul versement');
  });

  it("n'active rien si Flouci dit que le paiement a échoué", async () => {
    const paymentId = await startPayment();
    responder = () => ({ result: { status: 'FAILURE', developer_tracking_id: paymentId } });

    const body = await (
      await flouciWebhook(
        new Request('http://localhost/flouci-webhook', {
          method: 'POST',
          body: JSON.stringify({ payment_id: 'FLOUCI-XYZ' }),
        }),
      )
    ).json();

    assert.equal(body.status, 'ignored');
    const [count] = await rows('select count(*)::int as n from public.subscriptions');
    assert.equal(count.n, 0);
  });

  it('un faux webhook ne suffit pas: Flouci fait foi', async () => {
    await startPayment();
    // L'attaquant annonce un succès, mais la vérification serveur dit non.
    responder = () => ({ result: { status: 'PENDING' } });

    const body = await (
      await flouciWebhook(
        new Request('http://localhost/flouci-webhook', {
          method: 'POST',
          body: JSON.stringify({ payment_id: 'FLOUCI-XYZ', status: 'SUCCESS', amount: 999999 }),
        }),
      )
    ).json();

    assert.equal(body.status, 'ignored');
    const [count] = await rows('select count(*)::int as n from public.subscriptions');
    assert.equal(count.n, 0);
  });
});

describe('webhook Stripe', () => {
  async function sign(payload: string, secret = 'whsec_test', at = Math.floor(Date.now() / 1000)) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${at}.${payload}`));
    const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `t=${at},v1=${hex}`;
  }

  async function startStripePayment() {
    responder = () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/cs_test_1' });
    const body = await (await checkout(post({ plan: 'basique', provider: 'stripe' }))).json();
    return body.payment_id as string;
  }

  const event = (paymentId: string) =>
    JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', client_reference_id: paymentId, metadata: {} } },
    });

  it('refuse une requête sans signature valable', async () => {
    const paymentId = await startStripePayment();
    const payload = event(paymentId);

    const res = await stripeWebhook(
      new Request('http://localhost/stripe-webhook', {
        method: 'POST',
        headers: { 'Stripe-Signature': 't=1,v1=deadbeef' },
        body: payload,
      }),
    );

    assert.equal(res.status, 401);
    const [count] = await rows('select count(*)::int as n from public.subscriptions');
    assert.equal(count.n, 0, 'aucun abonnement offert à un faux webhook');
  });

  it("active l'abonnement avec une signature valable", async () => {
    const paymentId = await startStripePayment();
    const payload = event(paymentId);

    const res = await stripeWebhook(
      new Request('http://localhost/stripe-webhook', {
        method: 'POST',
        headers: { 'Stripe-Signature': await sign(payload) },
        body: payload,
      }),
    );

    assert.equal((await res.json()).status, 'activated');
    const [sub] = await rows('select plan_key, credits_remaining from public.subscriptions where user_id = $1', [SAMI]);
    assert.equal(sub.plan_key, 'basique');
    assert.equal(sub.credits_remaining, 500);
  });

  it('rejette une signature trop vieille (rejeu)', async () => {
    const payload = event('peu-importe');
    const old = Math.floor(Date.now() / 1000) - 3600;
    assert.equal(await verifyWebhook(payload, await sign(payload, 'whsec_test', old), 'whsec_test'), false);
    assert.equal(await verifyWebhook(payload, await sign(payload), 'whsec_test'), true);
    assert.equal(await verifyWebhook(payload, await sign(payload, 'autre_secret'), 'whsec_test'), false);
    assert.equal(await verifyWebhook(payload, '', 'whsec_test'), false);
  });
});
