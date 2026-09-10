/**
 * Activation d'un abonnement après un paiement confirmé.
 * Partagée par les deux webhooks — et idempotente: un webhook rejoué
 * ne redonne pas de crédits.
 */

import type { Db } from './db.ts';

export interface ActivationResult {
  status: 'activated' | 'already_done' | 'unknown_payment';
  payment_id?: string;
}

export async function activatePayment(
  db: Db,
  paymentId: string,
  externalId: string | null,
  raw: unknown,
): Promise<ActivationResult> {
  const { data: payment } = await db
    .from('payments')
    .select('id, user_id, plan_key, status, provider')
    .eq('id', paymentId)
    .maybeSingle();

  if (!payment || !payment.user_id || !payment.plan_key) return { status: 'unknown_payment' };
  if (payment.status === 'paid') return { status: 'already_done', payment_id: payment.id as string };

  await db
    .from('payments')
    .update({
      status: 'paid',
      ...(externalId ? { external_id: externalId } : {}),
      raw: raw as Record<string, unknown>,
    })
    .eq('id', payment.id);

  const { error } = await db.rpc('grant_subscription', {
    p_user: payment.user_id,
    p_plan: payment.plan_key,
    p_provider: payment.provider,
    p_external_id: externalId ?? (payment.id as string),
    p_months: 1,
  });
  if (error) throw new Error(error.message);

  return { status: 'activated', payment_id: payment.id as string };
}
