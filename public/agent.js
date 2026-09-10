'use strict';

/**
 * المعاون — logique de l'app.
 *
 * Deux environnements sont supportés:
 *  • Chrome / PWA installée: Web Speech API (reconnaissance + synthèse).
 *  • App Android (WebView): pont natif `window.TnNative` — la reconnaissance,
 *    la lecture vocale et l'ouverture de l'app SMS passent par Kotlin.
 */

const $ = (sel) => document.querySelector(sel);
const native = window.TnNative || null;

const feed = $('#feed');
const input = $('#text');
const micBtn = $('#mic');
const listening = $('#listening');
const partial = $('#partial');
const banner = $('#banner');

const state = {
  sessionId: localStorage.getItem('tn.session') || `s_${Math.random().toString(36).slice(2)}`,
  sound: localStorage.getItem('tn.sound') !== '0',
  busy: false,
  listening: false,
};
localStorage.setItem('tn.session', state.sessionId);

// ------------------------------------------------------------------ helpers

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function scrollDown() {
  feed.scrollTop = feed.scrollHeight;
}

function clearHero() {
  const hero = feed.querySelector('.hero');
  if (hero) hero.remove();
}

function addMine(text) {
  clearHero();
  feed.append(el('div', 'msg me', text));
  scrollDown();
}

/** Bulle de l'agent: texte en flux + bandeau des outils utilisés. */
function newAgentBubble() {
  clearHero();
  const bubble = el('div', 'msg ai');
  const body = el('span', 'body-text', '');
  const dot = el('span', 'typing');
  const tools = el('div', 'tools');
  bubble.append(body, dot, tools);
  feed.append(bubble);
  scrollDown();
  return {
    append(t) {
      body.textContent += t;
      scrollDown();
    },
    tool(name, running, resume) {
      let pill = tools.querySelector(`[data-tool="${name}"]`);
      if (!pill) {
        pill = el('span', 'tool-pill', name);
        pill.dataset.tool = name;
        tools.append(pill);
      }
      pill.classList.toggle('run', running);
      if (resume) pill.textContent = resume;
      scrollDown();
    },
    fail(text) {
      bubble.classList.add('err');
      body.textContent = body.textContent || text;
    },
    end() {
      dot.remove();
      return body.textContent.trim();
    },
  };
}

// --------------------------------------------------------------- SMS / facture

function smsCard(action) {
  const card = el('div', 'card');
  card.append(el('h4', null, 'رسالة حاضرة — أكّد باش تتبعث'));
  const to = el('div', 'to', `لـ ${action.nom} · `);
  to.append(el('bdi', null, action.tel)); // le numéro reste en LTR dans une phrase RTL
  card.append(to);
  const body = el('div', 'body', action.message);
  card.append(body);

  const row = el('div', 'row');
  const send = el('button', 'btn', 'ابعث');
  const cancel = el('button', 'btn secondary', 'إلغاء');
  row.append(send, cancel);
  card.append(row);
  feed.append(card);
  scrollDown();

  send.addEventListener('click', () => {
    const text = body.textContent;
    if (native && native.sendSms) native.sendSms(action.tel, text);
    else window.location.href = `sms:${action.tel}?body=${encodeURIComponent(text)}`;
    fetch('/api/tn/sms-envoye', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: action.nom, tel: action.tel }),
    }).then(refreshState, () => {});
    card.classList.add('done');
    row.replaceChildren(el('div', 'to', 'تعدّى لتطبيق الرسائل — أكّد الإرسال من غادي.'));
  });

  cancel.addEventListener('click', () => {
    card.classList.add('done');
    row.replaceChildren(el('div', 'to', 'تلغات.'));
  });
}

function factureCard(action) {
  const card = el('div', 'card');
  card.append(el('h4', null, `فاتورة ${action.numero}`));
  card.append(el('div', 'to', `المجموع: ${action.totalTTC} DT`));
  const row = el('div', 'row');
  const open = el('button', 'btn', 'افتح الفاتورة');
  open.addEventListener('click', () => window.open(action.url, '_blank', 'noopener'));
  row.append(open);
  card.append(row);
  feed.append(card);
  scrollDown();
}

