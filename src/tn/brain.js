'use strict';

/**
 * Le cerveau de l'agent: boucle tool-use en streaming sur l'API Claude.
 *
 * L'appelant fournit une fonction `emit(event, data)` — les événements
 * partent en SSE vers le téléphone:
 *   text   -> morceau de réponse à afficher / lire à voix haute
 *   tool   -> outil démarré / terminé (fil d'activité)
 *   action -> brouillon SMS ou facture qui attend la confirmation du commerçant
 *   done   -> fin du tour
 */

const Anthropic = require('@anthropic-ai/sdk');
const store = require('./store');
const { SCHEMAS, execute, resume } = require('./tools');

const MODEL = process.env.TN_MODEL || 'claude-opus-5';
const EFFORT = process.env.TN_EFFORT || 'low';
const MAX_TOURS = 8;
const MAX_HISTORIQUE = 24; // messages gardés par session

let client = null;
function anthropic() {
  if (!client) client = new Anthropic();
  return client;
}

function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const JOURS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function systemPrompt() {
  const t = store.today();
  const jour = JOURS[new Date(`${t}T12:00:00Z`).getUTCDay()];
  const a = store.apercu();
  const b = a.boutique;
  return `أنت "المعاون" — مساعد ذكي للتاجر التونسي، يخدم بالصوت في تليفون Android.

اللغة: جاوب بالدارجة التونسية، بجملة ولا جوز، قصير وواضح — الكلام يتقرا بالصوت (TTS)، ما تكتبش listes طويلة ولا markdown ولا emoji. الفلوس بالدينار (DT) والمليم.

اليوم: ${jour} ${t} (توقيت تونس، ${store.now()}).
قواعد التواريخ: "اليوم"=${t}، "غدوة"=${store.addDays(t, 1)}، "بعد غدوة"=${store.addDays(t, 2)}. "نهار 20" يعني اليوم 20 متاع الشهر هذا، وإذا فات → الشهر الجاي. حوّل ديما التاريخ لـ YYYY-MM-DD (وزيد THH:mm كان قالك وقت).

الخدمة متاعك: تستعمل الـtools باش تسجّل وتقرا من دفتر التاجر (كليان، كريدي، طلبيات، فواتير، تذكيرات، مبيعات). ما تخمّنش وما تخترعش معلومة: كان تحتاج معلومة ناقصة (مبلغ، اسم، نمرة) أسأل سؤال قصير واحد برك. كان الجملة فيها أكثر من حاجة (مثلا كليان جديد + كريدي + échéance) اعمل الـtools الكل وحدة ورا وحدة في نفس الدور.

SMS: ما تنجّمش تبعث. preparer_sms يحضّر البروجي برك، والتاجر هو اللي يأكّد ويبعث من تليفونو. قول "الرسالة حاضرة، أكّد باش تتبعث" — عمرك ما تقول "بعثتها".

الحانوت: ${b.nom || 'بلا اسم مسجّل'}${b.tel ? ' — ' + b.tel : ''}. عندك ${a.clients} كليان، ${a.commandesEnCours} طلبية ماشية، ${a.impayes} كريدي مفتوح.`;
}

const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
}

function trim(history) {
  if (history.length <= MAX_HISTORIQUE) return history;
  // On coupe au début, mais jamais au milieu d'un couple tool_use / tool_result.
  let cut = history.length - MAX_HISTORIQUE;
  while (cut < history.length) {
    const m = history[cut];
    const isToolResult =
      Array.isArray(m.content) && m.content.some((b) => b && b.type === 'tool_result');
    if (m.role === 'user' && !isToolResult) break;
    cut += 1;
  }
  return history.slice(cut);
}

function resetSession(id) {
  sessions.delete(id);
}

/** Un tour de conversation complet (peut enchaîner plusieurs appels d'outils). */
async function respond({ sessionId = 'default', message, emit }) {
  if (!hasApiKey()) {
    const msg =
      'ما فمّاش clé API. حطّ ANTHROPIC_API_KEY في الـenvironment وأعاود شغّل السرفور.';
    emit('text', msg);
    emit('done', { reply: msg, error: 'missing_api_key' });
    return { reply: msg, error: 'missing_api_key' };
  }

  const history = trim(getSession(sessionId));
  history.push({ role: 'user', content: message });

  let reply = '';
  const outils = [];

  try {
    for (let tour = 0; tour < MAX_TOURS; tour += 1) {
      const stream = anthropic().messages.stream({
        model: MODEL,
        max_tokens: 8000,
        system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
        thinking: { type: 'adaptive' },
        output_config: { effort: EFFORT },
        tools: SCHEMAS,
        messages: history,
      });

      stream.on('text', (delta) => {
        reply += delta;
        emit('text', delta);
      });

      const msg = await stream.finalMessage();

      if (msg.stop_reason === 'refusal') {
        const excuse = 'سامحني، ما نجّمتش نكمّل الطلب هذا.';
        reply += excuse;
        emit('text', excuse);
        break;
      }

      history.push({ role: 'assistant', content: msg.content });

      if (msg.stop_reason === 'pause_turn') continue;

      const calls = msg.content.filter((b) => b.type === 'tool_use');
      if (!calls.length) break;

      const results = [];
      for (const call of calls) {
        emit('tool', { phase: 'start', name: call.name, input: call.input });
        const out = execute(call.name, call.input, { emit });
        const ligne = resume(call.name, call.input, out);
        if (ligne) store.addJournal(ligne, call.name);
        outils.push({ name: call.name, input: call.input, output: out });
        emit('tool', { phase: 'done', name: call.name, output: out, resume: ligne });
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(out),
          ...(out && out.error ? { is_error: true } : {}),
        });
      }
      history.push({ role: 'user', content: results });
    }
  } catch (e) {
    const msg = friendlyError(e);
    emit('text', msg);
    emit('done', { reply: msg, error: e.constructor ? e.constructor.name : 'error' });
    return { reply: msg, error: msg, outils };
  }

  sessions.set(sessionId, trim(history));
  emit('done', { reply, outils: outils.map((o) => o.name) });
  return { reply, outils };
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'الـclé API ماهيش صحيحة. شوف ANTHROPIC_API_KEY.';
  if (e instanceof Anthropic.RateLimitError) return 'برشا طلبات في نفس الوقت. استنّى شويّة وأعاود.';
  if (e instanceof Anthropic.APIConnectionError) return 'ما فماش connexion. شوف الإنترنت وأعاود.';
  if (e instanceof Anthropic.APIError) return `مشكل في الـAPI (${e.status}): ${e.message}`;
  return `صار مشكل: ${e.message || e}`;
}

module.exports = { respond, resetSession, hasApiKey, MODEL };
