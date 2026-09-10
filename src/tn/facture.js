'use strict';

/** Rendu HTML imprimable d'une facture (A4, FR + AR). */

const store = require('./store');

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmt = (n) => Number(n || 0).toFixed(3);

function render(factureId) {
  const f = store.getFacture(factureId);
  if (!f) return null;
  const b = f.boutique || {};
  const devise = b.devise || 'DT';
  const lignes = f.lignes
    .map(
      (l) => `<tr>
      <td>${esc(l.designation)}</td>
      <td class="n">${esc(l.qte)}</td>
      <td class="n">${fmt(l.prixUnitaire)}</td>
      <td class="n">${fmt((Number(l.qte) || 1) * (Number(l.prixUnitaire) || 0))}</td>
    </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Facture ${esc(f.numero)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font: 14px/1.5 system-ui, "Segoe UI", Tahoma, sans-serif; color: #14261f; background: #f4f6f5; }
  .sheet { max-width: 760px; margin: 0 auto; background: #fff; padding: 32px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
  header { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; border-bottom: 2px solid #0f766e; padding-bottom: 16px; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .muted { color: #5b6b64; font-size: 13px; }
  .num { text-align: right; }
  .num strong { font-size: 18px; color: #0f766e; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  th, td { padding: 9px 10px; border-bottom: 1px solid #e3e8e6; text-align: left; }
  th { background: #f0faf7; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  td.n, th.n { text-align: right; }
  tfoot td { border: 0; padding: 5px 10px; }
  tfoot .total td { font-weight: 700; font-size: 16px; color: #0f766e; border-top: 2px solid #0f766e; }
  footer { margin-top: 32px; font-size: 12px; color: #5b6b64; display: flex; justify-content: space-between; gap: 16px; }
  .ar { direction: rtl; font-family: "Noto Naskh Arabic", Tahoma, sans-serif; }
  @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; border-radius: 0; } }
</style>
</head>
<body>
<div class="sheet">
  <header>
    <div>
      <h1>${esc(b.nom || 'Facture')}</h1>
      <div class="muted">${esc(b.adresse || '')}</div>
      <div class="muted">${esc(b.tel || '')}</div>
      ${b.matriculeFiscal ? `<div class="muted">MF: ${esc(b.matriculeFiscal)}</div>` : ''}
    </div>
    <div class="num">
      <div class="muted">FACTURE / <span class="ar">فاتورة</span></div>
      <strong>N° ${esc(f.numero)}</strong>
      <div class="muted">${esc(f.date)}</div>
    </div>
  </header>

  <p class="muted" style="margin-top:20px">Client / <span class="ar">الكليان</span></p>
  <div><strong>${esc(f.client ? f.client.nom : '')}</strong></div>
  <div class="muted">${esc(f.client ? f.client.tel : '')} ${esc(f.client && f.client.adresse ? '· ' + f.client.adresse : '')}</div>

  <table>
    <thead>
      <tr><th>Désignation</th><th class="n">Qté</th><th class="n">P.U. (${esc(devise)})</th><th class="n">Total</th></tr>
    </thead>
    <tbody>${lignes}</tbody>
    <tfoot>
      <tr><td colspan="3" class="n">Total HT</td><td class="n">${fmt(f.totalHT)}</td></tr>
      <tr><td colspan="3" class="n">TVA ${esc(f.tauxTva)}%</td><td class="n">${fmt(f.tva)}</td></tr>
      <tr class="total"><td colspan="3" class="n">Total TTC (${esc(devise)})</td><td class="n">${fmt(f.totalTTC)}</td></tr>
    </tfoot>
  </table>

  <footer>
    <span>Merci de votre confiance.</span>
    <span class="ar">يعيشك على الثقة.</span>
  </footer>
</div>
</body>
</html>`;
}

module.exports = { render };
