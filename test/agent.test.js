'use strict';

/**
 * Tests hors-ligne de l'agent: magasin, outils et boucle tool-use.
 *
 * Le modèle est remplacé par un faux client Anthropic scripté, donc ces
 * tests tournent sans clé API et sans réseau:
 *   node test/agent.test.js
 */

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Module = require('module');

process.env.TN_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tn-')), 'db.json');

// ---- faux SDK Anthropic, injecté dans le cache de modules ------------------
const scenario = [];

class FakeStream {
  constructor(reply) {
    this.reply = reply;
    this.handlers = {};
  }
  on(event, cb) {
    this.handlers[event] = cb;
    return this;
  }
  async finalMessage() {
    for (const block of this.reply.content) {
      if (block.type === 'text' && this.handlers.text) this.handlers.text(block.text);
    }
    return this.reply;
  }
}

class FakeAnthropic {
  constructor() {
    this.calls = [];
    this.messages = {
      stream: (params) => {
        // instantané: la boucle mute le tableau `messages` après l'appel
        this.calls.push(structuredClone(params));
        FakeAnthropic.last = this;
        const next = scenario.shift();
        if (!next) throw new Error('scénario épuisé');
        return new FakeStream(next);
      },
    };
  }
}
class FakeAPIError extends Error {}
FakeAnthropic.APIError = FakeAPIError;
FakeAnthropic.AuthenticationError = class extends FakeAPIError {};
FakeAnthropic.RateLimitError = class extends FakeAPIError {};
FakeAnthropic.APIConnectionError = class extends FakeAPIError {};

const sdkPath = require.resolve('@anthropic-ai/sdk');
require.cache[sdkPath] = new Module(sdkPath, null);
require.cache[sdkPath].filename = sdkPath;
require.cache[sdkPath].loaded = true;
require.cache[sdkPath].exports = FakeAnthropic;

process.env.ANTHROPIC_API_KEY = 'test-key';

const store = require('../src/tn/store');
const tools = require('../src/tn/tools');
const brain = require('../src/tn/brain');
const facture = require('../src/tn/facture');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

const text = (t) => ({ type: 'text', text: t });
const call = (name, input, id = `tu_${Math.random().toString(36).slice(2)}`) => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const reply = (content, stop_reason = 'end_turn') => ({ content, stop_reason, model: 'fake' });

