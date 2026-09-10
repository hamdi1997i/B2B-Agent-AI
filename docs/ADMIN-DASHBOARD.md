# لوحة الـAdmin (تتبنى في Lovable)

الـbackend حاضر. الـdashboard ما يحتاج حتى endpoint جديد: يقرا **direct** من
Supabase بحساب فيه `role = 'admin'`، والـRLS هي اللي تفتحلو كل شيء.

> **أول حاجة**: بعد ما تدخل بحسابك أول مرة في التطبيق، رفّع روحك لـadmin:
> ```sql
> update public.profiles set role = 'admin' where email = 'ton@email.com';
> ```

---

## 1. اللي يشوفو الـadmin (وما يشوفوش)

| يشوف | ما يشوفش |
|---|---|
| كل الحسابات، الاشتراكات، الكريدي | **محتوى المحادثات** — الـRLS تمنعها حتى على الـadmin |
| tokens، الكلفة بالدولار، عدد الطلبات | الجيتونات متاع Google/OAuth متاع المستخدمين |
| الوقت اللي يقضيه كل واحد في التطبيق | |
| الخلاصات والمداخيل | |

هذا اختيار مقصود: تنجّم تسيّر المنصّة كاملة بلا ما تقرا حياة الناس.

---

## 2. الجداول والـviews اللي تلزمك

### `admin_user_overview` — الصفحة الرئيسية (سطر لكل مستخدم)

```ts
const { data } = await supabase
  .from('admin_user_overview')
  .select('*')
  .order('cost_usd_30d', { ascending: false });
```

| العمود | معناه |
|---|---|
| `email`, `full_name`, `status`, `created_at`, `last_seen_at` | الحساب |
| `plan_key`, `subscription_status`, `period_end` | الاشتراك |
| `credits_remaining`, `credits_granted` | الكريدي |
| `turns_30d`, `tokens_30d`, `cost_usd_30d`, `cost_usd_total` | **الاستهلاك متاع الـAI** |
| `minutes_today`, `minutes_30d`, `active_days_30d` | **قدّاش يستعمل التطبيق** |
| `granted_tools` | الـapps اللي سمح بيهم |

### `admin_daily_usage` — الرسوم البيانية

```ts
supabase.from('admin_daily_usage')
  .select('*')
  .gte('day', '2026-08-01')
  .order('day');
// day, user_id, turns, input_tokens, output_tokens, cost_usd, errors, minutes, sessions
```

### `admin_tool_usage` — أنهي app تتستعمل فعلاً

```ts
supabase.from('admin_tool_usage').select('*');
// key, name_ar, kind, is_enabled, users_granted, users_denied, calls_30d
```

### `admin_revenue_monthly` — المداخيل

```ts
supabase.from('admin_revenue_monthly').select('*');
// month, provider, currency, payments, total
```

### الجداول اللي تتبدّل

| الجدول | باش تعمل شنوّة |
|---|---|
| `plans` | تبدّل الأثمنة، الكريدي في الشهر، السقف اليومي، ومستوى الموديل |
| `tools` | **تشعّل/تطفّي app للجميع** (`is_enabled`)، تحدّد `min_plan`، تزيد app جديدة |
| `profiles` | توقّف حساب (`status = 'blocked'`) ولا تعمل واحد آخر admin |
| `model_prices` | تحيّن أثمنة الـtokens باش الكلفة تبقى صحيحة |

---

## 3. العمليات (RPC)

```ts
// زيد ولا نقّص كريدي (geste commercial، تصحيح…)
await supabase.rpc('admin_adjust_credits', {
  p_user: userId, p_delta: 200, p_reason: 'geste commercial',
});

// فعّل اشتراك يدويًا (واحد خلّص cash ولا virement)
await supabase.rpc('grant_subscription', {
  p_user: userId, p_plan: 'pro', p_provider: 'manual',
  p_external_id: 'virement-2026-09', p_months: 1,
});
```

> `grant_subscription` محجوزة للـ`service_role`: ناديها من Edge Function صغيرة
> ولا من SQL Editor. `admin_adjust_credits` تخدم direct من الـdashboard
> (تتثبّت وحدها من الـrole).

---

## 4. زيادة app جديدة للـagent

سطر واحد في `tools`، وبرك — التطبيق يوريها للناس ويطلب منهم الإذن:

```sql
insert into public.tools
  (key, name_ar, name_fr, description_ar, kind, icon, android_permissions,
   requires_consent, is_enabled, min_plan, model_description, input_schema, sort)
values
  ('meteo', 'الطقس', 'Météo', 'يقولك كيفاش الطقس.', 'server', '🌤️',
   '{}', true, true, null,
   'Donner la météo actuelle et les prévisions pour une ville.',
   '{"type":"object","properties":{"ville":{"type":"string"}},"required":["ville"]}'::jsonb,
   12);
```

- `kind = 'device'` → التنفيذ في التليفون (لازم تزيد الكود في `DeviceTools.kt`)
- `kind = 'server'` → التنفيذ في الـEdge Function (`_shared/tools.ts` → `runServerTool`)
- `min_plan` → تخلّيها لاشتراك معيّن برك
- `is_enabled = false` → تخبّيها على الكل بضغطة

---

## 5. الـprompt اللي تحطّو في Lovable

```
Build an admin dashboard for a mobile AI-assistant subscription business.
It connects to my existing Supabase project (Google auth, RLS already set up).
Only accounts with profiles.role = 'admin' can sign in — check it after login
and sign out anyone else.

Pages:
1. Overview — KPI cards: active subscribers, monthly revenue (from
   admin_revenue_monthly), total AI cost this month (sum of cost_usd_30d),
   gross margin, daily active users. A line chart of turns and cost per day
   from admin_daily_usage.
2. Users — table from admin_user_overview: email, plan, subscription status,
   credits remaining, turns_30d, cost_usd_30d, minutes_today, last_seen_at.
   Sortable and searchable. Row click opens a drawer with that user's daily
   usage chart (admin_daily_usage filtered by user_id), their granted_tools,
   and two actions: adjust credits (rpc admin_adjust_credits) and block or
   unblock the account (update profiles.status).
3. Plans — CRUD on the plans table: price_dt, price_usd, monthly_credits,
   daily_credit_cap, model_tier, is_active.
4. Apps — table `tools` with a toggle on is_enabled, a min_plan selector, and
   the adoption numbers from admin_tool_usage (users_granted, calls_30d).
5. Payments — the payments table, filterable by provider and status.

Never display conversation content — the database does not expose it.
Use Supabase JS with the anon key; RLS does the authorisation.
```
