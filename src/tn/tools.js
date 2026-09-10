'use strict';

/**
 * Les outils de l'agent commerçant.
 *
 * Chaque outil = un schéma envoyé à Claude + une fonction `run` exécutée
 * côté serveur sur le magasin JSON. Les descriptions sont écrites en
 * français + derja pour que le modèle sache quelle phrase parlée
 * correspond à quel outil.
 *
 * Règle de sécurité: aucun outil n'envoie quoi que ce soit vers
 * l'extérieur. `preparer_sms` prépare un brouillon et rend la main —
 * c'est l'utilisateur qui confirme l'envoi dans l'app SMS du téléphone.
 */

const store = require('./store');

/** Résout un client à partir d'un nom ou d'un numéro dicté. */
function resolveClient(query) {
  const matches = store.findClients(query);
  if (matches.length === 0) return { error: `ما لقيتش كليان اسمو "${query}". زيدو بـ ajouter_client.` };
  if (matches.length > 1) {
    return {
      error: 'فمّا أكثر من كليان بهالاسم، أسأل التاجر شكون منهم.',
      choix: matches.map((c) => ({ id: c.id, nom: c.nom, tel: c.tel })),
    };
  }
  return { client: matches[0] };
}

function clientBrief(c) {
  return c ? { id: c.id, nom: c.nom, tel: c.tel } : null;
}

