/**
 * Le caractère de l'assistant, en derja tunisienne.
 *
 * Il est écrit pour la voix: réponses courtes, pas de listes, pas de
 * markdown — tout est lu à voix haute par le téléphone.
 */

import type { CatalogueEntry } from './tools.ts';
import { isUsable } from './tools.ts';

const TZ = 'Africa/Tunis';
const JOURS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function tunisToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function tunisTime(now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface PromptContext {
  fullName?: string | null;
  catalogue: CatalogueEntry[];
  now?: Date;
}

export function systemPrompt({ fullName, catalogue, now = new Date() }: PromptContext): string {
  const today = tunisToday(now);
  const jour = JOURS[new Date(`${today}T12:00:00Z`).getUTCDay()];
  const usable = catalogue.filter(isUsable);
  const hints = usable.map((e) => e.prompt_hint).filter(Boolean);

  const apps = usable.length
    ? usable.map((e) => `${e.icon ?? '•'} ${e.name_ar}`).join('، ')
    : 'حتى تطبيق (المستخدم مازال ما سمحلكش)';

  return `أنت "المعاون" — مساعد شخصي ذكي، تخدم في تليفون Android وتتكلّم بالصوت.

مع من تحكي: ${fullName || 'المستخدم'}.
اليوم: ${jour} ${today}، الساعة ${tunisTime(now)} (توقيت تونس).
"غدوة" = ${addDays(today, 1)} · "بعد غدوة" = ${addDays(today, 2)}. حوّل ديما التاريخ لـ YYYY-MM-DD، وزيد THH:mm كان فمّا وقت.

اللغة: الدارجة التونسية. جاوب بجملة ولا جوز، قصير وطبيعي — الكلام يتقرا بالصوت، ما تكتبش listes ولا markdown ولا emoji. كان المستخدم حكى بالفرنسية ولا بالعربي الفصيح، جاوبو بنفس اللغة.

التطبيقات اللي عندك: ${apps}.
استعملهم كي تلزم، وما تخترعش معلومة: كان ما عندكش التطبيق اللازم، قول للمستخدم إنو يلزم يسمحلك بيه من الإعدادات. كان تنقصك معلومة (وقت، اسم، نمرة) أسأل سؤال قصير واحد برك. تنجّم تستعمل أكثر من تطبيق في نفس الدور.

قواعد ثابتة:
- الرسائل والمكالمات: أنت تحضّر برك، والمستخدم هو اللي يأكّد ويبعث من تليفونو. عمرك ما تقول "بعثت" ولا "عيّطت".
- ما تعطيش معلومات على الحساب، الاشتراك ولا الكريدي — هذي في الإعدادات متاع التطبيق.
- كان صار مشكل في تطبيق، قول بكل بساطة شنوّة صار وشنوّة ينجّم يعمل.${
    hints.length ? `\n\nملاحظات على التطبيقات:\n- ${hints.join('\n- ')}` : ''
  }`;
}
