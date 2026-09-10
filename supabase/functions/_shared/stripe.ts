/**
 * Stripe — paiement international (la société hors Tunisie).
 *
 * On reste sur l'API HTTP directement: une seule requête pour créer la
 * session, et la vérification de signature du webhook faite à la main avec
 * WebCrypto — ça évite d'embarquer le SDK dans une Edge Function.
 */

import { env, requireEnv } from './env.ts';

const API = 'https://api.stripe.com/v1';

function form(params: Record<string, string | undefined>): string {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, v);
  return body.toString();
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export async function createCheckoutSession(params: {
  priceId?: string | null;
  amountUsd: number;
  planName: string;
  trackingId: string;
  userId: string;
  planKey: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}): Promise<CheckoutSession> {
  // Avec un price_id Stripe on vend un abonnement récurrent; sinon un
  // paiement unique du montant de la formule.
  const line = params.priceId
    ? { 'line_items[0][price]': params.priceId, mode: 'subscription' }
    : {
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(Math.round(params.amountUsd * 100)),
        'line_items[0][price_data][product_data][name]': params.planName,
        mode: 'payment',
      };

  const res = await fetch(`${API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireEnv('STRIPE_SECRET_KEY')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form({
      ...line,
      'line_items[0][quantity]': '1',
      client_reference_id: params.trackingId,
      'metadata[user_id]': params.userId,
      'metadata[plan_key]': params.planKey,
      'metadata[payment_id]': params.trackingId,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      customer_email: params.customerEmail,
    }),
  });

  const body = await res.json();
  if (!res.ok || !body.url) {
    throw new Error(`Stripe a refusé la session: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return { id: body.id, url: body.url };
}

/**
 * Vérifie l'en-tête `Stripe-Signature` (schéma v1, HMAC-SHA256).
 * Sans cette vérification, n'importe qui pourrait s'offrir un abonnement
 * en appelant notre webhook.
 */
export async function verifyWebhook(
  payload: string,
  signatureHeader: string,
  secret = env('STRIPE_WEBHOOK_SECRET'),
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!secret || !signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const [k, ...rest] = p.trim().split('=');
      return [k, rest.join('=')];
    }),
  );
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const digest = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  return timingSafeEqual(digest, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
