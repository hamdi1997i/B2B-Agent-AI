/**
 * Webhook Stripe: on n'active un abonnement qu'après avoir vérifié la
 * signature de la requête.
 */

import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient } from '../_shared/db.ts';
import { verifyWebhook } from '../_shared/stripe.ts';
import { activatePayment } from '../_shared/activate.ts';

const HANDLED = new Set(['checkout.session.completed', 'invoice.paid']);

export async function handler(req: Request): Promise<Response> {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== 'POST') return fail('method', 'POST seulement', 405);

  const payload = await req.text();
  const signature = req.headers.get('Stripe-Signature') ?? '';

  if (!(await verifyWebhook(payload, signature))) {
    return fail('unauthorized', 'signature invalide', 401);
  }

  const event = JSON.parse(payload) as {
    type: string;
    data: { object: Record<string, unknown> };
  };
  if (!HANDLED.has(event.type)) return json({ status: 'ignored', type: event.type });

  const object = event.data.object;
  const metadata = (object.metadata ?? {}) as Record<string, string>;
  const paymentId = String(object.client_reference_id ?? metadata.payment_id ?? '');
  if (!paymentId) return json({ status: 'ignored', reason: 'sans référence interne' });

  const db = serviceClient();
  const result = await activatePayment(db, paymentId, String(object.id ?? ''), event);
  return json(result, result.status === 'unknown_payment' ? 404 : 200);
}