function money(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

const TOOLS = [
  {
    name: 'chercher_client',
    description:
      "Chercher un client déjà enregistré par nom ou téléphone, et voir son ardoise " +
      "(dettes ouvertes, dernières commandes). Utilise-le quand le commerçant demande " +
      "« شنوة عند فلان » ou « قداش يسالني فلان ».",
    input_schema: {
      type: 'object',
      properties: { nom: { type: 'string', description: 'Nom ou numéro de téléphone dicté.' } },
      required: ['nom'],
    },
    run: ({ nom }) => {
      const matches = store.findClients(nom);
      return {
        trouves: matches.map((c) => {
          const dettes = store.dettesOuvertes({ clientId: c.id });
          return {
            ...clientBrief(c),
            reste_a_payer: money(dettes.reduce((s, d) => s + d.reste, 0)),
            dettes: dettes.map((d) => ({ id: d.id, reste: d.reste, echeance: d.echeance, motif: d.motif })),
            commandes: store.commandes({ clientId: c.id }).slice(0, 3).map((k) => ({
              id: k.id,
              total: k.total,
              statut: k.statut,
              articles: k.articles,
            })),
          };
        }),
      };
    },
  },

  {
    name: 'ajouter_client',
    description:
      'Créer un nouveau client. « سجّل أحمد »، « زيد كليان جديد اسمو سامي نمرتو 22... ». ' +
      "N'invente jamais un numéro de téléphone: laisse vide s'il n'a pas été dicté.",
    input_schema: {
      type: 'object',
      properties: {
        nom: { type: 'string' },
        tel: { type: 'string', description: 'Numéro tunisien à 8 chiffres, ou vide.' },
        adresse: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['nom'],
    },
    run: (input) => {
      const existe = store.findClients(input.nom);
      if (existe.length) return { deja_existe: true, client: clientBrief(existe[0]) };
      return { cree: clientBrief(store.addClient(input)) };
    },
  },

  {
    name: 'enregistrer_dette',
    description:
      'Enregistrer une dette (crédit / كريدي) sur un client: montant en dinars et, si dictée, ' +
      "une échéance. « أحمد عليه 250 دينار يخلّص نهار 20 ». Si le client n'existe pas encore, " +
      'crée-le d\'abord avec ajouter_client.',
    input_schema: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Nom ou téléphone du client.' },
        montant: { type: 'number', description: 'Montant en dinars (DT).' },
        motif: { type: 'string' },
        echeance: { type: 'string', description: 'Date limite au format YYYY-MM-DD.' },
      },
      required: ['client', 'montant'],
    },
    run: ({ client, montant, motif = '', echeance = '' }) => {
      const r = resolveClient(client);
      if (r.error) return r;
      const dette = store.addDette({ clientId: r.client.id, montant, motif, echeance });
      const total = store.dettesOuvertes({ clientId: r.client.id }).reduce((s, d) => s + d.reste, 0);
      return { enregistre: { id: dette.id, montant: dette.montant, echeance: dette.echeance }, client: clientBrief(r.client), total_du: money(total) };
    },
  },

  {
    name: 'enregistrer_paiement',
    description:
      'Enregistrer un paiement reçu d\'un client (il rembourse sa dette). ' +
      '« أحمد خلّص 100 دينار ». Le montant est imputé sur les dettes les plus anciennes.',
    input_schema: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        montant: { type: 'number' },
        date: { type: 'string', description: 'YYYY-MM-DD, par défaut aujourd\'hui.' },
      },
      required: ['client', 'montant'],
    },
    run: ({ client, montant, date = '' }) => {
      const r = resolveClient(client);
      if (r.error) return r;
      const res = store.payer({ clientId: r.client.id, montant, date });
      const reste = store.dettesOuvertes({ clientId: r.client.id }).reduce((s, d) => s + d.reste, 0);
      return { client: clientBrief(r.client), encaisse: money(res.regle), avance: money(res.avoir), reste_a_payer: money(reste) };
    },
  },

  {
    name: 'liste_impayes',
    description:
      'Lister qui n\'a pas payé. « شكون ما خلّصش؟ »، « شكون فاتتو الéchéance؟ ». ' +
      'Mets en_retard=true pour ne garder que les échéances dépassées.',
    input_schema: {
      type: 'object',
      properties: { en_retard: { type: 'boolean' } },
    },
    run: ({ en_retard = false } = {}) => {
      const dettes = store.dettesOuvertes({ enRetard: en_retard });
      return {
        aujourdhui: store.today(),
        nombre: dettes.length,
        total: money(dettes.reduce((s, d) => s + d.reste, 0)),
        lignes: dettes.map((d) => ({
          client: d.client ? d.client.nom : '?',
          tel: d.client ? d.client.tel : '',
          reste: d.reste,
          echeance: d.echeance,
          en_retard: !!(d.echeance && store.day(d.echeance) < store.today()),
          motif: d.motif,
        })),
      };
    },
  },

  {
    name: 'creer_commande',
    description:
      'Créer une commande pour un client. « سجّل commande متاع محمد: 10 cartons بـ 25 دينار ». ' +
      'Donne les articles avec quantité et prix unitaire quand ils sont dictés, sinon juste le total.',
    input_schema: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        articles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              designation: { type: 'string' },
              qte: { type: 'number' },
              prixUnitaire: { type: 'number' },
            },
            required: ['designation'],
          },
        },
        total: { type: 'number', description: 'Total en DT si les prix ligne par ligne ne sont pas dictés.' },
        echeance: { type: 'string', description: 'Date de livraison prévue, YYYY-MM-DD.' },
        note: { type: 'string' },
      },
      required: ['client'],
    },
    run: ({ client, ...rest }) => {
      const r = resolveClient(client);
      if (r.error) return r;
      const cmd = store.addCommande({ clientId: r.client.id, ...rest });
      return { commande: { id: cmd.id, total: cmd.total, statut: cmd.statut, echeance: cmd.echeance, articles: cmd.articles }, client: clientBrief(r.client) };
    },
  },

  {
    name: 'changer_statut_commande',
    description:
      'Changer l\'état d\'une commande: en_attente, en_cours, prete, livree, annulee. ' +
      '« بدّل حالة الطلبية متاع أحمد لـ livrée ». Sans commande_id, la dernière commande du client est utilisée.',
    input_schema: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        commande_id: { type: 'string' },
        statut: { type: 'string', enum: store.STATUTS },
      },
      required: ['statut'],
    },
    run: ({ client = '', commande_id = '', statut }) => {
      if (!store.STATUTS.includes(statut)) return { error: `statut invalide (${store.STATUTS.join(', ')})` };
      let cmd = commande_id ? store.getCommande(commande_id) : null;
      if (!cmd && client) {
        const r = resolveClient(client);
        if (r.error) return r;
        cmd = store.derniereCommande(r.client.id);
        if (!cmd) return { error: `ما فمّاش طلبية مسجّلة لـ ${r.client.nom}.` };
      }
      if (!cmd) return { error: 'حدّد الكليان ولا رقم الطلبية.' };
      const out = store.setStatutCommande(cmd.id, statut);
      return { commande: { id: out.id, statut: out.statut, total: out.total }, client: clientBrief(store.getClient(out.clientId)) };
    },
  },

  {
    name: 'liste_commandes',
    description:
      'Lister les commandes, éventuellement filtrées par client ou par statut. ' +
      '« شنوة الطلبيات اللي باقية؟ »، « شنوة عندي prêtes؟ »',
    input_schema: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        statut: { type: 'string', enum: store.STATUTS },
      },
    },
    run: ({ client = '', statut = '' } = {}) => {
      let clientId = '';
      if (client) {
        const r = resolveClient(client);
        if (r.error) return r;
        clientId = r.client.id;
      }
      const rows = store.commandes({ clientId, statut });
      return {
        nombre: rows.length,
        commandes: rows.slice(0, 20).map((c) => ({
          id: c.id,
          client: c.client ? c.client.nom : '?',
          total: c.total,
          statut: c.statut,
          echeance: c.echeance,
          articles: c.articles,
        })),
      };
    },
  },

  {
    name: 'creer_facture',
    description:
      'Créer une facture. « اعمل facture للطلبية هذي ». À partir d\'une commande ' +
      '(commande_id ou dernier commande du client) ou de lignes dictées directement. ' +
      'Renvoie un numéro et un lien à ouvrir/imprimer.',
    input_schema: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        commande_id: { type: 'string' },
        lignes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              designation: { type: 'string' },
              qte: { type: 'number' },
              prixUnitaire: { type: 'number' },
            },
            required: ['designation'],
          },
        },
        tva: { type: 'number', description: 'Taux de TVA en %. Par défaut celui de la boutique (19).' },
      },
    },
    run: ({ client = '', commande_id = '', lignes = [], tva = null }, ctx) => {
      let cmd = commande_id ? store.getCommande(commande_id) : null;
      let clientId = cmd ? cmd.clientId : '';
      if (!cmd && client) {
        const r = resolveClient(client);
        if (r.error) return r;
        clientId = r.client.id;
        if (!lignes.length) cmd = store.derniereCommande(clientId);
      }
      const finalLignes = lignes.length
        ? lignes.map((l) => ({ designation: l.designation, qte: Number(l.qte) || 1, prixUnitaire: Number(l.prixUnitaire) || 0 }))
        : cmd
          ? (cmd.articles.length
              ? cmd.articles
              : [{ designation: 'Commande', qte: 1, prixUnitaire: cmd.total }])
          : [];
      if (!finalLignes.length) return { error: 'ما فمّاش لا طلبية لا أسطر باش نعمل فاتورة.' };
      if (!clientId) return { error: 'حدّد الكليان متاع الفاتورة.' };
      const facture = store.addFacture({ commandeId: cmd ? cmd.id : '', clientId, lignes: finalLignes, tva });
      if (ctx && ctx.emit) {
        ctx.emit('action', { type: 'facture', id: facture.id, numero: facture.numero, url: `/api/tn/facture/${facture.id}`, totalTTC: facture.totalTTC });
      }
      return {
        facture: { id: facture.id, numero: facture.numero, totalHT: facture.totalHT, tva: facture.tva, totalTTC: facture.totalTTC, url: `/api/tn/facture/${facture.id}` },
        client: clientBrief(store.getClient(clientId)),
      };
    },
  },

  {
    name: 'creer_rappel',
    description:
      'Créer un rappel / une tâche datée. « ذكّرني غدوة نكلم فلان »، « غدوة مع 10 متاع الصباح ذكرني نكلم محمد ». ' +
      'quand = YYYY-MM-DD ou YYYY-MM-DDTHH:mm (heure sur 24h).',
    input_schema: {
      type: 'object',
      properties: {
        titre: { type: 'string' },
        quand: { type: 'string' },
        client: { type: 'string' },
      },
      required: ['titre'],
    },
    run: ({ titre, quand = '', client = '' }) => {
      let clientId = '';
      if (client) {
        const r = resolveClient(client);
        if (!r.error) clientId = r.client.id;
      }
      const t = store.addTache({ titre, quand, clientId });
      return { rappel: { id: t.id, titre: t.titre, quand: t.quand } };
    },
  },

  {
    name: 'agenda',
    description:
      'Ce qu\'il y a au programme sur une période: rappels, échéances de paiement et livraisons prévues. ' +
      '« شنوة عندي اليوم؟ »، « شنوة عندي غدوة؟ ». Par défaut: aujourd\'hui.',
    input_schema: {
      type: 'object',
      properties: {
        du: { type: 'string', description: 'YYYY-MM-DD' },
        au: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
    run: ({ du = '', au = '' } = {}) => {
      const from = store.day(du) || store.today();
      const to = store.day(au) || from;
      const dettes = store.dettesOuvertes().filter((d) => d.echeance && store.day(d.echeance) >= from && store.day(d.echeance) <= to);
      const livraisons = store
        .commandes({})
        .filter((c) => c.echeance && store.day(c.echeance) >= from && store.day(c.echeance) <= to && c.statut !== 'livree' && c.statut !== 'annulee');
      return {
        du: from,
        au: to,
        rappels: store.taches({ from, to }).map((t) => ({ id: t.id, titre: t.titre, quand: t.quand, client: t.client ? t.client.nom : '' })),
        echeances: dettes.map((d) => ({ client: d.client ? d.client.nom : '?', reste: d.reste, echeance: d.echeance })),
        livraisons: livraisons.map((c) => ({ id: c.id, client: c.client ? c.client.nom : '?', total: c.total, statut: c.statut, echeance: c.echeance })),
      };
    },
  },

  {
    name: 'marquer_rappel_fait',
    description: 'Marquer un rappel comme fait. « عملت اللي كان لازم » / « شطب التذكير ».',
    input_schema: {
      type: 'object',
      properties: { rappel_id: { type: 'string' } },
      required: ['rappel_id'],
    },
    run: ({ rappel_id }) => {
      const t = store.setTacheFaite(rappel_id, true);
      return t ? { fait: { id: t.id, titre: t.titre } } : { error: 'ما لقيتش التذكير.' };
    },
  },

  {
    name: 'enregistrer_vente',
    description:
      'Enregistrer une vente encaissée tout de suite (comptant). « بعت اليوم بـ 300 دينار ». ' +
      'Le champ cout sert à calculer le bénéfice quand il est dicté.',
    input_schema: {
      type: 'object',
      properties: {
        montant: { type: 'number' },
        cout: { type: 'number', description: 'Prix d\'achat / revient, si dicté.' },
        label: { type: 'string' },
        client: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['montant'],
    },
    run: ({ client = '', ...rest }) => {
      let clientId = '';
      if (client) {
        const r = resolveClient(client);
        if (!r.error) clientId = r.client.id;
      }
      const v = store.addVente({ clientId, ...rest });
      return { vente: { id: v.id, montant: v.montant, date: v.date } };
    },
  },

  {
    name: 'bilan_ventes',
    description:
      'Chiffre d\'affaires, encaissements, bénéfice et impayés sur une période. ' +
      '« قداش رابحنا اليوم؟ »، « قداش عملنا هالجمعة؟ ». Par défaut: aujourd\'hui.',
    input_schema: {
      type: 'object',
      properties: {
        du: { type: 'string', description: 'YYYY-MM-DD' },
        au: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
    run: ({ du = '', au = '' } = {}) => store.bilan({ from: store.day(du) || store.today(), to: store.day(au) || store.day(du) || store.today() }),
  },

  {
    name: 'ajouter_note',
    description: 'Noter quelque chose. « اعمل note: لازم نشري 20 carton غدوة ».',
    input_schema: {
      type: 'object',
      properties: { texte: { type: 'string' } },
      required: ['texte'],
    },
    run: ({ texte }) => ({ note: store.addNote(texte) }),
  },

  {
    name: 'liste_notes',
    description: 'Relire les dernières notes. « شنوة كتبت؟ »',
    input_schema: { type: 'object', properties: { limite: { type: 'number' } } },
    run: ({ limite = 10 } = {}) => ({ notes: store.notes(Math.min(Number(limite) || 10, 50)) }),
  },

  {
    name: 'preparer_sms',
    description:
      'Préparer un SMS pour un client — SANS l\'envoyer. « ابعث لسامي رسالة قولّو إنو الطلبية متاعو جاهزة ». ' +
      'Écris le message en derja tunisienne, court et poli. Le commerçant le validera lui-même ' +
      'dans son application SMS: annonce-lui simplement que le message est prêt à confirmer.',
    input_schema: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        message: { type: 'string', description: 'Texte du SMS en derja.' },
      },
      required: ['client', 'message'],
    },
    run: ({ client, message }, ctx) => {
      const r = resolveClient(client);
      if (r.error) return r;
      if (!r.client.tel) return { error: `${r.client.nom} ما عندوش نمرة مسجّلة. أسأل التاجر على النمرة.` };
      const draft = { type: 'sms', clientId: r.client.id, nom: r.client.nom, tel: r.client.tel, message: String(message).trim() };
      if (ctx && ctx.emit) ctx.emit('action', draft);
      return { brouillon_pret: draft, rappel: "Le SMS n'est PAS envoyé: le commerçant doit confirmer." };
    },
  },

  {
    name: 'parametres_boutique',
    description:
      'Lire ou mettre à jour les infos de la boutique utilisées sur les factures ' +
      '(nom, téléphone, adresse, matricule fiscal, taux de TVA). Sans argument: lecture seule.',
    input_schema: {
      type: 'object',
      properties: {
        nom: { type: 'string' },
        tel: { type: 'string' },
        adresse: { type: 'string' },
        matriculeFiscal: { type: 'string' },
        tva: { type: 'number' },
      },
    },
    run: (patch = {}) => {
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== ''));
      return { boutique: Object.keys(clean).length ? store.setBoutique(clean) : store.load().boutique };
    },
  },
];

