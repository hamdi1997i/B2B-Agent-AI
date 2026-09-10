/**
 * Flouci — paiement local (carte bancaire tunisienne, D17, wallet).
 * https://docs.flouci.com/api-reference/generate-transaction
 *
 * Les montants circulent en millimes: 15,000 DT = 15000.
 *
 * Le webhook de Flouci n'a pas de signature: on ne lui fait donc pas
 * confiance. On s'en sert seulement comme signal, et c'est `verifyPayment`
 * (appel serveur → serveur) qui fait foi — c'est ce que recommande Flouci.
 */

import { env, requireEnv } from './env.ts';

const BASE = () => env('FLOUCI_BASE_URL', 'https://developers.flouci.com/api/v2');

function authHeader(): string {
  return `Bearer ${requireEnv('FLOUCI_PUBLIC_KEY')}:${requireEnv('FLOUCI_SECRET_KEY')}`;
}

export interface FlouciPayment {
  payment_id: string;
  link: string;
}

export async function generatePayment(params: {
  amountMillimes: number;
  trackingId: string;
  successLink: string;
  failLink: string;
  webhook?: string;
}): Promise<FlouciPayment> {
  const res = await fetch(`${BASE()}/generate_payment`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: String(params.amountMillimes),
      success_link: params.successLink,
      fail_link: params.failLink,
      developer_tracking_id: params.trackingId,
      session_timeout_secs: 1200,
      accept_card: true,
      ...(params.webhook ? { webhook: params.webhook } : {}),
    }),
  });

  const body = await res.json().catch(() => ({}));
  const result = body?.result;
  if (!res.ok || !result?.link || !result?.payment_id) {
    throw new Error(`Flouci a refusé le paiement: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return { payment_id: result.payment_id, link: result.link };
}

export interface FlouciVerification {
  status: string;             // SUCCESS | PENDING | EXPIRED | FAILURE | ...
  amountMillimes: number;
  trackingId: string | null;
  raw: unknown;
}

export async function verifyPayment(paymentId: string): Promise<FlouciVerification> {
  const res = await fetch(`${BASE()}/verify_payment/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: authHeader() },
  });
  const body = await res.json().catch(() => ({}));
  const result = body?.result ?? {};
  return {
    status: String(result.status ?? 'UNKNOWN'),
    amountMillimes: Number(result.amount ?? 0),
    trackingId: result.developer_tracking_id ?? null,
    raw: body,
  };
}

/** Le paiement est-il réellement encaissé ? */
export function isPaid(v: FlouciVerification): boolean {
  return v.status === 'SUCCESS';
}
