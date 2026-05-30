'use strict';

/* ============================================================
 * B2C Agent AI — Customer Finder engine (no API keys).
 *
 * You enter a PRODUCT NAME + short DESCRIPTION. The engine infers:
 *   - the Ideal Customer Profile (who buys this)
 *   - where those customers already gather online (channels)
 *   - search keywords, hashtags, communities, marketplaces
 *   - ad-targeting suggestions
 *   - ready-to-send outreach copy (email + DM/SMS)
 *
 * It works fully offline: a keyword/category classifier maps the
 * product text to a niche profile. No scraping of private people's
 * personal data — instead it tells you the legal, opt-in channels
 * where buyers can be reached.
 * ============================================================ */

// ---------- Product niche knowledge base ----------
// Each niche: trigger keywords -> audience profile + channels.
const NICHES = [
  {
    key: 'beauty_cosmetics',
    label: 'Beauty & Cosmetics',
    keywords: ['cosmetic','makeup','skincare','skin care','skin','face','serum','cream','lipstick','perfume','fragrance','beauty','hair','shampoo','nail','lotion','mascara','foundation','soap','spa','moistur','anti-aging','brighten'],
    audience: { who: 'Beauty-conscious consumers, mostly women 18–45', interests: ['skincare routines','makeup tutorials','self-care','wellness','fashion'], intent: ['"best serum for…"','"how to…" beauty searches','before/after results'] },
    marketplaces: ['Amazon','Etsy','Sephora marketplace','eBay','Instagram Shop','TikTok Shop'],
    social: ['Instagram','TikTok','Pinterest','YouTube (reviews)'],
    communities: ['r/SkincareAddiction','r/MakeupAddiction','r/Beauty','Beauty Facebook groups'],
    hashtags: ['#skincare','#makeup','#beautytips','#skincareroutine','#crueltyfree','#glowup'],
    keywordsSEO: ['best [product] for [skin type]','[product] review','natural [product]','[product] benefits'],
    ads: ['Meta Ads: interests = skincare, cosmetics, beauty brands','TikTok Ads: beauty & personal care','Pinterest Ads: beauty boards','Google Shopping'],
    osmFilters: [
      { k: 'shop', v: ['beauty','cosmetics','hairdresser','perfumery','chemist'] },
      { k: 'amenity', v: ['spa','pharmacy'] },
      { k: 'leisure', v: ['spa'] },
    ],
  },
  {
    key: 'fashion_apparel',
    label: 'Fashion & Apparel',
    keywords: ['clothes','clothing','shirt','dress','shoes','sneaker','jacket','fashion','apparel','wear','jeans','bag','handbag','watch','jewel','jewelry','accessor','hoodie','t-shirt','tshirt'],
    audience: { who: 'Style-driven shoppers 16–40, trend & deal sensitive', interests: ['fashion trends','outfit inspo','streetwear','sustainable fashion'], intent: ['"outfit ideas"','"where to buy…"','seasonal/holiday shopping'] },
    marketplaces: ['Amazon','Etsy','eBay','ASOS marketplace','Depop','Instagram Shop','TikTok Shop','Vinted'],
    social: ['Instagram','TikTok','Pinterest','YouTube (hauls)'],
    communities: ['r/streetwear','r/femalefashionadvice','r/malefashionadvice','fashion Facebook groups'],
    hashtags: ['#ootd','#fashion','#streetwear','#style','#outfitinspo','#fashionista'],
    keywordsSEO: ['[product] outfit','best [product] 2025','affordable [product]','[product] for [occasion]'],
    ads: ['Meta Ads: fashion interests & lookalikes','TikTok Ads: fashion','Pinterest Ads','Google Shopping'],
    osmFilters: [{ k: 'shop', v: ['clothes','shoes','boutique','jewelry','bag','fashion_accessories','watches','tailor'] }],
  },
  {
    key: 'tech_gadgets',
    label: 'Tech & Gadgets',
    keywords: ['phone','laptop','computer','gadget','electronic','headphone','earbuds','charger','camera','drone','smart','speaker','keyboard','mouse','tablet','console','gaming','accessory','tech','device','watch'],
    audience: { who: 'Tech enthusiasts & early adopters, 18–45, skews male', interests: ['gadgets','reviews','productivity','gaming','DIY tech'], intent: ['spec comparisons','"best [gadget] under $X"','unboxing videos'] },
    marketplaces: ['Amazon','eBay','Newegg','AliExpress','Best Buy marketplace','Walmart marketplace'],
    social: ['YouTube (reviews)','TikTok','Reddit','X/Twitter'],
    communities: ['r/gadgets','r/technology','r/BuyItForLife','niche product subreddits'],
    hashtags: ['#tech','#gadgets','#techtok','#gadgetreview','#unboxing'],
    keywordsSEO: ['best [product] under [price]','[product] vs [competitor]','[product] review','top [product] 2025'],
    ads: ['Google Shopping + Search (high intent)','YouTube pre-roll on review channels','Meta Ads: tech interests','Reddit Ads on tech subs'],
    osmFilters: [{ k: 'shop', v: ['electronics','mobile_phone','computer','hifi','camera','video_games','telecommunication'] }],
  },
  {
    key: 'home_kitchen',
    label: 'Home, Kitchen & Living',
    keywords: ['home','kitchen','furniture','decor','cookware','pan','pot','utensil','cleaning','vacuum','bed','mattress','pillow','candle','garden','tool','appliance','organizer','storage','lamp','rug'],
    audience: { who: 'Homeowners & renters 25–55, value + aesthetics driven', interests: ['home decor','DIY','organization','cooking','interior design'], intent: ['"best [item] for small spaces"','home makeover ideas','seasonal cleaning'] },
    marketplaces: ['Amazon','Etsy','Wayfair','eBay','Facebook Marketplace','Walmart marketplace'],
    social: ['Pinterest','Instagram','TikTok','YouTube'],
    communities: ['r/HomeImprovement','r/InteriorDesign','r/organization','home decor Facebook groups'],
    hashtags: ['#homedecor','#kitchenware','#homeorganization','#diyhome','#interiordesign'],
    keywordsSEO: ['best [product] for [room]','[product] ideas','space-saving [product]','[product] reviews'],
    ads: ['Pinterest Ads (strong for home)','Meta Ads: homeowner interests','Google Shopping'],
    osmFilters: [{ k: 'shop', v: ['furniture','interior_decoration','houseware','kitchen','homewares','garden_centre','doityourself','hardware','appliance','bed','curtain','florist'] }],
  },
  {
    key: 'food_beverage',
    label: 'Food, Beverage & Supplements',
    keywords: ['food','snack','drink','beverage','coffee','tea','organic','supplement','vitamin','protein','nutrition','sauce','spice','chocolate','honey','juice','keto','vegan','gluten'],
    audience: { who: 'Health & taste conscious consumers, 20–50', interests: ['healthy eating','recipes','fitness','organic/natural products'], intent: ['"best [product] for [goal]"','recipe searches','diet-specific needs'] },
    marketplaces: ['Amazon','Etsy (artisan)','iHerb','Thrive Market','local marketplaces'],
    social: ['Instagram','TikTok','Pinterest','YouTube'],
    communities: ['r/EatCheapAndHealthy','r/nutrition','r/vegan','foodie Facebook groups'],
    hashtags: ['#healthyfood','#foodie','#organic','#vegan','#nutrition','#mealprep'],
    keywordsSEO: ['best [product] for [diet]','[product] benefits','organic [product]','[product] recipe'],
    ads: ['Meta Ads: health & wellness interests','TikTok Ads','Google Search for high-intent diet terms'],
    osmFilters: [
      { k: 'shop', v: ['health_food','organic','supplements','grocery','convenience','deli','coffee','tea','beverages','greengrocer','farm'] },
      { k: 'amenity', v: ['cafe','restaurant'] },
    ],
  },
  {
    key: 'fitness_sports',
    label: 'Fitness & Sports',
    keywords: ['fitness','gym','workout','exercise','yoga','sport','running','bike','bicycle','weights','dumbbell','protein','athletic','training','outdoor','camping','hiking','fishing'],
    audience: { who: 'Active lifestyle consumers 18–45, goal-oriented', interests: ['fitness','weight loss','sports','outdoor activities','wellness'], intent: ['"best [gear] for beginners"','workout plans','transformation content'] },
    marketplaces: ['Amazon','eBay','Decathlon','Rogue','specialty sports marketplaces'],
    social: ['Instagram','TikTok','YouTube','Strava'],
    communities: ['r/Fitness','r/running','r/homegym','fitness Facebook groups'],
    hashtags: ['#fitness','#workout','#fitfam','#gymlife','#running','#fitnessmotivation'],
    keywordsSEO: ['best [product] for beginners','[product] workout','home [product]','[product] review'],
    ads: ['Meta Ads: fitness interests & lookalikes','TikTok Ads','YouTube fitness channels'],
    osmFilters: [
      { k: 'shop', v: ['sports','bicycle','outdoor','fishing','hunting'] },
      { k: 'leisure', v: ['fitness_centre','sports_centre','sports_hall'] },
    ],
  },
  {
    key: 'baby_kids',
    label: 'Baby, Kids & Parenting',
    keywords: ['baby','kid','child','toy','infant','toddler','diaper','stroller','nursery','parenting','school','educational','game','puzzle','children'],
    audience: { who: 'Parents 25–45 (esp. mothers), safety & value driven', interests: ['parenting','child development','education','family activities'], intent: ['"best [product] for toddlers"','safety reviews','gift ideas'] },
    marketplaces: ['Amazon','Etsy','eBay','Facebook Marketplace','buybuy Baby'],
    social: ['Instagram','Pinterest','TikTok','Facebook (parent groups)'],
    communities: ['r/Parenting','r/Mommit','r/daddit','local parenting Facebook groups'],
    hashtags: ['#momlife','#parenting','#kidsactivities','#toddlerlife','#momsofinstagram'],
    keywordsSEO: ['best [product] for [age]','safe [product]','educational [product]','[product] for kids'],
    ads: ['Meta Ads: parent interests & life events','Pinterest Ads','Google Shopping'],
    osmFilters: [
      { k: 'shop', v: ['toys','baby_goods','clothes','games'] },
      { k: 'amenity', v: ['kindergarten','childcare','school'] },
    ],
  },
  {
    key: 'b2b_software',
    label: 'Software / SaaS / Digital',
    keywords: ['software','saas','app','platform','tool','crm','automation','ai','digital','online','subscription','dashboard','analytics','course','ebook','template','plugin'],
    audience: { who: 'Businesses, founders, freelancers & professionals', interests: ['productivity','growth','automation','marketing','their industry niche'], intent: ['"best [tool] for [use case]"','alternatives & comparisons','free trial searches'] },
    marketplaces: ['Product Hunt','AppSumo','G2','Capterra','GitHub','Gumroad (digital)'],
    social: ['LinkedIn','X/Twitter','YouTube','Reddit'],
    communities: ['r/SaaS','r/Entrepreneur','Indie Hackers','niche professional LinkedIn groups'],
    hashtags: ['#saas','#startup','#productivity','#nocode','#buildinpublic'],
    keywordsSEO: ['best [tool] for [job]','[tool] alternative','[competitor] vs','[tool] for small business'],
    ads: ['LinkedIn Ads (B2B targeting)','Google Search (high intent)','Reddit Ads','retargeting'],
    osmFilters: [{ k: 'office', v: ['company','it','consulting','advertising_agency','financial','insurance','estate_agent','lawyer','accountant'] }],
    contactsNote: 'For SaaS, the buyers are businesses — these are real companies/offices you can pitch directly.',
  },
  {
    key: 'pets',
    label: 'Pets & Animals',
    keywords: ['pet','dog','puppy','puppies','cat','kitten','animal','aquarium','bird','leash','collar','grooming','litter','veterinary','treats','chew','kennel'],
    audience: { who: 'Pet owners 20–55, treat pets as family', interests: ['pet care','training','pet health','cute pet content'], intent: ['"best [product] for [pet]"','health/behavior solutions','gift for pet'] },
    marketplaces: ['Amazon','Chewy','Etsy','eBay','Petco marketplace'],
    social: ['Instagram','TikTok','Facebook','YouTube'],
    communities: ['r/dogs','r/cats','r/pets','breed-specific Facebook groups'],
    hashtags: ['#dogsofinstagram','#catsofinstagram','#petcare','#doglife','#petsofttiktok'],
    keywordsSEO: ['best [product] for dogs','[product] for [breed]','natural [product]','[product] review'],
    ads: ['Meta Ads: pet owner interests','TikTok Ads','Google Shopping'],
    osmFilters: [
      { k: 'shop', v: ['pet','pet_grooming'] },
      { k: 'amenity', v: ['veterinary'] },
    ],
  },
];

