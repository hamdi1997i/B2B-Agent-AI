'use strict';

const $ = (id) => document.getElementById(id);

function run() {
  const name = $('pname').value.trim();
  const desc = $('pdesc').value.trim();
  const out = $('b2cResult');
  if (!name && !desc) { alert('Enter at least a product name or description.'); return; }

  let a;
  try { a = window.B2C.analyzeProduct(name, desc); }
  catch (e) { out.innerHTML = '<p class="empty">⚠ ' + esc(e.message) + '</p>'; return; }
  window._lastAnalysis = a;

  const links = window.B2C.buildResearchLinks(a, a.productToken);

  out.innerHTML = `
    <div class="b2c-grid">
      <div class="b2c-card">
        <h3>🎯 Ideal Customer Profile</h3>
        <p class="match">Niche: <b>${esc(a.matchedNiche)}</b> <span class="conf">confidence: ${esc(a.confidence)}</span>${a.secondaryNiche ? ' · also: ' + esc(a.secondaryNiche) : ''}</p>
        <p><b>Who buys this:</b> ${esc(a.audience.who)}</p>
        <p><b>Interests:</b> ${a.audience.interests.map(tag).join(' ')}</p>
        <p><b>Buying-intent signals:</b></p>
        <ul>${a.audience.intent.map((i) => '<li>' + esc(i) + '</li>').join('')}</ul>
        ${a.modifiers.length ? '<p><b>Strategy notes:</b></p><ul>' + a.modifiers.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul>' : ''}
      </div>

      <div class="b2c-card">
        <h3>📍 Where to find these customers</h3>
        <p><b>Marketplaces (list/sell here):</b></p>
        <p>${a.channels.marketplaces.map(tag).join(' ')}</p>
        <p><b>Social platforms:</b></p>
        <p>${a.channels.social.map(tag).join(' ')}</p>
        <p><b>Communities & groups:</b></p>
        <p>${a.channels.communities.map(tag).join(' ')}</p>
        <p><b>Hashtags to post & monitor:</b></p>
        <p>${a.hashtags.map(tag).join(' ')}</p>
      </div>

      <div class="b2c-card">
        <h3>🔎 Search keywords (SEO & ads)</h3>
        <ul>${a.keywordsSEO.map((k) => '<li>' + esc(k) + '</li>').join('')}</ul>
        <h3>📣 Paid ad targeting</h3>
        <ul>${a.ads.map((k) => '<li>' + esc(k) + '</li>').join('')}</ul>
      </div>

      <div class="b2c-card">
        <h3>🚀 One-click research (opens real searches)</h3>
        <div class="research-links">
          ${links.map((l) => '<a class="rlink" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + ' ↗</a>').join('')}
        </div>
        <p class="muted small">These open live searches on each platform so you can find the exact buyers, groups and posts discussing your product right now.</p>
      </div>

      <div class="b2c-card wide">
        <h3>✉️ Ready outreach copy</h3>
        <label class="outlbl">Email subject</label>
        <div class="copybox"><code>${esc(a.outreach.email.subject)}</code><button class="btn ghost mini-btn" data-copy="${esc(a.outreach.email.subject)}">copy</button></div>
        <label class="outlbl">Email body</label>
        <pre class="copyarea" id="emailBody">${esc(a.outreach.email.body)}</pre>
        <button class="btn ghost mini-btn" data-copy-el="emailBody">copy email</button>
        <label class="outlbl">DM / SMS</label>
        <div class="copybox"><code>${esc(a.outreach.dm)}</code><button class="btn ghost mini-btn" data-copy="${esc(a.outreach.dm)}">copy</button></div>
        <label class="outlbl">Ad headline</label>
        <div class="copybox"><code>${esc(a.outreach.adHeadline)}</code><button class="btn ghost mini-btn" data-copy="${esc(a.outreach.adHeadline)}">copy</button></div>
      </div>
    </div>

    <div class="b2c-card wide find-contacts">
      <h3>📇 Find real customer contacts now</h3>
      <p class="muted small">The agent searches real, contactable businesses whose customers buy <b>${esc(a.productToken)}</b> — i.e. your resellers / stockists / B2B2C buyers — and returns their <b>emails, phones &amp; websites</b>. ${esc(a.contactsNote)}</p>
      <p class="muted small">Business types it will look for: ${a.businessTypes.slice(0, 12).map(tag).join(' ')}</p>
      <div class="contacts-form">
        <input id="cLocation" type="text" placeholder="Location to search — e.g. Lyon, France" />
        <input id="cLimit" type="number" value="200" min="20" max="1000" step="20" title="Max results" />
        <button id="cSearch" class="btn primary">🔎 Search contacts</button>
      </div>
      <div id="cProgress" class="progress hidden"><div class="bar"><div id="cBar" class="bar-fill"></div></div><p id="cMsg" class="progress-msg"></p></div>
      <div id="cResults"></div>
    </div>

    <div class="b2c-actions">
      <button id="b2cExport" class="btn primary">⬇ Export strategy plan (CSV)</button>
    </div>
    <p class="muted small compliance">⚖ These business contacts are published for inquiries. To reach end consumers directly, use the channels/ads above and collect emails with consent (sign-up, lead form, checkout opt-in) — keeping you compliant with GDPR / CAN-SPAM / TCPA.</p>
  `;

  out.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copyText(b.getAttribute('data-copy'), b));
  out.querySelectorAll('[data-copy-el]').forEach((b) => b.onclick = () => copyText($(b.getAttribute('data-copy-el')).textContent, b));
  $('b2cExport').onclick = exportPlan;
  $('cSearch').onclick = () => searchContacts(a);
  $('cLocation').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchContacts(a); });
}

