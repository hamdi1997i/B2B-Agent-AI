'use strict';

const $ = (id) => document.getElementById(id);
const state = { sectors: [], selected: new Set(), page: 1, pageSize: 50, polling: null };

async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

// ---------- INIT ----------
async function init() {
  const cfg = await api('/api/config');
  state.sectors = cfg.sectors;

  // sector chips
  const chips = $('sectorChips');
  cfg.sectors.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'chip active';
    el.textContent = s.label;
    el.dataset.key = s.key;
    state.selected.add(s.key);
    el.onclick = () => {
      el.classList.toggle('active');
      if (el.classList.contains('active')) state.selected.add(s.key);
      else state.selected.delete(s.key);
    };
    chips.appendChild(el);
  });

  // filter dropdowns
  cfg.domains.forEach((d) => $('fDomain').appendChild(opt(d, d)));
  cfg.needs.forEach((n) => $('fNeed').appendChild(opt(n, prettyNeed(n))));

  bindEvents();
  await refreshStats();
  await loadTable();
}

function opt(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

const NEED_LABELS = {
  software: 'Software / IT', packaging: 'Packaging', marketing: 'Marketing / Ads',
  logistics: 'Logistics / Shipping', equipment: 'Equipment / Machinery', raw_materials: 'Raw materials',
  furniture: 'Furniture / Fit-out', cleaning: 'Cleaning / Hygiene', security: 'Security',
  payments: 'Payments / Fintech', hr_recruitment: 'HR / Recruitment', accounting: 'Accounting',
  training: 'Training', energy: 'Energy',
};
const prettyNeed = (n) => NEED_LABELS[n] || n;

// ---------- EVENTS ----------
function bindEvents() {
  $('runBtn').onclick = runAgent;
  $('clearBtn').onclick = clearDb;
  $('exportBtn').onclick = exportCsv;
  ['fDomain', 'fNeed', 'fEmail', 'fPhone', 'fWebsite'].forEach((id) => {
    $(id).onchange = () => { state.page = 1; loadTable(); };
  });
  let t;
  $('fSearch').oninput = () => { clearTimeout(t); t = setTimeout(() => { state.page = 1; loadTable(); }, 300); };
  $('prevPage').onclick = () => { if (state.page > 1) { state.page--; loadTable(); } };
  $('nextPage').onclick = () => { state.page++; loadTable(); };
}

// ---------- COLLECTION ----------
async function runAgent() {
  const place = $('place').value.trim();
  if (!place) return alert('Enter a city / region first.');
  if (state.selected.size === 0) return alert('Select at least one sector.');

  $('runBtn').disabled = true;
  const prog = $('progress');
  prog.classList.remove('hidden');
  prog.classList.add('indeterminate');
  $('progressMsg').textContent = 'Starting agent…';

  const res = await api('/api/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      place,
      sectors: [...state.selected],
      limit: Number($('limit').value) || 400,
      enrich: $('enrich').checked,
    }),
  });

  if (res.error) {
    $('progressMsg').textContent = '⚠ ' + res.error;
    prog.classList.remove('indeterminate');
    $('runBtn').disabled = false;
    return;
  }
  pollJob();
}

function pollJob() {
  clearInterval(state.polling);
  state.polling = setInterval(async () => {
    const { job } = await api('/api/job');
    if (!job) return;
    const prog = $('progress');
    $('progressMsg').textContent = job.message || job.phase;

    if (job.phase === 'enriching' && job.enrichTotal > 0) {
      prog.classList.remove('indeterminate');
      $('barFill').style.width = Math.round((job.enrichDone / job.enrichTotal) * 100) + '%';
    } else if (job.status === 'running') {
      prog.classList.add('indeterminate');
    }

    if (job.status === 'done' || job.status === 'error') {
      clearInterval(state.polling);
      prog.classList.remove('indeterminate');
      $('barFill').style.width = '100%';
      $('runBtn').disabled = false;
      await refreshStats();
      state.page = 1;
      await loadTable();
    }
  }, 1200);
}

async function clearDb() {
  if (!confirm('Delete all collected companies?')) return;
  await api('/api/clear', { method: 'POST' });
  await refreshStats();
  await loadTable();
}

// ---------- STATS ----------
async function refreshStats() {
  const s = await api('/api/stats');
  $('statPills').innerHTML = '';
  const pills = [
    ['Companies', s.total],
    ['With email', s.withEmail],
    ['With phone', s.withPhone],
    ['With website', s.withWebsite],
  ];
  pills.forEach(([label, val]) => {
    const el = document.createElement('div');
    el.className = 'pill';
    el.innerHTML = `${label} <b>${val}</b>`;
    $('statPills').appendChild(el);
  });
}

// ---------- TABLE ----------
function currentFilterQS() {
  const qs = new URLSearchParams();
  if ($('fDomain').value) qs.set('domain', $('fDomain').value);
  if ($('fNeed').value) qs.set('need', $('fNeed').value);
  if ($('fSearch').value.trim()) qs.set('q', $('fSearch').value.trim());
  if ($('fEmail').checked) qs.set('hasEmail', '1');
  if ($('fPhone').checked) qs.set('hasPhone', '1');
  if ($('fWebsite').checked) qs.set('hasWebsite', '1');
  return qs;
}

async function loadTable() {
  const qs = currentFilterQS();
  qs.set('page', state.page);
  qs.set('pageSize', state.pageSize);
  const data = await api('/api/companies?' + qs.toString());

  const tbody = $('tbody');
  tbody.innerHTML = '';
  if (!data.rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">No companies yet. Run the agent above to collect data.</td></tr>`;
  } else {
    data.rows.forEach((c) => tbody.appendChild(rowEl(c)));
  }

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  $('pageInfo').textContent = `Page ${data.page} / ${pages} · ${data.total} matches`;
  $('prevPage').disabled = data.page <= 1;
  $('nextPage').disabled = data.page >= pages;
}

function rowEl(c) {
  const tr = document.createElement('tr');
  const social = [];
  if (c.website) social.push(`<a href="${esc(c.website)}" target="_blank" rel="noopener">🌐</a>`);
  if (c.facebook) social.push(`<a href="${esc(c.facebook)}" target="_blank" rel="noopener">📘</a>`);
  if (c.instagram) social.push(`<a href="${esc(c.instagram)}" target="_blank" rel="noopener">📷</a>`);
  if (c.linkedin) social.push(`<a href="${esc(c.linkedin)}" target="_blank" rel="noopener">in</a>`);

  const needs = (c.needs || []).map((n) => `<span class="need">${esc(prettyNeed(n))}</span>`).join('');
  const loc = [c.city, c.country].filter(Boolean).join(', ') || c.address || '—';

  tr.innerHTML = `
    <td class="cname">${esc(c.name)}</td>
    <td><span class="badge">${esc(c.domain || '')}</span></td>
    <td class="muted">${esc(c.category || '')}</td>
    <td><div class="needs">${needs}</div></td>
    <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '<span class="muted">—</span>'}</td>
    <td>${c.phone ? esc(c.phone) : '<span class="muted">—</span>'}</td>
    <td><div class="social">${social.join('') || '<span class="muted">—</span>'}</div></td>
    <td class="muted">${esc(loc)}</td>`;
  return tr;
}

function exportCsv() {
  const qs = currentFilterQS();
  window.location = '/api/export?' + qs.toString();
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
