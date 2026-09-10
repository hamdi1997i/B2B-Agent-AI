# 🤖 المعاون — AI Agent للتاجر التونسي

تحلّ التطبيق، تضغط على 🎙️، وتحكي بالتونسي عادي:

> «سجّل أحمد، عليه 250 دينار، يخلّص نهار 20.»
> → ينشئ الكليان، يسجّل الكريدي، ويحطّ الـéchéance.

> «ابعث لسامي رسالة قولّو إنو الطلبية متاعو جاهزة.»
> → يكتب الرسالة بالدارجة، يوريهالك، **وأنت** اللي تأكّد الإرسال.

> «شنوة عندي غدوة؟» / «شكون ما خلّصش؟» / «قداش رابحنا اليوم؟»
> → يقرا الدفتر ويجاوبك بالصوت.

ماهوش SaaS عام: هذا مساعد **للتاجر التونسي** — كليان، كريدي، طلبيات،
فواتير، تذكيرات ومبيعات. الواجهة = **chat + ميكرو**، والذكاء (Claude) هو اللي
يستعمل الـtools وراء الكواليس.

---

## ▶ كيفاش تشغّلو

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...      # مطلوب: الـagent يخدم بـClaude
npm start
```

وبعد حلّ **http://localhost:3000** (ولا `http://<IP متاعك>:3000` من التليفون).

- على التليفون: Chrome ← «Add to Home screen» → يولّي تطبيق (PWA) بالميكرو
  والصوت.
- تحبّ APK حقيقي؟ شوف [`android/`](android/) — WebView + `SpeechRecognizer`
  بالتونسي + `TextToSpeech` + SMS.

المتغيّرات اللي تنجّم تبدّلهم:

| Variable | Défaut | يعمل شنوة |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | مفتاح Claude (مطلوب) |
| `TN_MODEL` | `claude-opus-5` | الموديل. `claude-sonnet-5` أرخص |
| `TN_EFFORT` | `low` | عمق التفكير: `low` للسرعة، `high` للجمل المعقّدة |
| `TN_DB_FILE` | `data/tn-db.json` | فين يتسجّل الدفتر |
| `PORT` | `3000` | |

---

## 🧰 شنوة يعرف يعمل (18 outil)

| المجال | الـtools | مثال بالصوت |
|---|---|---|
| كليان | `ajouter_client`, `chercher_client` | «سجّل أحمد نمرتو 20 123 456» |
| كريدي | `enregistrer_dette`, `enregistrer_paiement`, `liste_impayes` | «شكون ما خلّصش؟» |
| طلبيات | `creer_commande`, `changer_statut_commande`, `liste_commandes` | «بدّل حالة الطلبية متاع أحمد لـ livrée» |
| فواتير | `creer_facture` | «اعمل facture للطلبية هذي» |
| تذكيرات | `creer_rappel`, `agenda`, `marquer_rappel_fait` | «ذكّرني غدوة مع 10 نكلم محمد» |
| مبيعات | `enregistrer_vente`, `bilan_ventes` | «قداش رابحنا اليوم؟» |
| نوتة | `ajouter_note`, `liste_notes` | «اعمل note: لازم نشري 20 carton» |
| رسائل | `preparer_sms` | «ابعث لسامي قولّو الطلبية جاهزة» |
| الحانوت | `parametres_boutique` | «اسم الحانوت مطعم النور» |

**قاعدة السلامة:** الـagent **ما يبعثش SMS وحدو**. `preparer_sms` يحضّر النص
برك، والتطبيق يوريلك carte فيها «ابعث / إلغاء» — كي تضغط «ابعث» يتحلّ تطبيق
الرسائل متاع التليفون بالنص محضّر، وأنت اللي تأكّد.

---

## 🧠 كيفاش يخدم

