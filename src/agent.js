'use strict';

/**
 * The autonomous collection agent.
 * Pipeline: geocode -> query OpenStreetMap -> classify -> store -> enrich websites.
 * Exposes a single running job with live progress so the UI can show what it's doing.
 */

const { geocode, buildQuery, runOverpass, normalizeElement } = require('./overpass');
const { classify } = require('./classify');
const { enrichAll } = require('./enrich');
const store = require('./store');
const { SECTORS } = require('./sectors');

let job = null; // current/last job state

function getJob() {
  return job;
}

function setPhase(phase, message, extra = {}) {
  if (!job) return;
  job.phase = phase;
  job.message = message;
  Object.assign(job, extra);
  job.updatedAt = Date.now();
}

async function run({ place, sectorKeys, limit = 400, enrich = true }) {
  if (job && job.status === 'running') {
    throw new Error('A collection job is already running.');
  }

  const chosen = SECTORS.filter((s) => sectorKeys.includes(s.key));
  if (!chosen.length) throw new Error('Select at least one sector.');

  job = {
    id: Date.now().toString(36),
    status: 'running',
    phase: 'starting',
    message: 'Starting agent…',
    place,
    sectors: chosen.map((s) => s.label),
    found: 0,
    added: 0,
    enrichDone: 0,
    enrichTotal: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    error: null,
  };

  // run in background; the HTTP handler returns immediately
  (async () => {
    try {
      setPhase('geocoding', `Locating "${place}"…`);
      const geo = await geocode(place);
      setPhase('querying', `Searching businesses around ${geo.displayName.split(',')[0]}…`, {
        location: geo.displayName,
      });

      const ql = buildQuery(chosen, geo, limit);
      const elements = await runOverpass(ql);

      setPhase('classifying', `Found ${elements.length} places. Classifying…`);
      const records = [];
      for (const el of elements) {
        const rec = normalizeElement(el);
        if (!rec) continue;
        const c = classify(rec.osmTags);
        rec.domain = c.domain;
        rec.category = c.category;
        rec.needs = c.needs;
        rec.collectedAt = Date.now();
        rec.queryPlace = place;
        delete rec.osmTags; // keep stored records lean
        records.push(rec);
      }

      job.found = records.length;

      // store base records first so they appear even if enrichment is slow
      const res1 = store.upsertMany(records);
      job.added = res1.added;
      setPhase('stored', `Saved ${records.length} companies.`);

      if (enrich) {
        const toEnrich = records.filter((r) => r.website);
        job.enrichTotal = toEnrich.length;
        setPhase('enriching', `Visiting ${toEnrich.length} websites for emails & socials…`);
        const enriched = await enrichAll(records, 6, (done, total) => {
          job.enrichDone = done;
          job.enrichTotal = total;
          job.message = `Enriching websites ${done}/${total}…`;
          job.updatedAt = Date.now();
        });
        store.upsertMany(enriched);
      }

      const s = store.stats();
      job.status = 'done';
      setPhase('done', `Done. ${records.length} companies collected (${s.withEmail} with email).`, {
        totalInDb: s.total,
      });
    } catch (e) {
      job.status = 'error';
      job.error = e.message || String(e);
      setPhase('error', 'Error: ' + job.error);
    }
  })();

  return job;
}

module.exports = { run, getJob };
