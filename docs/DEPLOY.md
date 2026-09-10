# التركيب من الصفر

كل شيء يتعمل مرّة وحدة، ووقتها المنصّة تخدم.

## 1. Supabase

```bash
npm i -g supabase
supabase login
supabase link --project-ref <ton-project-ref>
supabase db push                 # يطبّق supabase/migrations/
```

ولا بلا CLI: حلّ **SQL Editor** في Supabase وألصق الملفّين متاع
`supabase/migrations/` بالترتيب.

### الدخول بـGoogle

Authentication → Providers → **Google**: حطّ Client ID و Secret متاع
[Google Cloud Console](https://console.cloud.google.com/apis/credentials).
وبعد Authentication → URL Configuration → **Redirect URLs**، زيد:

```
maawen://auth
maawen://payment/success
maawen://payment/fail
```

### رفّع روحك لـadmin

بعد أول دخول من التطبيق:

```sql
update public.profiles set role = 'admin' where email = 'ton@email.com';
```

## 2. الأسرار (Edge Functions)

```bash
supabase secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  FLOUCI_PUBLIC_KEY=... \
  FLOUCI_SECRET_KEY=... \
  STRIPE_SECRET_KEY=sk_live_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  APP_RETURN_URL=maawen://payment
```

`SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` Supabase يحطّهم وحدو.

| سرّ | باش | لازم؟ |
|---|---|---|
| `ANTHROPIC_API_KEY` | الذكاء الاصطناعي | ✅ |
| `AI_PROVIDER` | `anthropic` (الافتراضي) | ❌ |
| `MODEL_LIGHT` / `MODEL_STANDARD` / `MODEL_ADVANCED` | تبدّل الموديل بلا نشر جديد | ❌ |
| `FLOUCI_*` | الخلاص المحلّي | للخلاص بالدينار |
| `STRIPE_*` | الخلاص الدولي | للخلاص بالـcarte |

## 3. نشر الـFunctions

```bash
supabase functions deploy agent
supabase functions deploy checkout
supabase functions deploy flouci-webhook --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
```

> الـwebhooks لازمهم `--no-verify-jwt`: Flouci وStripe ما عندهمش جيتون
> Supabase. الحماية متاعهم داخل الكود (تثبّت من Flouci direct، وsignature
> متاع Stripe).

### الـwebhooks

- **Flouci**: يتبعث وحدو في كل خلاص (الـURL يتحطّ في نداء `generate_payment`).
- **Stripe**: Dashboard → Developers → Webhooks → زيد
  `https://<project>.supabase.co/functions/v1/stripe-webhook`
  بالأحداث `checkout.session.completed` و`invoice.paid`، وحطّ الـsigning
  secret في `STRIPE_WEBHOOK_SECRET`.

## 4. التنظيف اليومي (اختياري)

باش الاشتراكات اللي سالت وقتها تتسكّر وحدها — Database → **Cron**:

```sql
select cron.schedule(
  'expire-subscriptions', '0 3 * * *',
  $$ select public.expire_subscriptions() $$
);
```

## 5. التطبيق

شوف [`android/README.md`](../android/README.md). باختصار: `local.properties`
فيها `supabase.url` و`supabase.anonKey`، وبعد `./gradlew assembleDebug`.

---

## التجريب بلا نشر

الاختبارات تخدم على PostgreSQL محلّي بلا حتى clé API:

```bash
# PostgreSQL محلّي
initdb -D /tmp/pg && pg_ctl -D /tmp/pg -o "-p 5433 -k /tmp" start
createdb -h /tmp -p 5433 maawen

export PGHOST=/tmp PGPORT=5433 PGUSER=postgres PGDATABASE=maawen

./supabase/tests/run.sh    # الـschema، الكريدي والـRLS (SQL)
npm install && npm test    # الـfunctions مع موديل وهمي وخلاص وهمي
```