(async function run() {
  store.reset();

  console.log('\nمخزن المعطيات (store)');
  test('normalise les numéros tunisiens', () => {
    assert.strictEqual(store.normalizePhone('20 123 456'), '+21620123456');
    assert.strictEqual(store.normalizePhone('+216 22 334 455'), '+21622334455');
    assert.strictEqual(store.normalizePhone('0021629000000'), '+21629000000');
  });
  test('retrouve un client malgré les diacritiques', () => {
    const c = store.addClient({ nom: 'أَحْمَد', tel: '20123456' });
    assert.strictEqual(store.findClients('احمد')[0].id, c.id);
    assert.strictEqual(store.findClients('20123456')[0].id, c.id);
  });
  test('les jours se décalent correctement', () => {
    assert.strictEqual(store.addDays('2026-02-28', 1), '2026-03-01');
    assert.strictEqual(store.addDays('2026-12-31', 1), '2027-01-01');
  });

  console.log('\nالأدوات (tools)');
  test('une dette puis un paiement partiel laissent le reste juste', () => {
    tools.execute('enregistrer_dette', { client: 'احمد', montant: 250, echeance: '2026-01-20' });
    const out = tools.execute('enregistrer_paiement', { client: 'احمد', montant: 100 });
    assert.strictEqual(out.encaisse, 100);
    assert.strictEqual(out.reste_a_payer, 150);
  });
  test('un client inconnu renvoie une erreur exploitable par le modèle', () => {
    const out = tools.execute('enregistrer_dette', { client: 'ma-fammech', montant: 10 });
    assert.ok(out.error, 'devrait porter un champ error');
  });
  test('le paiement en trop devient une avance, pas une dette négative', () => {
    const out = tools.execute('enregistrer_paiement', { client: 'احمد', montant: 400 });
    assert.strictEqual(out.reste_a_payer, 0);
    assert.strictEqual(out.avance, 250);
  });
  test('la commande calcule son total et change de statut', () => {
    const c = tools.execute('creer_commande', {
      client: 'احمد',
      articles: [{ designation: 'carton', qte: 10, prixUnitaire: 25 }],
    });
    assert.strictEqual(c.commande.total, 250);
    const s = tools.execute('changer_statut_commande', { client: 'احمد', statut: 'livree' });
    assert.strictEqual(s.commande.statut, 'livree');
  });
  test('la facture applique la TVA et sort en HTML', () => {
    const f = tools.execute('creer_facture', { client: 'احمد', tva: 19 });
    assert.strictEqual(f.facture.totalHT, 250);
    assert.strictEqual(f.facture.totalTTC, 297.5);
    const html = facture.render(f.facture.id);
    assert.ok(html.includes(f.facture.numero));
    assert.ok(html.includes('297.500'));
  });
  test('le bilan compte la commande livrée du jour', () => {
    const b = tools.execute('bilan_ventes', {});
    assert.strictEqual(b.commandesLivrees.nombre, 1);
    assert.strictEqual(b.chiffreAffaires, 250);
  });
  test('preparer_sms ne fait que préparer', () => {
    const out = tools.execute('preparer_sms', { client: 'احمد', message: 'الطلبية جاهزة' });
    assert.strictEqual(out.brouillon_pret.tel, '+21620123456');
    assert.ok(!out.envoye);
  });
  test('un SMS vers un client sans numéro est refusé', () => {
    tools.execute('ajouter_client', { nom: 'سامي' });
    const out = tools.execute('preparer_sms', { client: 'سامي', message: 'أهلا' });
    assert.ok(out.error);
  });
  test('chaque outil expose un schéma complet', () => {
    for (const s of tools.SCHEMAS) {
      assert.ok(s.name && s.description, `${s.name}: description manquante`);
      assert.strictEqual(s.input_schema.type, 'object', `${s.name}: schéma invalide`);
    }
  });

  console.log("\nحلقة الـagent (boucle tool-use)");
  await testAsync('enchaîne plusieurs outils dans un seul tour de parole', async () => {
    store.reset();
    scenario.length = 0;
    scenario.push(
      reply(
        [
          call('ajouter_client', { nom: 'محمد', tel: '22334455' }, 'tu1'),
          call('enregistrer_dette', { client: 'محمد', montant: 250, echeance: '2026-09-20' }, 'tu2'),
        ],
        'tool_use',
      ),
      reply([text('سجّلت محمد و250 دينار كريدي، الأجل نهار 20.')]),
    );

    const events = [];
    const out = await brain.respond({
      sessionId: 'test',
      message: 'سجّل محمد نمرتو 22334455، عليه 250 دينار يخلّص نهار 20',
      emit: (e, d) => events.push([e, d]),
    });

    assert.ok(out.reply.includes('250'), 'la réponse parlée doit citer le montant');
    assert.deepStrictEqual(
      out.outils.map((o) => o.name),
      ['ajouter_client', 'enregistrer_dette'],
    );
    assert.strictEqual(store.load().clients.length, 1);
    assert.strictEqual(store.dettesOuvertes()[0].reste, 250);
    assert.ok(events.some(([e]) => e === 'text'), 'du texte doit être diffusé');
    assert.ok(events.filter(([e]) => e === 'tool').length === 4, 'start+done pour chaque outil');
    assert.strictEqual(events.at(-1)[0], 'done');
    assert.strictEqual(store.journal().length, 2, "le fil d'activité doit être alimenté");
  });

  await testAsync('le brouillon SMS remonte comme action à confirmer', async () => {
    scenario.length = 0;
    scenario.push(
      reply([call('preparer_sms', { client: 'محمد', message: 'الطلبية متاعك جاهزة' }, 'tu3')], 'tool_use'),
      reply([text('الرسالة حاضرة، أكّد باش تتبعث.')]),
    );
    const actions = [];
    await brain.respond({
      sessionId: 'test',
      message: 'ابعث لمحمد رسالة قولّو الطلبية جاهزة',
      emit: (e, d) => e === 'action' && actions.push(d),
    });
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].type, 'sms');
    assert.strictEqual(actions[0].tel, '+21622334455');
  });

  await testAsync("l'historique de session est réutilisé au tour suivant", async () => {
    scenario.length = 0;
    scenario.push(reply([text('أهلا بيك.')]));
    await brain.respond({ sessionId: 'suite', message: 'سلام', emit: () => {} });
    scenario.push(reply([text('نعم.')]));
    await brain.respond({ sessionId: 'suite', message: 'واش سمعتني؟', emit: () => {} });
    const last = FakeAnthropic.last.calls.at(-1);
    assert.strictEqual(last.messages.length, 3, 'user + assistant + user');
    assert.strictEqual(last.model, brain.MODEL);
    assert.ok(last.tools.length >= 15, 'tous les outils doivent être proposés');
  });

  await testAsync('une erreur API est rendue en derja, sans planter', async () => {
    scenario.length = 0; // scénario vide -> le faux client jette
    const out = await brain.respond({ sessionId: 'err', message: 'تست', emit: () => {} });
    assert.ok(out.error, 'une erreur doit être signalée');
    assert.ok(out.reply.length > 0);
  });

  console.log(`\n${passed} tests OK${process.exitCode ? ' — avec des échecs' : ''}\n`);
})();