```
🎙️ صوت بالتونسي
   └─ SpeechRecognizer (ar-TN) في التطبيق Android،
      ولا Web Speech API في Chrome
        └─ POST /api/tn/chat  ──► Claude (tool use, streaming)
                                    ├─ tools تخدم على data/tn-db.json
                                    └─ SSE: text / tool / action
             └─ الجواب يتقرا بالصوت (TTS) + fil متاع العمليات
```

الملفّات:

```
src/tn/store.js      دفتر التاجر: JSON بلا قاعدة بيانات، تواريخ بتوقيت تونس
src/tn/tools.js      18 outil (schémas + exécution) + résumé للـfil
src/tn/brain.js      حلقة tool-use على Claude، prompt بالدارجة، السياق متاع الحوار
src/tn/facture.js    فاتورة HTML (FR + AR) صالحة للطباعة
public/agent.*       الواجهة (PWA): chat + ميكرو + carnet
android/             تطبيق Android (WebView + جسر native للصوت والـSMS)
test/agent.test.js   16 test يخدمو بلا clé API (الموديل mock)
```

```bash
npm test        # يجرّب الـstore والـtools وحلقة الـagent
```

---

## 💰 الكلفة (تقريبية)

كل commande صوتية = نداء ولا زوز لـClaude مع الـtools. بحساب Opus 5
($5 / مليون token دخول، $25 / مليون خروج) الـcommande تجي تقريبًا **50-80
مليم**؛ يعني تاجر يستعمل 30 commande في النهار ≈ **1.5-2.5 دينار / نهار**.
باش تنقّص:

- `TN_MODEL=claude-sonnet-5` (أرخص بـ2.5 مرّة)
- الـsystem prompt متكاش (`cache_control`) — التكرار يولّي أرخص
- `TN_EFFORT=low` (هذا هو الـdéfaut)

الأرقام هذي تقدير مبني على أسعار الـAPI، موش قياس حقيقي.

---

## 🔐 المعطيات

كل شيء يتسجّل في `data/tn-db.json` على السرفور متاعك — ما فماش cloud ولا
مشاركة. الـPWA تخزّن برك الـsession id وتفضيل الصوت في الـlocalStorage.

---

## 🧭 خارطة الطريق

- [ ] تذكيرات تجيك حتى كي التطبيق مسكّر (notifications)
- [ ] مزامنة الكليان مع contacts التليفون
- [ ] تصدير الدفتر Excel/CSV
- [ ] وضع offline: تسجيل الصوت وإرسالو كي ترجع الـconnexion

---

## 🎯 الجزء الثاني: B2B Agent AI — Enterprise Data Collector

> نفس الـrepo فيه زادة الأداة القديمة متاع جمع معطيات الشركات (بلا API key).
> تلقاها على **http://localhost:3000/b2b**.

An autonomous AI agent (web app) that **collects enterprise data** (emails,
phones, addresses, websites, Facebook/Instagram/LinkedIn), **classifies every
company by domain and by what it likely needs to buy** (software? packaging?
marketing? logistics?…), and lets you **export any B2B niche to CSV** so you can
email them your offer.

> **No API keys** for this part — it only uses OpenStreetMap. (The voice agent
> above is the part that needs `ANTHROPIC_API_KEY`.)

---

#### ▶ How to run

There are **two ways** to run it — both with **no API keys**:

#### A) Online — GitHub Pages (zero install)

The app is deployed as a static site straight from GitHub. After the deploy
workflow runs (see below), open:

```
https://hamdi1997i.github.io/B2B-Agent-AI/
```

Everything runs **in your browser**: it calls OpenStreetMap directly, classifies
the companies, and stores them locally (`localStorage`). Nothing is uploaded.

> Note: in the browser build the agent reads the contact details OpenStreetMap
> already has (email/phone/website/socials). Deep website scraping for *extra*
> emails is only available in the local Node version below, because browsers
> block cross-origin page fetches.

#### B) Local — full Node version (adds website email-scraping)

