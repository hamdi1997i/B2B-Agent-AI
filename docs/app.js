'use strict';

const $ = (id) => document.getElementById(id);
const state = { selected: new Set(), page: 1, pageSize: 50 };

const NEED_LABELS = {
  software:'Software / IT', packaging:'Packaging', marketing:'Marketing / Ads',
  logistics:'Logistics / Shipping', equipment:'Equipment / Machinery', raw_materials:'Raw materials',
  furniture:'Furniture / Fit-out', cleaning:'Cleaning / Hygiene', security:'Security',
  payments:'Payments / Fintech', hr_recruitment:'HR / Recruitment', accounting:'Accounting',
  training:'Training', energy:'Energy',
};
const prettyNeed = (n) => NEED_LABELS[n] || n;

function init() {
  const B = window.B2B;
  const chips = $('sectorChips');
  B.SECTORS.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'chip active';
    el.textContent = s.label;
    el.dataset.key = s.key;
    state.selected.add(s.key);
    el.onclick = () => { el.classList.toggle('active'); el.classList.contains('active') ? state.selected.add(s.key) : state.selected.delete(s.key); };
    chips.appendChild(el);
  });
  B.ALL_DOMAINS.forEach((d) => $('fDomain').appendChild(opt(d, d)));
  B.ALL_NEEDS.forEach((n) => $('fNeed').appendChild(opt(n, prettyNeed(n))));
  bindEvents();
  refreshStats();
  loadTable();
}
function opt(value, label) { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }

function bindEvents() {
  $('runBtn').onclick = runAgent;
  $('clearBtn').onclick = clearDb;
  $('exportBtn').onclick = exportCsv;
  ['fDomain','fNeed','fEmail','fPhone','fWebsite'].forEach((id) => { $(id).onchange = () => { state.page = 1; loadTable(); }; });
  let t; $('fSearch').oninput = () => { clearTimeout(t); t = setTimeout(() => { state.page = 1; loadTable(); }, 300); };
  $('prevPage').onclick = () => { if (state.page > 1) { state.page--; loadTable(); } };
  $('nextPage').onclick = () => { state.page++; loadTable(); };
}

async function runAgent() {
  const B = window.B2B;
  const place = $('place').value.trim();
  if (!place) return alert('Enter a city / region first.');
  if (state.selected.size === 0) return alert('Select at least one sector.');
  const limit = Math.min(Number($('limit').value) || 400, 2000);

  $('runBtn').disabled = true;
  const prog = $('progress');
  prog.classList.remove('hidden'); prog.classList.add('indeterminate');
  $('barFill').style.width = '0%';
  const say = (m) => { $('progressMsg').textContent = m; };

  try {
    say('Locating "' + place + '"…');
    const geo = await B.geocode(place);
    say('Searching businesses around ' + geo.displayName.split(',')[0] + '…');
    const chosen = B.SECTORS.filter((s) => state.selected.has(s.key));
    const ql = B.buildQuery(chosen, geo, limit);
    const els = await B.runOverpass(ql);
    say('Found ' + els.length + ' places. Classifying…');
    const records = els.map(B.normalizeElement).filter(Boolean).map((r) => ({ ...r, collectedAt: Date.now(), queryPlace: place }));
    const res = B.dbUpsert(records);
    prog.classList.remove('indeterminate'); $('barFill').style.width = '100%';
    const s = B.statsOf();
    say('Done. ' + records.length + ' companies collected (' + res.added + ' new, ' + s.withEmail + ' with email).');
  } catch (e) {
    prog.classList.remove('indeterminate');
    say('⚠ ' + (e.message || e));
  } finally {
    $('runBtn').disabled = false;
    refreshStats(); state.page = 1; loadTable();
  }
}

function clearDb() {
  if (!confirm('Delete all collected companies?')) return;
  window.B2B.dbClear(); refreshStats(); loadTable();
}

function refreshStats() {
  const s = window.B2B.statsOf();
  $('statPills').innerHTML = '';
  [['Companies', s.total],['With email', s.withEmail],['With phone', s.withPhone],['With website', s.withWebsite]]
    .forEach(([label, val]) => { const el = document.createElement('div'); el.className = 'pill'; el.innerHTML = label + ' <b>' + val + '</b>'; $('statPills').appendChild(el); });
}

function currentFilters() {
  return {
    domain: $('fDomain').value, need: $('fNeed').value, q: $('fSearch').value.trim(),
    hasEmail: $('fEmail').checked, hasPhone: $('fPhone').checked, hasWebsite: $('fWebsite').checked,
  };
}

function loadTable() {
  const rows = window.B2B.queryRows(currentFilters());
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);

  const tbody = $('tbody'); tbody.innerHTML = '';
  if (!pageRows.length) tbody.innerHTML = '<tr><td colspan="8" class="empty">No companies yet. Run the agent above to collect data.</td></tr>';
  else pageRows.forEach((c) => tbody.appendChild(rowEl(c)));

  $('pageInfo').textContent = 'Page ' + state.page + ' / ' + pages + ' · ' + total + ' matches';
  $('prevPage').disabled = state.page <= 1;
  $('nextPage').disabled = state.page >= pages;
}

function rowEl(c) {
  const tr = document.createElement('tr');
  const social = [];
  if (c.website) social.push('<a href="' + esc(c.website) + '" target="_blank" rel="noopener">🌐</a>');
  if (c.facebook) social.push('<a href="' + esc(c.facebook) + '" target="_blank" rel="noopener">📘</a>');
  if (c.instagram) social.push('<a href="' + esc(c.instagram) + '" target="_blank" rel="noopener">📷</a>');
  if (c.linkedin) social.push('<a href="' + esc(c.linkedin) + '" target="_blank" rel="noopener">in</a>');
  const needs = (c.needs || []).map((n) => '<span class="need">' + esc(prettyNeed(n)) + '</span>').join('');
  const loc = [c.city, c.country].filter(Boolean).join(', ') || c.address || '—';
  tr.innerHTML =
    '<td class="cname">' + esc(c.name) + '</td>' +
    '<td><span class="badge">' + esc(c.domain || '') + '</span></td>' +
    '<td class="muted">' + esc(c.category || '') + '</td>' +
    '<td><div class="needs">' + needs + '</div></td>' +
    '<td>' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '<span class="muted">—</span>') + '</td>' +
    '<td>' + (c.phone ? esc(c.phone) : '<span class="muted">—</span>') + '</td>' +
    '<td><div class="social">' + (social.join('') || '<span class="muted">—</span>') + '</div></td>' +
    '<td class="muted">' + esc(loc) + '</td>';
  return tr;
}

function exportCsv() {
  const rows = window.B2B.queryRows(currentFilters());
  if (!rows.length) return alert('Nothing to export with the current filters.');
  const csv = window.B2B.toCSV(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'b2b-targets.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

init();