window.__smsCard = smsCard; // utilisé par les tests visuels

// -------------------------------------------------------------------- parole

function speak(text) {
  if (!state.sound || !text) return;
  if (native && native.speak) return native.speak(text);
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ar-TN';
  const voice = window.speechSynthesis.getVoices().find((v) => /^ar/i.test(v.lang));
  if (voice) u.voice = voice;
  u.rate = 1;
  window.speechSynthesis.speak(u);
}

function stopSpeaking() {
  if (native && native.stopSpeaking) native.stopSpeaking();
  else if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

let recognition = null;

function startListening() {
  if (state.listening || state.busy) return;
  stopSpeaking();
  partial.textContent = 'نسمع فيك…';
  listening.hidden = false;
  state.listening = true;
  micBtn.dataset.on = '1';

  if (native && native.startListening) {
    native.startListening('ar-TN');
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    stopListening();
    showBanner('التليفون هذا ما يدعمش الصوت في الـnavigateur. اكتب هوني، ولا استعمل تطبيق Android.');
    input.focus();
    return;
  }
  recognition = new SR();
  recognition.lang = 'ar-TN';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onresult = (e) => {
    let text = '';
    for (const res of e.results) text += res[0].transcript;
    partial.textContent = text;
    if (e.results[e.results.length - 1].isFinal) {
      stopListening();
      send(text.trim());
    }
  };
  recognition.onerror = (e) => {
    stopListening();
    if (e.error === 'not-allowed') showBanner('لازم تسمح للتطبيق يستعمل الميكرو.');
    else if (e.error !== 'aborted' && e.error !== 'no-speech') showBanner(`مشكل في الصوت: ${e.error}`);
  };
  recognition.onend = () => stopListening();
  recognition.start();
}

function stopListening() {
  state.listening = false;
  listening.hidden = true;
  micBtn.dataset.on = '0';
  if (recognition) {
    try { recognition.abort(); } catch { /* déjà arrêtée */ }
    recognition = null;
  }
  if (native && native.stopListening) native.stopListening();
}

// Callbacks appelés depuis Kotlin (app Android).
window.tnOnSpeechPartial = (text) => { partial.textContent = text || 'نسمع فيك…'; };
window.tnOnSpeechResult = (text) => {
  stopListening();
  if (text && text.trim()) send(text.trim());
};
window.tnOnSpeechError = (msg) => {
  stopListening();
  showBanner(msg || 'ما فهمتش، عاود احكي.');
};

// --------------------------------------------------------------------- flux

function showBanner(text) {
  banner.textContent = text;
  banner.hidden = false;
  setTimeout(() => { banner.hidden = true; }, 6000);
}

/** Envoie une phrase à l'agent et consomme le flux SSE. */
async function send(text) {
  if (!text || state.busy) return;
  state.busy = true;
  input.value = '';
  addMine(text);
  const bubble = newAgentBubble();

  try {
    const res = await fetch('/api/tn/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, message: text }),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';
      for (const frame of frames) {
        const evLine = frame.split('\n').find((l) => l.startsWith('event: '));
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!evLine || !dataLine) continue;
        handleEvent(evLine.slice(7).trim(), JSON.parse(dataLine.slice(6)), bubble);
      }
    }
  } catch (e) {
    bubble.fail(`ما نجّمتش نوصل للسرفور: ${e.message}`);
  } finally {
    const reply = bubble.end();
    state.busy = false;
    speak(reply);
    refreshState();
  }
}

function handleEvent(event, data, bubble) {
  if (event === 'text') bubble.append(data);
  else if (event === 'tool') bubble.tool(data.name, data.phase === 'start', data.resume);
  else if (event === 'action') {
    if (data.type === 'sms') smsCard(data);
    else if (data.type === 'facture') factureCard(data);
  }
}

// -------------------------------------------------------------- le carnet

