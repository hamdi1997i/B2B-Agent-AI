'use strict';

/**
 * Enrichment: visit a company's website and pull out contact details that are
 * missing from OpenStreetMap (emails, phones, Facebook / Instagram / LinkedIn).
 * Pure regex extraction over the homepage and a likely contact page.
 * No external libraries, no API keys.
 */

const UA = 'Mozilla/5.0 (compatible; B2B-Agent-AI/1.0; lead research)';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}/g;
const PHONE_RE = /(?:\+?\d[\d\s().-]{6,}\d)/g;
const FB_RE = /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.\-/?=&%]+/i;
const IG_RE = /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.\-/?=&%]+/i;
const LI_RE = /https?:\/\/(?:www\.)?linkedin\.com\/[A-Za-z0-9_.\-/?=&%]+/i;

const BAD_EMAIL_HINT = /\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i;
const BAD_EMAIL_PREFIX = /^(example|test|your|email|user|name|info@example)/i;

async function fetchText(url, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) return '';
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return '';
    const buf = await res.arrayBuffer();
    // cap at ~1.5MB to stay fast
    return Buffer.from(buf.slice(0, 1_500_000)).toString('utf8');
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

function cleanEmails(list) {
  const out = new Set();
  for (let e of list) {
    e = e.trim().toLowerCase();
    if (BAD_EMAIL_HINT.test(e)) continue;
    if (BAD_EMAIL_PREFIX.test(e)) continue;
    if (e.length > 60) continue;
    out.add(e);
  }
  return [...out];
}

function cleanPhones(list) {
  const out = new Set();
  for (let p of list) {
    const digits = p.replace(/[^\d+]/g, '');
    if (digits.replace(/\D/g, '').length < 8) continue;
    if (digits.replace(/\D/g, '').length > 15) continue;
    out.add(p.trim());
  }
  return [...out].slice(0, 3);
}

function extract(html) {
  // also catch mailto: links explicitly
  const mailtos = [...html.matchAll(/mailto:([^"'>\s?]+)/gi)].map((m) => m[1]);
  const emails = cleanEmails([...(html.match(EMAIL_RE) || []), ...mailtos]);
  const phones = cleanPhones(html.match(PHONE_RE) || []);
  const fb = (html.match(FB_RE) || [])[0] || '';
  const ig = (html.match(IG_RE) || [])[0] || '';
  const li = (html.match(LI_RE) || [])[0] || '';
  return { emails, phones, facebook: fb, instagram: ig, linkedin: li };
}

function normalizeUrl(website) {
  if (!website) return null;
  let u = website.trim();
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

/** Enrich one record in place (returns a new object). */
async function enrichRecord(rec) {
  const base = normalizeUrl(rec.website);
  if (!base) return rec;

  const pages = [base.href];
  // try a contact page too
  for (const path of ['contact', 'contact-us', 'contacts', 'about', 'a-propos', 'kontakt']) {
    pages.push(new URL('/' + path, base).href);
  }

  let merged = { emails: [], phones: [], facebook: '', instagram: '', linkedin: '' };
  for (const p of pages.slice(0, 3)) {
    const html = await fetchText(p);
    if (!html) continue;
    const data = extract(html);
    merged.emails = [...new Set([...merged.emails, ...data.emails])];
    merged.phones = [...new Set([...merged.phones, ...data.phones])];
    merged.facebook = merged.facebook || data.facebook;
    merged.instagram = merged.instagram || data.instagram;
    merged.linkedin = merged.linkedin || data.linkedin;
    if (merged.emails.length) break; // got what we mainly want
  }

  return {
    ...rec,
    email: rec.email || merged.emails[0] || '',
    emailsAll: merged.emails,
    phone: rec.phone || merged.phones[0] || '',
    facebook: rec.facebook || merged.facebook || '',
    instagram: rec.instagram || merged.instagram || '',
    linkedin: rec.linkedin || merged.linkedin || '',
    enriched: true,
  };
}

/** Run enrichment over many records with limited concurrency. */
async function enrichAll(records, concurrency, onProgress) {
  const queue = records.filter((r) => r.website);
  let i = 0;
  let done = 0;
  const results = new Map();

  async function worker() {
    while (i < queue.length) {
      const idx = i++;
      const rec = queue[idx];
      try {
        const out = await enrichRecord(rec);
        results.set(rec.id, out);
      } catch {
        /* ignore single-site failures */
      }
      done++;
      if (onProgress) onProgress(done, queue.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker);
  await Promise.all(workers);

  return records.map((r) => results.get(r.id) || r);
}

module.exports = { enrichRecord, enrichAll };
