'use strict';

/**
 * Free, keyless data sources:
 *   - Nominatim   : geocode a place name -> an OSM area to search inside.
 *   - Overpass API: fetch all businesses (with contact details) in that area.
 *
 * A polite User-Agent is sent as required by the OSM usage policy.
 */

const UA = 'B2B-Agent-AI/1.0 (self-hosted lead research tool)';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function fetchWithTimeout(url, opts = {}, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Geocode a place name into an Overpass area filter.
 * Returns { areaId, displayName } where areaId can be used as area(areaId).
 * Falls back to a bounding box if the place is only a node.
 */
async function geocode(place) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(place);
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } }, 20000);
  if (!res.ok) throw new Error('Geocoding failed (' + res.status + ')');
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Place not found: "' + place + '". Try "City, Country".');
  }
  const hit = data[0];
  let areaId = null;
  if (hit.osm_type === 'relation') areaId = 3600000000 + Number(hit.osm_id);
  else if (hit.osm_type === 'way') areaId = 2400000000 + Number(hit.osm_id);

  return {
    areaId,
    bbox: hit.boundingbox ? hit.boundingbox.map(Number) : null, // [south, north, west, east]
    displayName: hit.display_name,
  };
}

/** Build an Overpass QL query for the given sectors within an area or bbox. */
function buildQuery(sectors, geo, limit) {
  const within = geo.areaId
    ? `(area:${geo.areaId})`
    : geo.bbox
    ? `(${geo.bbox[0]},${geo.bbox[2]},${geo.bbox[1]},${geo.bbox[3]})`
    : '';

  const lines = [];
  for (const sector of sectors) {
    for (const f of sector.filters) {
      let selector;
      if (f.v.length === 1 && f.v[0] === '*') {
        selector = `["${f.k}"]`;
      } else {
        selector = `["${f.k}"~"^(${f.v.join('|')})$"]`;
      }
      // nodes and ways carry the business POIs
      lines.push(`  nwr${selector}${within};`);
    }
  }

  const head = geo.areaId ? '' : '';
  return [
    `[out:json][timeout:120];`,
    head,
    `(`,
    lines.join('\n'),
    `);`,
    `out center ${limit};`,
  ].join('\n');
}

async function runOverpass(query) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: 'data=' + encodeURIComponent(query),
        },
        120000
      );
      if (!res.ok) {
        lastErr = new Error('Overpass error ' + res.status + ' at ' + endpoint);
        continue;
      }
      const json = await res.json();
      return json.elements || [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All Overpass endpoints failed');
}

/** Convert a raw OSM element into a normalized company record. */
function normalizeElement(el) {
  const t = el.tags || {};
  if (!t.name) return null; // skip unnamed POIs

  const lat = el.lat || (el.center && el.center.lat);
  const lon = el.lon || (el.center && el.center.lon);

  const addressParts = [
    [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
    t['addr:postcode'],
    t['addr:city'],
    t['addr:country'],
  ].filter(Boolean);

  let facebook = t['contact:facebook'] || (t.facebook && /facebook/.test(t.facebook) ? t.facebook : '');
  let website = t.website || t['contact:website'] || t.url || '';
  let email = t.email || t['contact:email'] || '';
  let phone = t.phone || t['contact:phone'] || t['contact:mobile'] || '';

  return {
    id: el.type + '/' + el.id,
    name: t.name,
    phone,
    email,
    website,
    facebook,
    instagram: t['contact:instagram'] || '',
    linkedin: t['contact:linkedin'] || '',
    address: addressParts.join(', '),
    city: t['addr:city'] || '',
    country: t['addr:country'] || '',
    lat,
    lon,
    osmTags: t,
    source: 'openstreetmap',
  };
}

module.exports = { geocode, buildQuery, runOverpass, normalizeElement };
