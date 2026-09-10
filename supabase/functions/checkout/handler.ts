/**
 * Démarre un paiement d'abonnement.
 *
 *   POST { plan: 'pro', provider: 'flouci' | 'stripe' }
 *   → { url }  : l'app ouvre cette page; l'abonnement s'active au webhook.
 *
 * Le prix vient toujours de la base, jamais du client — sinon on pourrait
 * s'acheter la formule Max pour un dinar.
 */

import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient, userFromRequest } from '../_shared/db.ts';
import { env } from '../_shared/env.ts';
import { generatePayment } from '../_shared/flouci.ts';
import { createCheckoutSession } from '../_shared/stripe.ts';

export async function handler(req: Request): Promise<Response> {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== 'POST') return fail('method', 'POST seulement', 405);

  const db = serviceClient();
  const user = await userFromRequest(req, db);
  if (!user) return fail('unauthorized', 'جدّد الدخول للتطبيق.', 401);

  const { plan: planKey, provider } = (await req.json().catch(() => ({}))) as {
    plan?: string;
    provider?: string;
  };
  if (provider !== 'flouci' && provider !== 'stripe') {
    return fail('bad_request', 'طريقة خلاص غير معروفة.', 400);
  }

  const { data: plan } = await db
    .from('plans')
    .select('key, name_ar, name_fr, price_dt, price_usd, stripe_price_id, is_active')
    .eq('key', planKey ?? '')
    .maybeSingle();

  if (!plan || !plan.is_active) return fail('bad_request', 'الاشتراك هذا ماهوش موجود.', 400);

  const { data: payment, error } = await db
    .from('payments')
    .insert({
      user_id: user.id,
      plan_key: plan.key,
      provider,
      amount: provider === 'flouci' ? plan.price_dt : plan.price_usd,
      currency: provider === 'flouci' ? 'TND' : 'USD',
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) return fail('server', error.message, 500);

  const appUrl = env('APP_RETURN_URL', 'maawen://payment');
  const functionsUrl = env('SUPABASE_URL') ? `${env('SUPABASE_URL')}/functions/v1` : '';

  try {
    if (provider === 'flouci') {
      const result = await generatePayment({
        amountMillimes: Math.round(Number(plan.price_dt) * 1000),
        trackingId: payment.id as string,
        successLink: `${appUrl}/success`,
        failLink: `${appUrl}/fail`,
        webhook: functionsUrl ? `${functionsUrl}/flouci-webhook` : undefined,
      });
      await db
        .from('payments')
        .update({ external_id: result.payment_id })
        .eq('id', payment.id);
      return json({ url: result.link, payment_id: payment.id });
    }

    const session = await createCheckoutSession({
      priceId: plan.stripe_price_id,
      amountUsd: Number(plan.price_usd),
      planName: `Maawen — ${plan.name_fr}`,
      trackingId: payment.id as string,
      userId: user.id,
      planKey: plan.key as string,
      successUrl: `${appUrl}/success`,
      cancelUrl: `${appUrl}/fail`,
      customerEmail: user.email || undefined,
    });
    await db.from('payments').update({ external_id: session.id }).eq('id', payment.id);
    return json({ url: session.url, payment_id: payment.id });
  } catch (e) {
    await db
      .from('payments')
      .update({ status: 'failed', raw: { error: e instanceof Error ? e.message : String(e) } })
      .eq('id', payment.id);
    return fail('provider', 'ما نجّمناش نحضّرو الخلاص. عاود من بعد.', 502);
  }
}
