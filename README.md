# 🎯 B2B Agent AI — Enterprise Data Collector

An autonomous AI agent (web app) that **collects enterprise data** (emails,
phones, addresses, websites, Facebook/Instagram/LinkedIn), **classifies every
company by domain and by what it likely needs to buy** (software? packaging?
marketing? logistics?…), and lets you **export any B2B niche to CSV** so you can
email them your offer.

> **No API keys. No manual setup. No paid services.** Just open the project and
> click **Run**.

---

## ▶ How to run

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

That's it — there is nothing to configure. No `.env`, no API keys, no database
to install. The app uses only Node.js built-ins (it needs **Node 18+**).

If you are on **Claude Code on the web**, just open the project and click the
**Run** button — it launches `npm start` for you.

---

## 🧠 How it works

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

## 🗂 Data sources

| Source | What it gives | API key? |
|--------|---------------|----------|
| **Nominatim** (OpenStreetMap) | Geocoding a place to a search area | ❌ none |
| **Overpass API** (OpenStreetMap) | Businesses + contact tags worldwide | ❌ none |
| **Company websites** | Emails, phones, social links | ❌ none |

OpenStreetMap data is © OpenStreetMap contributors, licensed **ODbL**.

---

## 🎯 Purchase-need targeting (the B2B niche engine)

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

## ⚙ Project structure

```
server.js            Zero-dependency HTTP server + REST API
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

## ⚖ Responsible use

This tool collects **publicly available business contact data**. Before sending
marketing email, make sure you comply with the law that applies to your targets
(**GDPR** in the EU, **CAN-SPAM** in the US, etc.): have a lawful basis, identify
yourself, and include an opt-out. Respect website terms and rate limits.
