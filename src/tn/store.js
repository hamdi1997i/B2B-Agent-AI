'use strict';

/**
 * Magasin de données du commerçant (zero-dependency JSON store).
 *
 * Tout ce que l'agent enregistre — clients, dettes, commandes, factures,
 * tâches, notes, ventes — vit dans data/tn-db.json.
 *
 * Les dates sont stockées en chaînes ISO courtes: "YYYY-MM-DD" pour un jour,
 * "YYYY-MM-DDTHH:mm" quand une heure est donnée. Le fuseau de référence est
 * Africa/Tunis (voir today()).
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = process.env.TN_DB_FILE || path.join(DATA_DIR, 'tn-db.json');
const TZ = 'Africa/Tunis';

const EMPTY = () => ({
  boutique: { nom: '', tel: '', adresse: '', matriculeFiscal: '', devise: 'DT', tva: 19 },
  clients: [],
  dettes: [],
  commandes: [],
  factures: [],
  taches: [],
  notes: [],
  ventes: [],
  journal: [],
  seq: { facture: 0 },
});

function ensure() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY(), null, 2));
}

function load() {
  ensure();
  try {
    return { ...EMPTY(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch {
    return EMPTY();
  }
}

function save(db) {
  ensure();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  return db;
}

/** Applique une mutation sur la base et la persiste. */
function update(fn) {
  const db = load();
  const out = fn(db);
  save(db);
  return out;
}