async function refreshState() {
  try {
    const r = await fetch('/api/tn/state');
    const s = await r.json();
    const a = s.apercu;
    $('#shop-name').textContent = a.boutique.nom || 'المعاون';

    $('#stats').replaceChildren(
      stat(a.clients, 'كليان'),
      stat(a.commandesEnCours, 'طلبيات ماشية'),
      stat(a.impayes, 'كريدي مفتوح'),
      stat(a.tachesAujourdhui, 'تذكير اليوم'),
    );

    const journal = $('#journal');
    journal.replaceChildren(
      ...(s.journal.length
        ? s.journal.map((j) => {
            const li = el('li');
            li.append(el('span', null, j.texte), el('span', 'when', j.at.slice(11, 16)));
            return li;
          })
        : [el('li', 'empty', 'مازال ما عملنا حتى حاجة.')]),
    );

    const imp = $('#impayes');
    const today = a.date;
    imp.replaceChildren(
      ...(s.impayes.length
        ? s.impayes.map((d) => {
            const li = el('li');
            if (d.echeance && d.echeance < today) li.classList.add('late');
            li.append(el('span', null, `${d.client} — ${d.reste} DT`), el('span', 'when', d.echeance || '—'));
            return li;
          })
        : [el('li', 'empty', 'الحمد لله، حتّى حد ما يسالكش.')]),
    );

    const form = $('#shop-form');
    for (const [k, v] of Object.entries(a.boutique)) {
      if (form.elements[k] && document.activeElement !== form.elements[k]) form.elements[k].value = v ?? '';
    }
  } catch { /* hors ligne: on garde l'affichage courant */ }
}

function stat(value, label) {
  const d = el('div', 'stat');
  d.append(el('b', null, String(value)), el('span', null, label));
  return d;
}

async function health() {
  try {
    const r = await fetch('/api/tn/health');
    const h = await r.json();
    $('#status-line').textContent = h.hasApiKey ? 'حاضر — احكي' : 'ينقص clé API';
    if (!h.hasApiKey) showBanner('حطّ ANTHROPIC_API_KEY في السرفور باش الـagent يخدم.');
  } catch {
    $('#status-line').textContent = 'السرفور مقطوع';
  }
}

// ------------------------------------------------------------------- events

micBtn.addEventListener('click', () => (state.listening ? stopListening() : startListening()));
$('#stop-listen').addEventListener('click', stopListening);
$('#send').addEventListener('click', () => send(input.value.trim()));
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send(input.value.trim());
});
for (const chip of document.querySelectorAll('#chips button')) {
  chip.addEventListener('click', () => send(chip.dataset.say));
}

$('#btn-sound').addEventListener('click', (e) => {
  state.sound = !state.sound;
  localStorage.setItem('tn.sound', state.sound ? '1' : '0');
  e.currentTarget.setAttribute('aria-pressed', String(state.sound));
  e.currentTarget.textContent = state.sound ? '🔊' : '🔇';
  if (!state.sound) stopSpeaking();
});
$('#btn-sound').setAttribute('aria-pressed', String(state.sound));
$('#btn-sound').textContent = state.sound ? '🔊' : '🔇';

$('#btn-panel').addEventListener('click', () => {
  $('#panel').hidden = false;
  refreshState();
});
$('#panel-close').addEventListener('click', () => { $('#panel').hidden = true; });

$('#shop-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.currentTarget).entries());
  if (data.tva) data.tva = Number(data.tva);
  await fetch('/api/tn/boutique', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  refreshState();
  showBanner('تسجّلت معلومات الحانوت.');
});

// Dans l'app Android: laisser changer l'adresse du serveur depuis le carnet.
if (native && native.openSettings) {
  const btn = el('button', 'ghost wide', 'بدّل عنوان السرفور');
  btn.addEventListener('click', () => native.openSettings());
  $('#btn-newchat').after(btn);
}

$('#btn-newchat').addEventListener('click', async () => {
  await fetch('/api/tn/session/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId }),
  });
  feed.replaceChildren();
  const hero = el('section', 'hero');
  hero.append(el('div', 'hero-bot', '🤖'), el('h1', null, 'شنوة نعملك؟'));
  feed.append(hero);
  $('#panel').hidden = true;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

health();
refreshState();