```bash
npm start
```

Then open **http://localhost:3000/b2b**. No `.env` and no database to install
for this collector — only Node.js built-ins (**Node 18+**).

---

#### 🚀 Deploy on GitHub (Pages)

This repo ships a ready-to-use workflow at
`.github/workflows/deploy-pages.yml` that publishes the `docs/` folder.

1. Push/merge this branch into **main**.
2. On GitHub: **Settings → Pages → Build and deployment → Source = GitHub Actions**.
3. The **Deploy to GitHub Pages** workflow runs automatically (or trigger it
   manually from the **Actions** tab → *Run workflow*).
4. Your live URL appears in the workflow summary:
   `https://hamdi1997i.github.io/B2B-Agent-AI/`

No secrets or API keys are needed — the workflow only uploads static files.

---

#### 🧠 How it works

The agent runs a fully automatic pipeline when you click **Run agent**:

1. **Geocode** the city/region you typed — via **Nominatim** (OpenStreetMap, no key).
2. **Collect companies** in that area — via the **Overpass API** (OpenStreetMap,
   no key). This returns business name, address, phone, website, email and
   social links where available.
3. **Classify** each company into a **domain** (Food & Beverage, Retail, Health,
   Industry, Professional Services, Automotive, Hospitality, Crafts, Beauty,
   Education…) and infer its **purchase needs** (what this kind of business
   typically buys).
4. **Enrich** — the agent visits each company's website and extracts any
   **emails, phones and social profiles** that weren't in the map data.
5. **Store** everything in a local JSON database (`data/db.json`).

You then **filter** by domain, by purchase need, by "has email", search by
name/city, and **export the result to CSV** — ready for your email campaign.

---

#### 🗂 Data sources

| Source | What it gives | API key? |
|--------|---------------|----------|
| **Nominatim** (OpenStreetMap) | Geocoding a place to a search area | ❌ none |
| **Overpass API** (OpenStreetMap) | Businesses + contact tags worldwide | ❌ none |
| **Company websites** | Emails, phones, social links | ❌ none |

OpenStreetMap data is © OpenStreetMap contributors, licensed **ODbL**.

---

#### 🎯 Purchase-need targeting (the B2B niche engine)

Each domain is mapped to the products/services that type of business commonly
buys. Examples:

- **Restaurants & Food** → `packaging`, `software (POS/online ordering)`,
  `marketing`, `cleaning`, `payments`, `equipment`
- **Retail Shops** → `software (POS/e-commerce)`, `packaging`, `security`,
  `payments`, `logistics`, `furniture`
- **Industry & Manufacturing** → `equipment`, `raw materials`, `logistics`,
  `packaging`, `software`, `energy`
- **Professional Offices** → `software`, `marketing`, `accounting`,
  `HR/recruitment`, `furniture`

So if you sell packaging, filter **Purchase need = Packaging** and export every
restaurant, retailer and factory in the city — instant niche list.

You can fine-tune these rules in `src/classify.js`.

---

#### ⚙ Project structure

```
server.js            HTTP server + REST API (agent vocal + collecteur B2B)
src/
  agent.js           Orchestrates the collect → classify → enrich pipeline
  overpass.js        Nominatim geocoding + Overpass queries (no keys)
  classify.js        Domain + purchase-need classification rules
  enrich.js          Website scraping for emails / phones / socials
  sectors.js         Sector → OpenStreetMap tag mapping
  store.js           JSON datastore + filtered queries
  export.js          CSV export
public/              Web UI (HTML/CSS/JS, no framework)
data/db.json         Local database (created automatically)
```

---

#### ⚖ Responsible use

This tool collects **publicly available business contact data**. Before sending
marketing email, make sure you comply with the law that applies to your targets
(**GDPR** in the EU, **CAN-SPAM** in the US, etc.): have a lawful basis, identify
yourself, and include an opt-out. Respect website terms and rate limits.
