'use strict';

/**
 * Tiny zero-dependency JSON datastore.
 * Stores all collected companies in data/db.json and supports filtered queries.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ companies: [] }, null, 0));
}

function load() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { companies: [] };
  }
}

function save(db) {
  ensure();
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
}

/** Insert or update many records, de-duplicating by id. */
function upsertMany(records) {
  const db = load();
  const byId = new Map(db.companies.map((c) => [c.id, c]));
  let added = 0;
  for (const r of records) {
    if (byId.has(r.id)) {
      byId.set(r.id, { ...byId.get(r.id), ...r });
    } else {
      byId.set(r.id, r);
      added++;
    }
  }
  db.companies = [...byId.values()];
  save(db);
  return { total: db.companies.length, added };
}

function all() {
  return load().companies;
}

function clear() {
  save({ companies: [] });
}

/** Filter companies by domain, need, free-text query, and contact flags. */
function query(filters = {}) {
  const { domain, need, q, hasEmail, hasPhone, hasWebsite, country } = filters;
  let rows = all();

  if (domain) rows = rows.filter((c) => c.domain === domain);
  if (need) rows = rows.filter((c) => Array.isArray(c.needs) && c.needs.includes(need));
  if (country) rows = rows.filter((c) => (c.country || '').toLowerCase() === country.toLowerCase());
  if (hasEmail) rows = rows.filter((c) => !!c.email);
  if (hasPhone) rows = rows.filter((c) => !!c.phone);
  if (hasWebsite) rows = rows.filter((c) => !!c.website);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((c) =>
      [c.name, c.category, c.address, c.city, c.email, c.website]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }
  return rows;
}

function stats() {
  const rows = all();
  const byDomain = {};
  const byNeed = {};
  let withEmail = 0,
    withPhone = 0,
    withWebsite = 0;
  for (const c of rows) {
    byDomain[c.domain] = (byDomain[c.domain] || 0) + 1;
    for (const n of c.needs || []) byNeed[n] = (byNeed[n] || 0) + 1;
    if (c.email) withEmail++;
    if (c.phone) withPhone++;
    if (c.website) withWebsite++;
  }
  return { total: rows.length, withEmail, withPhone, withWebsite, byDomain, byNeed };
}

module.exports = { upsertMany, all, clear, query, stats, DB_FILE };
