'use strict';

/* ============================================================
 * B2B Agent AI — fully client-side build (GitHub Pages).
 * Calls OpenStreetMap (Nominatim + Overpass) directly from the
 * browser. No backend, no API keys. Data is kept in localStorage.
 * ============================================================ */

// ---------- Sectors -> OpenStreetMap tag filters ----------
const SECTORS = [
  { key: 'food', label: 'Restaurants & Food', filters: [
    { k: 'amenity', v: ['restaurant','cafe','fast_food','bar','pub','food_court','ice_cream'] },
    { k: 'shop', v: ['bakery','pastry','butcher','deli','confectionery','greengrocer','seafood','cheese','coffee'] },
  ]},
  { key: 'retail', label: 'Retail Shops', filters: [
    { k: 'shop', v: ['supermarket','convenience','clothes','shoes','jewelry','gift','furniture','electronics','mobile_phone','hardware','florist','books','toys','sports','department_store','variety_store'] },
  ]},
  { key: 'health', label: 'Health & Medical', filters: [
    { k: 'amenity', v: ['pharmacy','clinic','hospital','doctors','dentist','veterinary'] },
    { k: 'healthcare', v: ['*'] },
    { k: 'shop', v: ['optician','medical_supply','chemist'] },
  ]},
  { key: 'beauty', label: 'Beauty & Wellness', filters: [
    { k: 'shop', v: ['hairdresser','beauty','cosmetics','massage','tattoo'] },
    { k: 'leisure', v: ['fitness_centre','sports_centre'] },
    { k: 'amenity', v: ['spa'] },
  ]},
  { key: 'professional', label: 'Professional Offices', filters: [
    { k: 'office', v: ['company','lawyer','accountant','estate_agent','insurance','financial','it','consulting','advertising_agency','architect','employment_agency','tax_advisor','engineer','logistics'] },
  ]},
  { key: 'crafts', label: 'Crafts & Construction', filters: [
    { k: 'craft', v: ['*'] },
    { k: 'shop', v: ['trade','doityourself','building_materials','paint'] },
  ]},
  { key: 'automotive', label: 'Automotive', filters: [
    { k: 'shop', v: ['car','car_repair','car_parts','tyres','motorcycle'] },
    { k: 'amenity', v: ['fuel','car_wash','car_rental'] },
  ]},
  { key: 'hospitality', label: 'Hotels & Tourism', filters: [
    { k: 'tourism', v: ['hotel','guest_house','hostel','motel','apartment','resort'] },
  ]},
  { key: 'industry', label: 'Industry & Manufacturing', filters: [
    { k: 'man_made', v: ['works'] },
    { k: 'industrial', v: ['*'] },
    { k: 'office', v: ['research','telecommunication'] },
    { k: 'craft', v: ['agricultural_engines','metal_construction','electronics_repair'] },
  ]},
  { key: 'education', label: 'Education', filters: [
    { k: 'amenity', v: ['school','college','university','kindergarten','language_school','driving_school','training'] },
  ]},
];

// ---------- Classification ----------
const ALL_NEEDS = ['software','packaging','marketing','logistics','equipment','raw_materials','furniture','cleaning','security','payments','hr_recruitment','accounting','training','energy'];

const NEEDS_BY_DOMAIN = {
  'Food & Beverage':        ['software','packaging','marketing','raw_materials','cleaning','payments','equipment'],
  'Retail':                 ['software','packaging','marketing','security','payments','logistics','furniture'],
  'Health & Medical':       ['software','equipment','cleaning','marketing','security','accounting'],
  'Beauty & Wellness':      ['software','marketing','raw_materials','furniture','payments','training'],
  'Professional Services':  ['software','marketing','accounting','hr_recruitment','furniture','training'],
  'Crafts & Construction':  ['equipment','raw_materials','logistics','software','security','marketing'],
  'Automotive':             ['equipment','raw_materials','software','marketing','logistics','payments'],
  'Hospitality & Tourism':  ['software','marketing','cleaning','furniture','payments','energy','hr_recruitment'],
  'Industry & Manufacturing': ['equipment','raw_materials','logistics','packaging','software','energy','security'],
  'Education':              ['software','furniture','marketing','training','equipment','security'],
  'Other':                  ['software','marketing'],
};
const ALL_DOMAINS = Object.keys(NEEDS_BY_DOMAIN);