/** Schémas envoyés à l'API (sans les implémentations). */
const SCHEMAS = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Exécute un outil; ne jette jamais — les erreurs reviennent au modèle. */
function execute(name, input, ctx) {
  const tool = BY_NAME.get(name);
  if (!tool) return { error: `outil inconnu: ${name}` };
  try {
    return tool.run(input || {}, ctx) || { ok: true };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

module.exports = { TOOLS, SCHEMAS, execute };

/**
 * Résumé court (derja) d'une action réussie, pour le fil "آخر العمليات".
 * Retourne null pour les outils de lecture seule.
 */
function resume(name, input = {}, output = {}) {
  if (!output || output.error) return null;
  const nom = (output.client && output.client.nom) || input.client || '';
  switch (name) {
    case 'ajouter_client':
      return output.cree ? `كليان جديد: ${output.cree.nom}` : null;
    case 'enregistrer_dette':
      return `كريدي ${output.enregistre.montant} DT على ${nom}`;
    case 'enregistrer_paiement':
      return `${nom} خلّص ${output.encaisse} DT`;
    case 'creer_commande':
      return `طلبية جديدة لـ ${nom} بـ ${output.commande.total} DT`;
    case 'changer_statut_commande':
      return `طلبية ${nom} ولّات ${output.commande.statut}`;
    case 'creer_facture':
      return `فاتورة ${output.facture.numero} بـ ${output.facture.totalTTC} DT`;
    case 'creer_rappel':
      return `تذكير: ${output.rappel.titre} (${output.rappel.quand})`;
    case 'marquer_rappel_fait':
      return `تذكير مشطوب: ${output.fait.titre}`;
    case 'enregistrer_vente':
      return `بيعة ${output.vente.montant} DT`;
    case 'ajouter_note':
      return `note: ${output.note.texte}`;
    case 'preparer_sms':
      return `SMS محضّر لـ ${output.brouillon_pret.nom}`;
    case 'parametres_boutique':
      return input && Object.keys(input).length ? 'تبدّلو معلومات الحانوت' : null;
    default:
      return null;
  }
}

module.exports.resume = resume;