const GENERIC = {
  key: 'general',
  label: 'General Consumer Product',
  audience: { who: 'General online shoppers seeking value & convenience', interests: ['deals','reviews','trending products','convenience'], intent: ['"best [product]"','"[product] reviews"','price comparisons'] },
  marketplaces: ['Amazon','eBay','Etsy','Facebook Marketplace','Walmart marketplace'],
  social: ['Instagram','TikTok','Facebook','Pinterest'],
  communities: ['r/BuyItForLife','r/shutupandtakemymoney','product review groups'],
  hashtags: ['#musthave','#producthunt','#shopping','#trending','#review'],
  keywordsSEO: ['best [product]','[product] review','[product] vs','affordable [product]','where to buy [product]'],
  ads: ['Meta Ads + lookalike audiences','Google Shopping & Search','TikTok Ads'],
  osmFilters: [{ k: 'shop', v: ['general','department_store','variety_store','convenience','supermarket','gift'] }],
};

// ---------- The "AI" classifier ----------
function scoreNiche(text, niche) {
  let score = 0;
  for (const kw of niche.keywords) {
    if (text.includes(kw)) score += kw.length > 5 ? 3 : 2; // longer keywords = more specific
  }
  return score;
}

function detectAudienceModifiers(text) {
  const mods = [];
  if (/\b(luxur|premium|high-end|exclusive|designer)\b/.test(text)) mods.push('Premium/luxury positioning → target higher-income segments, emphasize quality & status.');
  if (/\b(cheap|affordable|budget|low-cost|discount)\b/.test(text)) mods.push('Budget positioning → target deal-seekers, emphasize price & value, use coupon channels.');
  if (/\b(eco|sustainab|organic|natural|cruelty-free|vegan|green)\b/.test(text)) mods.push('Eco/ethical angle → target conscious consumers, highlight certifications & values.');
  if (/\b(handmade|artisan|custom|personali)\b/.test(text)) mods.push('Handmade/custom → Etsy & craft marketplaces are ideal; lean into storytelling.');
  if (/\b(men|man|male|guy)\b/.test(text)) mods.push('Skews male audience → adjust messaging & visuals accordingly.');
  if (/\b(women|woman|female|lady|girl)\b/.test(text)) mods.push('Skews female audience → Pinterest & Instagram perform well.');
  if (/\b(kid|child|baby|toddler|teen)\b/.test(text)) mods.push('Audience is parents (buyers) for children (users) → market to parents.');
  if (/\b(business|company|professional|enterprise|b2b)\b/.test(text)) mods.push('B2B/professional buyer → LinkedIn + high-intent search outperform social.');
  return mods;
}