async function searchContacts(a) {
  const place = $('cLocation').value.trim();
  if (!place) { alert('Enter a location to search (e.g. "Lyon, France").'); return; }
  const limit = Math.min(Number($('cLimit').value) || 200, 1000);
  const btn = $('cSearch'); btn.disabled = true;
  const prog = $('cProgress'); prog.classList.remove('hidden'); prog.classList.add('indeterminate');
  $('cBar').style.width = '0%';
  $('cMsg').textContent = 'Searching real businesses in ' + place + '…';
  const res = $('cResults'); res.innerHTML = '';

  try {
    const { location, records } = await window.B2C.searchCustomerContacts(a, place, limit);
    window._lastContacts = records;
    prog.classList.remove('indeterminate'); $('cBar').style.width = '100%';
    const withEmail = records.filter((r) => r.email).length;
    const withPhone = records.filter((r) => r.phone).length;
    $('cMsg').textContent = `Found ${records.length} businesses in ${location.split(',')[0]} · ${withEmail} with email · ${withPhone} with phone.`;
    res.innerHTML = renderContacts(records);
    if (records.length) $('cExportContacts').onclick = exportContacts;
  } catch (e) {
    prog.classList.remove('indeterminate');
    $('cMsg').textContent = '⚠ ' + (e.message || e);
  } finally {
    btn.disabled = false;
  }
}

function renderContacts(records) {
  if (!records.length) return '<p class="empty">No businesses found here. Try a bigger city or region.</p>';
  const rows = records.slice(0, 200).map((c) => {
    const social = [];
    if (c.website) social.push('<a href="' + esc(c.website) + '" target="_blank" rel="noopener">🌐</a>');
    if (c.facebook) social.push('<a href="' + esc(c.facebook) + '" target="_blank" rel="noopener">📘</a>');
    if (c.instagram) social.push('<a href="' + esc(c.instagram) + '" target="_blank" rel="noopener">📷</a>');
    const loc = [c.city, c.country].filter(Boolean).join(', ') || c.address || '—';
    return '<tr>' +
      '<td class="cname">' + esc(c.name) + '</td>' +
      '<td class="muted">' + esc(c.category || '') + '</td>' +
      '<td>' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '<span class="muted">—</span>') + '</td>' +
      '<td>' + (c.phone ? esc(c.phone) : '<span class="muted">—</span>') + '</td>' +
      '<td><div class="social">' + (social.join('') || '<span class="muted">—</span>') + '</div></td>' +
      '<td class="muted">' + esc(loc) + '</td>' +
    '</tr>';
  }).join('');
  return `
    <div class="contacts-head"><b>${records.length} contacts</b><button id="cExportContacts" class="btn primary mini-btn">⬇ Export contacts (CSV)</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Business</th><th>Type</th><th>Email</th><th>Phone</th><th>Web/Social</th><th>Location</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function exportContacts() {
  const records = window._lastContacts || [];
  if (!records.length) return;
  const csv = window.B2C.contactsToCSV(records);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'b2c-customer-contacts.csv';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportPlan() {
  const a = window._lastAnalysis;
  if (!a) return;
  const csv = window.B2C.planToCSV(a);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'b2c-customer-plan.csv';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function copyText(text, btn) {
  const done = () => { const old = btn.textContent; btn.textContent = '✓ copied'; setTimeout(() => btn.textContent = old, 1200); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(done);
  else done();
}

function tag(s) { return '<span class="need">' + esc(s) + '</span>'; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

document.addEventListener('DOMContentLoaded', () => {
  $('b2cRun').onclick = run;
  $('pdesc').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(); });
});
