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

    <div class="b2c-actions">
      <button id="b2cExport" class="btn primary">⬇ Export plan (CSV)</button>
    </div>
    <p class="muted small compliance">⚖ Reach customers through these public/opt-in channels and your own ads. When you collect emails/phones, get consent (newsletter sign-up, lead form, checkout opt-in) — that keeps you compliant with GDPR / CAN-SPAM / TCPA and out of spam folders.</p>
  `;

  out.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copyText(b.getAttribute('data-copy'), b));
  out.querySelectorAll('[data-copy-el]').forEach((b) => b.onclick = () => copyText($(b.getAttribute('data-copy-el')).textContent, b));
  $('b2cExport').onclick = exportPlan;
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