function resolveDomain(t) {
  const { shop, amenity, office, craft, tourism, healthcare, leisure } = t;
  const FOOD_AMENITY=['restaurant','cafe','fast_food','bar','pub','food_court','ice_cream'];
  const FOOD_SHOP=['bakery','pastry','butcher','deli','confectionery','greengrocer','seafood','cheese','coffee','beverages','wine','alcohol'];
  const HEALTH_AMENITY=['pharmacy','clinic','hospital','doctors','dentist','veterinary'];
  const BEAUTY_SHOP=['hairdresser','beauty','cosmetics','massage','tattoo','perfumery'];
  const AUTO_SHOP=['car','car_repair','car_parts','tyres','motorcycle'];
  const AUTO_AMENITY=['fuel','car_wash','car_rental'];
  const EDU_AMENITY=['school','college','university','kindergarten','language_school','driving_school','training'];

  if (amenity && FOOD_AMENITY.includes(amenity)) return ['Food & Beverage', amenity];
  if (shop && FOOD_SHOP.includes(shop)) return ['Food & Beverage', shop];
  if (amenity && HEALTH_AMENITY.includes(amenity)) return ['Health & Medical', amenity];
  if (healthcare) return ['Health & Medical', healthcare === 'yes' ? 'healthcare' : healthcare];
  if (shop && ['optician','medical_supply','chemist'].includes(shop)) return ['Health & Medical', shop];
  if (shop && BEAUTY_SHOP.includes(shop)) return ['Beauty & Wellness', shop];
  if (leisure && ['fitness_centre','sports_centre'].includes(leisure)) return ['Beauty & Wellness', leisure];
  if (amenity === 'spa') return ['Beauty & Wellness', 'spa'];
  if (shop && AUTO_SHOP.includes(shop)) return ['Automotive', shop];
  if (amenity && AUTO_AMENITY.includes(amenity)) return ['Automotive', amenity];
  if (tourism && ['hotel','guest_house','hostel','motel','apartment','resort'].includes(tourism)) return ['Hospitality & Tourism', tourism];
  if (amenity && EDU_AMENITY.includes(amenity)) return ['Education', amenity];
  if (t.man_made === 'works' || t.industrial) return ['Industry & Manufacturing', t.industrial || 'works'];
  if (craft) return ['Crafts & Construction', craft];
  if (shop && ['trade','doityourself','building_materials','paint','hardware'].includes(shop)) return ['Crafts & Construction', shop];
  if (office) return ['Professional Services', office];
  if (shop) return ['Retail', shop];
  return ['Other', amenity || tourism || leisure || 'unknown'];
}
function classify(tags) {
  const [domain, category] = resolveDomain(tags || {});
  return { domain, category, needs: NEEDS_BY_DOMAIN[domain] || NEEDS_BY_DOMAIN['Other'] };
}

// ---------- OpenStreetMap access (direct from browser) ----------
const UA_NOTE = 'B2B-Agent-AI static';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function geocode(place) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(place);
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error('Geocoding failed (' + res.status + ')');
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('Place not found: "' + place + '". Try "City, Country".');
  const hit = data[0];
  let areaId = null;
  if (hit.osm_type === 'relation') areaId = 3600000000 + Number(hit.osm_id);
  else if (hit.osm_type === 'way') areaId = 2400000000 + Number(hit.osm_id);
  return { areaId, bbox: hit.boundingbox ? hit.boundingbox.map(Number) : null, displayName: hit.display_name };
}

function buildQuery(sectors, geo, limit) {
  const within = geo.areaId ? `(area:${geo.areaId})`
    : geo.bbox ? `(${geo.bbox[0]},${geo.bbox[2]},${geo.bbox[1]},${geo.bbox[3]})` : '';
  const lines = [];
  for (const sector of sectors) for (const f of sector.filters) {
    const selector = (f.v.length === 1 && f.v[0] === '*') ? `["${f.k}"]` : `["${f.k}"~"^(${f.v.join('|')})$"]`;
    lines.push(`  nwr${selector}${within};`);
  }
  return [`[out:json][timeout:120];`, `(`, lines.join('\n'), `);`, `out center ${limit};`].join('\n');
}

