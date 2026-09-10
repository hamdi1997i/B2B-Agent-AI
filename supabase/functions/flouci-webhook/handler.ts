/**
 * Webhook Flouci.
 *
 * Le corps du webhook n'est pas signé: on n'y lit que l'identifiant du
 * paiement, puis on demande à Flouci lui-même (appel serveur → serveur)
 * si l'argent est bien encaissé. Un faux webhook n'active donc rien.
 */

import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient } from '../_shared/db.ts';
import { isPaid, verifyPayment } from '../_shared/flouci.ts';
import { activatePayment } from '../_shared/activate.ts';

export async function handler(req: Request): Promise<Response> {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== 'POST') return fail('method', 'POST seulement', 405);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const nested = (body.result ?? body.data ?? {}) as Record<string, unknown>;
  const paymentId = String(body.payment_id ?? nested.payment_id ?? body.id ?? nested.id ?? '');
  if (!paymentId) return fail('bad_request', 'payment_id manquant', 400);

  const verification = await verifyPayment(paymentId);
  if (!isPaid(verification)) {
    return json({ status: 'ignored', flouci_status: verification.status });
  }

  const tracking = verification.trackingId;
  if (!tracking) return fail('bad_request', 'paiement sans référence interne', 400);

  const db = serviceClient();
  const result = await activatePayment(db, tracking, paymentId, verification.raw);
  return json(result, result.status === 'unknown_payment' ? 404 : 200);
}