function analyzeProduct(name, description) {
  const text = ((name || '') + ' ' + (description || '')).toLowerCase();
  if (!text.trim()) throw new Error('Enter a product name and description.');

  // score every niche, pick best
  const ranked = NICHES.map((n) => ({ n, score: scoreNiche(text, n) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0] && ranked[0].score > 0 ? ranked[0].n : GENERIC;
  const second = ranked[1] && ranked[1].score > 1 && ranked[1].n !== best ? ranked[1].n : null;

  const productToken = (name || 'product').trim().split(/\s+/).slice(0, 3).join(' ');
  const fill = (arr) => arr.map((s) => s.replace(/\[product\]/g, productToken.toLowerCase())
                                         .replace(/\[tool\]/g, productToken.toLowerCase()));

  const modifiers = detectAudienceModifiers(text);

  // Business types whose customers buy this product (real, contactable leads).
  const businessTypes = [];
  for (const f of (best.osmFilters || [])) for (const v of f.v) businessTypes.push(v.replace(/_/g, ' '));

  return {
    matchedNiche: best.label,
    nicheKey: best.key,
    confidence: best === GENERIC ? 'low (generic fallback)' : (ranked[0].score >= 6 ? 'high' : 'medium'),
    secondaryNiche: second ? second.label : null,
    productToken,
    audience: best.audience,
    modifiers,
    channels: {
      marketplaces: best.marketplaces,
      social: best.social,
      communities: best.communities,
    },
    hashtags: best.hashtags,
    keywordsSEO: fill(best.keywordsSEO),
    ads: best.ads,
    outreach: buildOutreach(productToken, description, best),
    osmFilters: best.osmFilters || [],
    businessTypes: [...new Set(businessTypes)],
    contactsNote: best.contactsNote || 'These are real businesses whose customers buy this kind of product — they are your B2B2C leads (resellers/stockists) and have public, contactable details.',
  };
}

// ---------- Real contact search (reuses the keyless OpenStreetMap engine) ----------
// Finds actual, contactable businesses (with emails/phones/websites) whose
// customers buy this product — in the location you choose.
async function searchCustomerContacts(analysis, place, limit) {
  if (!window.B2B) throw new Error('Search engine not loaded.');
  const B = window.B2B;
  const filters = analysis.osmFilters && analysis.osmFilters.length
    ? analysis.osmFilters
    : [{ k: 'shop', v: ['*'] }];

  const geo = await B.geocode(place);
  // build a one-off "sector" object the B2B query builder understands
  const pseudoSector = { filters };
  const ql = B.buildQuery([pseudoSector], geo, limit || 300);
  const elements = await B.runOverpass(ql);
  const records = elements.map(B.normalizeElement).filter(Boolean).map((r) => ({
    ...r,
    targetNiche: analysis.matchedNiche,
    product: analysis.productToken,
    collectedAt: Date.now(),
  }));
  return { location: geo.displayName, records };
}

// CSV for the contact leads.
function contactsToCSV(records) {
  const cols = [['name','Name'],['category','Business type'],['email','Email'],['phone','Phone'],['website','Website'],['facebook','Facebook'],['instagram','Instagram'],['address','Address'],['city','City'],['country','Country']];
  const esc = (v) => { if (v == null) v = ''; v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const head = cols.map(([, l]) => esc(l)).join(',');
  const lines = records.map((r) => cols.map(([k]) => esc(r[k])).join(','));
  return '﻿' + [head, ...lines].join('\r\n');
}

// ---------- Outreach copy generator ----------
function buildOutreach(product, description, niche) {
  const desc = (description || '').trim() || product;
  return {
    email: {
      subject: `Quick question about ${product}`,
      body:
`Hi {{first_name}},

I noticed you're into ${niche.label.toLowerCase()} — I thought ${product} might be a great fit for you.

${capitalize(desc)}

If that sounds useful, here's a special intro offer: {{offer_link}}

No pressure at all — happy to answer any questions.

Best,
{{your_name}}
{{company}}

(You're receiving this because of your public interest in this category. Reply "STOP" to opt out.)`,
    },
    dm: `Hey {{first_name}}! 👋 Saw you love ${niche.label.toLowerCase()} — we just launched ${product}: ${shorten(desc, 90)} Want me to send you a discount code?`,
    adHeadline: `Discover ${product} — ${shorten(desc, 40)}`,
  };
}

function capitalize(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }
function shorten(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; }

// ---------- Build clickable research links (open in new tab) ----------
function buildResearchLinks(analysis, product) {
  const q = encodeURIComponent(product);
  const links = [];
  links.push({ label: 'Reddit — find buyer discussions', url: `https://www.reddit.com/search/?q=${q}` });
  links.push({ label: 'Google — "best ' + product + '" buyers', url: `https://www.google.com/search?q=${encodeURIComponent('best ' + product + ' reddit')}` });
  links.push({ label: 'TikTok — trending content', url: `https://www.tiktok.com/search?q=${q}` });
  links.push({ label: 'Instagram hashtag', url: `https://www.instagram.com/explore/tags/${encodeURIComponent(product.replace(/\s+/g,''))}/` });
  links.push({ label: 'Pinterest — buyer intent', url: `https://www.pinterest.com/search/pins/?q=${q}` });
  links.push({ label: 'YouTube — review audiences', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(product + ' review')}` });
  links.push({ label: 'Facebook — groups & marketplace', url: `https://www.facebook.com/search/groups/?q=${q}` });
  links.push({ label: 'Amazon — competitor reviews', url: `https://www.amazon.com/s?k=${q}` });
  return links;
}

// ---------- CSV export of the plan ----------
function planToCSV(analysis) {
  const rows = [['Section', 'Item']];
  rows.push(['Matched niche', analysis.matchedNiche]);
  rows.push(['Confidence', analysis.confidence]);
  if (analysis.secondaryNiche) rows.push(['Secondary niche', analysis.secondaryNiche]);
  rows.push(['Customer (who)', analysis.audience.who]);
  analysis.audience.interests.forEach((i) => rows.push(['Interest', i]));
  analysis.audience.intent.forEach((i) => rows.push(['Buying intent signal', i]));
  analysis.modifiers.forEach((m) => rows.push(['Strategy note', m]));
  analysis.channels.marketplaces.forEach((m) => rows.push(['Marketplace', m]));
  analysis.channels.social.forEach((m) => rows.push(['Social channel', m]));
  analysis.channels.communities.forEach((m) => rows.push(['Community', m]));
  analysis.hashtags.forEach((h) => rows.push(['Hashtag', h]));
  analysis.keywordsSEO.forEach((k) => rows.push(['SEO / search keyword', k]));
  analysis.ads.forEach((a) => rows.push(['Ad targeting', a]));
  const esc = (v) => { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

window.B2C = { analyzeProduct, buildResearchLinks, planToCSV, searchCustomerContacts, contactsToCSV };