let counter = 0;
function id(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Date du jour à Tunis, au format YYYY-MM-DD. */
function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Heure courante à Tunis, au format HH:mm. */
function now() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

/** Jour (YYYY-MM-DD) d'une date ISO éventuellement horodatée. */
function day(iso) {
  return String(iso || '').slice(0, 10);
}

/** Décale une date YYYY-MM-DD de n jours. */
function addDays(dateStr, n) {
  const d = new Date(`${day(dateStr)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Normalise un numéro tunisien: "20 123 456" -> "+21620123456".
 * Les numéros déjà internationaux sont conservés tels quels.
 */
function normalizePhone(raw) {
  const s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return `+${s.slice(2)}`;
  if (s.startsWith('216') && s.length === 11) return `+${s}`;
  if (s.length === 8) return `+216${s}`;
  return s;
}

/** Compare deux noms en ignorant casse, accents et diacritiques arabes. */
function fold(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- clients

function findClients(query) {
  const q = fold(query);
  if (!q) return [];
  const clients = load().clients;
  const digits = String(query || '').replace(/\D/g, '');
  return clients.filter((c) => {
    const name = fold(c.nom);
    if (name === q || name.includes(q) || q.includes(name)) return true;
    return digits.length >= 6 && String(c.tel || '').includes(digits);
  });
}

function getClient(clientId) {
  return load().clients.find((c) => c.id === clientId) || null;
}

function addClient({ nom, tel = '', adresse = '', note = '' }) {
  return update((db) => {
    const client = {
      id: id('cli'),
      nom: String(nom).trim(),
      tel: normalizePhone(tel),
      adresse,
      note,
      createdAt: new Date().toISOString(),
    };
    db.clients.push(client);
    return client;
  });
}

function updateClient(clientId, patch) {
  return update((db) => {
    const c = db.clients.find((x) => x.id === clientId);
    if (!c) return null;
    if (patch.nom) c.nom = String(patch.nom).trim();
    if (patch.tel) c.tel = normalizePhone(patch.tel);
    if (patch.adresse !== undefined) c.adresse = patch.adresse;
    if (patch.note !== undefined) c.note = patch.note;
    return c;
  });
}

// ------------------------------------------------------------------ dettes

function addDette({ clientId, montant, motif = '', echeance = '' }) {
  return update((db) => {
    const dette = {
      id: id('det'),
      clientId,
      montant: Number(montant),
      paye: 0,
      motif,
      echeance: echeance || '',
      statut: 'ouverte',
      createdAt: new Date().toISOString(),
    };
    db.dettes.push(dette);
    return dette;
  });
}

/** Encaisse un paiement sur les dettes ouvertes du client, de la plus ancienne à la plus récente. */
function payer({ clientId, montant, date }) {
  return update((db) => {
    let reste = Number(montant);
    const touched = [];
    const ouvertes = db.dettes
      .filter((d) => d.clientId === clientId && d.statut === 'ouverte')
      .sort((a, b) => String(a.echeance || a.createdAt).localeCompare(String(b.echeance || b.createdAt)));
    for (const d of ouvertes) {
      if (reste <= 0) break;
      const du = d.montant - d.paye;
      const part = Math.min(du, reste);
      d.paye += part;
      reste -= part;
      if (d.paye >= d.montant - 0.001) d.statut = 'payee';
      touched.push(d);
    }
    db.ventes.push({
      id: id('pay'),
      type: 'paiement',
      clientId,
      montant: Number(montant) - reste,
      date: day(date) || today(),
      createdAt: new Date().toISOString(),
    });
    return { regle: Number(montant) - reste, avoir: reste, dettes: touched };
  });
}

function dettesOuvertes({ clientId = '', enRetard = false } = {}) {
  const db = load();
  const t = today();
  return db.dettes
    .filter((d) => d.statut === 'ouverte')
    .filter((d) => (clientId ? d.clientId === clientId : true))
    .filter((d) => (enRetard ? d.echeance && day(d.echeance) < t : true))
    .map((d) => ({ ...d, reste: Math.round((d.montant - d.paye) * 1000) / 1000, client: getClient(d.clientId) }))
    .sort((a, b) => String(a.echeance || '9999').localeCompare(String(b.echeance || '9999')));
}

// --------------------------------------------------------------- commandes

const STATUTS = ['en_attente', 'en_cours', 'prete', 'livree', 'annulee'];

function addCommande({ clientId, articles = [], total = 0, echeance = '', note = '' }) {
  return update((db) => {
    const lignes = articles.map((a) => ({
      designation: String(a.designation || '').trim(),
      qte: Number(a.qte) || 1,
      prixUnitaire: Number(a.prixUnitaire) || 0,
    }));
    const calcule = lignes.reduce((s, l) => s + l.qte * l.prixUnitaire, 0);
    const commande = {
      id: id('cmd'),
      clientId,
      articles: lignes,
      total: Number(total) || calcule,
      statut: 'en_attente',
      echeance: echeance || '',
      note,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.commandes.push(commande);
    return commande;
  });
}

function setStatutCommande(commandeId, statut) {
  return update((db) => {
    const c = db.commandes.find((x) => x.id === commandeId);
    if (!c) return null;
    c.statut = statut;
    c.updatedAt = new Date().toISOString();
    if (statut === 'livree' && !c.livreeLe) c.livreeLe = today();
    return c;
  });
}

function commandes({ clientId = '', statut = '' } = {}) {
  return load()
    .commandes.filter((c) => (clientId ? c.clientId === clientId : true))
    .filter((c) => (statut ? c.statut === statut : true))
    .map((c) => ({ ...c, client: getClient(c.clientId) }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function getCommande(commandeId) {
  const c = load().commandes.find((x) => x.id === commandeId);
  return c ? { ...c, client: getClient(c.clientId) } : null;
}

/** Dernière commande d'un client (la plus récente). */
function derniereCommande(clientId) {
  return commandes({ clientId })[0] || null;
}

// ---------------------------------------------------------------- factures

function addFacture({ commandeId = '', clientId, lignes = [], tva = null }) {
  return update((db) => {
    db.seq.facture = (db.seq.facture || 0) + 1;
    const annee = today().slice(0, 4);
    const taux = tva === null || tva === undefined ? Number(db.boutique.tva || 0) : Number(tva);
    const totalHT = lignes.reduce((s, l) => s + Number(l.qte || 1) * Number(l.prixUnitaire || 0), 0);
    const montantTva = Math.round(totalHT * (taux / 100) * 1000) / 1000;
    const facture = {
      id: id('fac'),
      numero: `${annee}-${String(db.seq.facture).padStart(4, '0')}`,
      commandeId,
      clientId,
      lignes,
      tauxTva: taux,
      totalHT: Math.round(totalHT * 1000) / 1000,
      tva: montantTva,
      totalTTC: Math.round((totalHT + montantTva) * 1000) / 1000,
      date: today(),
      createdAt: new Date().toISOString(),
    };
    db.factures.push(facture);
    return facture;
  });
}

function getFacture(factureId) {
  const db = load();
  const f = db.factures.find((x) => x.id === factureId || x.numero === factureId);
  return f ? { ...f, client: getClient(f.clientId), boutique: db.boutique } : null;
}

// ------------------------------------------------------------------ tâches

function addTache({ titre, quand = '', clientId = '' }) {
  return update((db) => {
    const t = {
      id: id('tac'),
      titre: String(titre).trim(),
      quand: quand || today(),
      clientId,
      fait: false,
      createdAt: new Date().toISOString(),
    };
    db.taches.push(t);
    return t;
  });
}

function setTacheFaite(tacheId, fait = true) {
  return update((db) => {
    const t = db.taches.find((x) => x.id === tacheId);
    if (!t) return null;
    t.fait = fait;
    return t;
  });
}

function taches({ from = '', to = '', inclureFaites = false } = {}) {
  return load()
    .taches.filter((t) => (inclureFaites ? true : !t.fait))
    .filter((t) => (from ? day(t.quand) >= day(from) : true))
    .filter((t) => (to ? day(t.quand) <= day(to) : true))
    .map((t) => ({ ...t, client: t.clientId ? getClient(t.clientId) : null }))
    .sort((a, b) => String(a.quand).localeCompare(String(b.quand)));
}

// ------------------------------------------------------------- notes/ventes

function addNote(texte) {
  return update((db) => {
    const n = { id: id('not'), texte: String(texte).trim(), date: today(), createdAt: new Date().toISOString() };
    db.notes.push(n);
    return n;
  });
}

function notes(limit = 20) {
  return load().notes.slice(-limit).reverse();
}

/** Fil d'activité: une ligne par action réussie de l'agent. */
function addJournal(texte, tool = '') {
  return update((db) => {
    const e = { id: id('jrn'), texte: String(texte), tool, at: new Date().toISOString() };
    db.journal.push(e);
    if (db.journal.length > 200) db.journal = db.journal.slice(-200);
    return e;
  });
}

function journal(limit = 12) {
  return load().journal.slice(-limit).reverse();
}

function addVente({ montant, cout = 0, label = '', clientId = '', date = '' }) {
  return update((db) => {
    const v = {
      id: id('ven'),
      type: 'vente',
      montant: Number(montant),
      cout: Number(cout) || 0,
      label,
      clientId,
      date: day(date) || today(),
      createdAt: new Date().toISOString(),
    };
    db.ventes.push(v);
    return v;
  });
}

/**
 * Bilan d'une période [from, to] (bornes incluses, YYYY-MM-DD):
 * ventes directes, commandes livrées, encaissements, marge et impayés.
 */
function bilan({ from, to }) {
  const db = load();
  const inRange = (d) => day(d) >= day(from) && day(d) <= day(to);

  const ventes = db.ventes.filter((v) => v.type === 'vente' && inRange(v.date));
  const encaissements = db.ventes.filter((v) => v.type === 'paiement' && inRange(v.date));
  const livrees = db.commandes.filter((c) => c.statut === 'livree' && c.livreeLe && inRange(c.livreeLe));

  const caVentes = ventes.reduce((s, v) => s + v.montant, 0);
  const caCommandes = livrees.reduce((s, c) => s + c.total, 0);
  const cout = ventes.reduce((s, v) => s + (v.cout || 0), 0);

  return {
    from: day(from),
    to: day(to),
    chiffreAffaires: Math.round((caVentes + caCommandes) * 1000) / 1000,
    ventesDirectes: Math.round(caVentes * 1000) / 1000,
    commandesLivrees: { nombre: livrees.length, montant: Math.round(caCommandes * 1000) / 1000 },
    encaisse: Math.round(encaissements.reduce((s, v) => s + v.montant, 0) * 1000) / 1000,
    marge: cout ? Math.round((caVentes - cout) * 1000) / 1000 : null,
    impayes: Math.round(
      db.dettes.filter((d) => d.statut === 'ouverte').reduce((s, d) => s + (d.montant - d.paye), 0) * 1000,
    ) / 1000,
    devise: db.boutique.devise || 'DT',
  };
}

/** Aperçu utilisé par l'écran d'accueil et le contexte de l'agent. */
function apercu() {
  const db = load();
  const t = today();
  return {
    date: t,
    clients: db.clients.length,
    tachesAujourdhui: taches({ from: t, to: t }).length,
    commandesEnCours: db.commandes.filter((c) => c.statut !== 'livree' && c.statut !== 'annulee').length,
    impayes: dettesOuvertes().length,
    boutique: db.boutique,
  };
}

function setBoutique(patch) {
  return update((db) => {
    db.boutique = { ...db.boutique, ...patch };
    return db.boutique;
  });
}

function reset() {
  return save(EMPTY());
}

module.exports = {
  STATUTS,
  TZ,
  DB_FILE,
  load,
  today,
  now,
  day,
  addDays,
  normalizePhone,
  fold,
  findClients,
  getClient,
  addClient,
  updateClient,
  addDette,
  payer,
  dettesOuvertes,
  addCommande,
  setStatutCommande,
  commandes,
  getCommande,
  derniereCommande,
  addFacture,
  getFacture,
  addTache,
  setTacheFaite,
  taches,
  addNote,
  notes,
  addJournal,
  journal,
  addVente,
  bilan,
  apercu,
  setBoutique,
  reset,
};