async function runOverpass(query) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) { lastErr = new Error('Overpass ' + res.status); continue; }
      const json = await res.json();
      return json.elements || [];
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All Overpass endpoints failed');
}

function normalizeElement(el) {
  const t = el.tags || {};
  if (!t.name) return null;
  const lat = el.lat || (el.center && el.center.lat);
  const lon = el.lon || (el.center && el.center.lon);
  const addressParts = [
    [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
    t['addr:postcode'], t['addr:city'], t['addr:country'],
  ].filter(Boolean);
  const c = classify(t);
  return {
    id: el.type + '/' + el.id,
    name: t.name,
    domain: c.domain, category: c.category, needs: c.needs,
    phone: t.phone || t['contact:phone'] || t['contact:mobile'] || '',
    email: t.email || t['contact:email'] || '',
    website: t.website || t['contact:website'] || t.url || '',
    facebook: t['contact:facebook'] || '',
    instagram: t['contact:instagram'] || '',
    linkedin: t['contact:linkedin'] || '',
    address: addressParts.join(', '),
    city: t['addr:city'] || '',
    country: t['addr:country'] || '',
    lat, lon, source: 'openstreetmap',
  };
}

// ---------- Local store (localStorage) ----------
const DB_KEY = 'b2b_agent_companies_v1';
function dbLoad() { try { return JSON.parse(localStorage.getItem(DB_KEY)) || []; } catch { return []; } }
function dbSave(rows) { localStorage.setItem(DB_KEY, JSON.stringify(rows)); }
function dbUpsert(records) {
  const byId = new Map(dbLoad().map((c) => [c.id, c]));
  let added = 0;
  for (const r of records) { if (byId.has(r.id)) byId.set(r.id, { ...byId.get(r.id), ...r }); else { byId.set(r.id, r); added++; } }
  const rows = [...byId.values()];
  dbSave(rows);
  return { total: rows.length, added };
}
function dbClear() { localStorage.removeItem(DB_KEY); }

function queryRows(f) {
  let rows = dbLoad();
  if (f.domain) rows = rows.filter((c) => c.domain === f.domain);
  if (f.need) rows = rows.filter((c) => (c.needs || []).includes(f.need));
  if (f.hasEmail) rows = rows.filter((c) => !!c.email);
  if (f.hasPhone) rows = rows.filter((c) => !!c.phone);
  if (f.hasWebsite) rows = rows.filter((c) => !!c.website);
  if (f.q) {
    const n = f.q.toLowerCase();
    rows = rows.filter((c) => [c.name,c.category,c.address,c.city,c.email,c.website].filter(Boolean).some((v) => String(v).toLowerCase().includes(n)));
  }
  return rows;
}
function statsOf() {
  const rows = dbLoad();
  let withEmail=0, withPhone=0, withWebsite=0; const byDomain={};
  for (const c of rows) { byDomain[c.domain]=(byDomain[c.domain]||0)+1; if(c.email)withEmail++; if(c.phone)withPhone++; if(c.website)withWebsite++; }
  return { total: rows.length, withEmail, withPhone, withWebsite, byDomain };
}

// ---------- CSV export ----------
const CSV_COLS = [['name','Name'],['domain','Domain'],['category','Category'],['needs','Purchase Needs'],['email','Email'],['phone','Phone'],['website','Website'],['facebook','Facebook'],['instagram','Instagram'],['linkedin','LinkedIn'],['address','Address'],['city','City'],['country','Country']];
function csvEsc(v){ if(v==null)v=''; if(Array.isArray(v))v=v.join(' | '); v=String(v); if(/[",\n]/.test(v))v='"'+v.replace(/"/g,'""')+'"'; return v; }
function toCSV(rows){ const head=CSV_COLS.map(([,l])=>csvEsc(l)).join(','); const lines=rows.map((r)=>CSV_COLS.map(([k])=>csvEsc(r[k])).join(',')); return '﻿'+[head,...lines].join('\r\n'); }

window.B2B = { SECTORS, ALL_NEEDS, ALL_DOMAINS, geocode, buildQuery, runOverpass, normalizeElement, dbUpsert, dbClear, queryRows, statsOf, toCSV };
