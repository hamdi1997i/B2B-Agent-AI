/**
 * Le cœur de la plateforme: un tour de parole avec l'assistant.
 *
 * Protocole (l'app Android appelle la même route deux fois quand il faut):
 *
 *   1. { message }                  → l'agent répond
 *      ← { status: 'complete', reply, ... }
 *
 *   2. si l'agent a besoin du téléphone (agenda, contacts, SMS…):
 *      ← { status: 'needs_device', device_calls: [{ call_id, tool, input }] }
 *      l'app exécute, puis rappelle avec:
 *      { conversation_id, device_results: [{ call_id, output }] }
 *
 * Un crédit est débité au premier appel seulement — la reprise après un
 * outil du téléphone fait partie du même tour de parole.
 */

import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient, userFromRequest, type Db } from '../_shared/db.ts';
import { getProvider } from '../_shared/llm/index.ts';
import type { Block, Msg } from '../_shared/llm/types.ts';
import { textOf, toolCallsOf } from '../_shared/llm/types.ts';
import { computeCost } from '../_shared/cost.ts';
import { systemPrompt } from '../_shared/prompt.ts';
import {
  kindOf,
  loadCatalogue,
  pendingConsents,
  runServerTool,
  toolDefs,
  webSearchAllowed,
} from '../_shared/tools.ts';

const MAX_STEPS = 6;

interface Body {
  conversation_id?: string;
  message?: string;
  device_results?: Array<{ call_id: string; output: unknown; is_error?: boolean }>;
}

export async function handler(req: Request): Promise<Response> {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== 'POST') return fail('method', 'POST seulement', 405);

  const db = serviceClient();
  const user = await userFromRequest(req, db);
  if (!user) return fail('unauthorized', 'جدّد الدخول للتطبيق.', 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail('bad_request', 'طلب غير صالح.', 400);
  }

  const isResume = Array.isArray(body.device_results) && body.device_results.length > 0;
  const message = (body.message ?? '').trim();
  if (!isResume && !message) return fail('bad_request', 'ما فمّاش رسالة.', 400);

  // ── 1. droit de parler: abonnement, crédits, plafond du jour ────────────
  let turn: Record<string, unknown>;
  if (isResume) {
    const { data: sub } = await db
      .from('subscriptions')
      .select('plan_key, credits_remaining')
      .eq('user_id', user.id)
      .maybeSingle();
    const { data: plan } = sub?.plan_key
      ? await db
          .from('plans')
          .select('model_tier, history_messages')
          .eq('key', sub.plan_key)
          .maybeSingle()
      : { data: null };
    turn = {
      allowed: true,
      plan: sub?.plan_key ?? null,
      model_tier: plan?.model_tier ?? 'standard',
      history_messages: plan?.history_messages ?? 20,
      credits_remaining: sub?.credits_remaining ?? 0,
    };
  } else {
    const { data, error } = await db.rpc('begin_agent_turn', { p_user: user.id });
    if (error) return fail('server', error.message, 500);
    turn = (data ?? {}) as Record<string, unknown>;
    if (!turn.allowed) {
      return json({ status: 'blocked', reason: turn.reason, ...turn }, 402);
    }
  }

  const planKey = (turn.plan as string) ?? null;
  const tier = (turn.model_tier as 'light' | 'standard' | 'advanced') ?? 'standard';
  const historyDepth = Number(turn.history_messages ?? 20);

  // ── 2. contexte: profil, apps autorisées, conversation ──────────────────
  const [{ data: profile }, catalogue] = await Promise.all([
    db.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    loadCatalogue(db, user.id, planKey),
  ]);

  const conversationId = await ensureConversation(db, user.id, body.conversation_id, message);
  const history = await loadHistory(db, conversationId, historyDepth);

  const messages: Msg[] = [...history];
  if (isResume) {
    const blocks: Block[] = body.device_results!.map((r) => ({
      type: 'tool_result',
      call_id: r.call_id,
      output: r.output,
      ...(r.is_error ? { is_error: true } : {}),
    }));
    messages.push({ role: 'user', blocks });
    await saveMessage(db, conversationId, user.id, 'user', blocks);
  } else {
    const blocks: Block[] = [{ type: 'text', text: message }];
    messages.push({ role: 'user', blocks });
    await saveMessage(db, conversationId, user.id, 'user', blocks);
  }

  // ── 3. boucle: le modèle, les outils serveur, puis la main au téléphone ─
  const provider = getProvider();
  const system = systemPrompt({ fullName: profile?.full_name, catalogue });
  const defs = toolDefs(catalogue);
  const webSearch = webSearchAllowed(catalogue);
  const usedTools: string[] = [];
  const startedAt = Date.now();

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await provider.complete({
        tier,
        system,
        messages,
        tools: defs,
        webSearch,
      });

      await logUsage(db, {
        userId: user.id,
        conversationId,
        provider: response.provider,
        model: response.model,
        usage: response.usage,
        tools: usedTools,
        durationMs: Date.now() - startedAt,
        credits: isResume ? 0 : 1,
      });

      messages.push({ role: 'assistant', blocks: response.blocks });
      await saveMessage(db, conversationId, user.id, 'assistant', response.blocks);

      if (response.stop === 'refusal') {
        return json({
          status: 'complete',
          conversation_id: conversationId,
          reply: 'سامحني، ما نجّمتش نكمّل الطلب هذا.',
          credits_remaining: turn.credits_remaining,
        });
      }

      const calls = toolCallsOf(response.blocks);
      if (!calls.length) {
        return json({
          status: 'complete',
          conversation_id: conversationId,
          reply: textOf(response.blocks),
          tools_used: usedTools,
          credits_remaining: turn.credits_remaining,
          pending_consents: pendingConsents(catalogue).map((c) => c.key),
        });
      }

      // Les apps du téléphone: on rend la main à l'app mobile.
      const deviceCalls = calls.filter((c) => kindOf(catalogue, c.name) === 'device');
      if (deviceCalls.length) {
        usedTools.push(...calls.map((c) => c.name));
        return json({
          status: 'needs_device',
          conversation_id: conversationId,
          say: textOf(response.blocks),
          device_calls: deviceCalls.map((c) => ({ call_id: c.id, tool: c.name, input: c.input })),
          credits_remaining: turn.credits_remaining,
        });
      }

      // Les apps serveur s'exécutent tout de suite.
      const results: Block[] = [];
      for (const call of calls) {
        usedTools.push(call.name);
        const output = await runServerTool(db, user.id, call.name, call.input);
        results.push({ type: 'tool_result', call_id: call.id, output });
      }
      messages.push({ role: 'user', blocks: results });
      await saveMessage(db, conversationId, user.id, 'user', results);
    }

    return json({
      status: 'complete',
      conversation_id: conversationId,
      reply: 'الطلب طوّل برشا. عاود جرّب بجملة أبسط.',
      credits_remaining: turn.credits_remaining,
    });
  } catch (e) {
    // Panne du fournisseur: on rend le crédit, l'utilisateur ne paie pas notre incident.
    if (!isResume) await db.rpc('refund_agent_turn', { p_user: user.id, p_cause: 'provider_error' });
    await logUsage(db, {
      userId: user.id,
      conversationId,
      provider: 'unknown',
      model: 'unknown',
      usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
      tools: usedTools,
      durationMs: Date.now() - startedAt,
      credits: 0,
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
    return fail('provider', 'الخدمة مقطوعة شويّة. عاود من بعد شويّة.', 502);
  }
}

// ─────────────────────────────────────────────────────────── helpers ──────

async function ensureConversation(
  db: Db,
  userId: string,
  conversationId: string | undefined,
  firstMessage: string,
): Promise<string> {
  if (conversationId) {
    const { data } = await db
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (data) {
      await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', data.id);
      return data.id as string;
    }
  }
  const title = firstMessage.slice(0, 60) || 'حوار';
  const { data, error } = await db
    .from('conversations')
    .insert({ user_id: userId, title })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function loadHistory(db: Db, conversationId: string, depth: number): Promise<Msg[]> {
  const { data } = await db
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('id', { ascending: false })
    .limit(Math.max(depth, 2));

  const rows = (data ?? []).reverse() as Array<{ role: 'user' | 'assistant'; content: Block[] }>;

  // Ne jamais commencer l'historique par un résultat d'outil orphelin.
  while (rows.length && (rows[0].role !== 'user' || rows[0].content.some((b) => b.type === 'tool_result'))) {
    rows.shift();
  }
  return rows.map((r) => ({ role: r.role, blocks: r.content }));
}

async function saveMessage(
  db: Db,
  conversationId: string,
  userId: string,
  role: 'user' | 'assistant',
  blocks: Block[],
): Promise<void> {
  await db.from('messages').insert({
    conversation_id: conversationId,
    user_id: userId,
    role,
    content: blocks,
  });
}

interface UsageLog {
  userId: string;
  conversationId: string;
  provider: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number };
  tools: string[];
  durationMs: number;
  credits: number;
  status?: string;
  error?: string;
}

async function logUsage(db: Db, log: UsageLog): Promise<void> {
  const { data: price } = await db
    .from('model_prices')
    .select('input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok')
    .eq('provider', log.provider)
    .eq('model', log.model)
    .maybeSingle();

  await db.from('usage_events').insert({
    user_id: log.userId,
    conversation_id: log.conversationId,
    provider: log.provider,
    model: log.model,
    input_tokens: log.usage.input_tokens,
    output_tokens: log.usage.output_tokens,
    cache_read_tokens: log.usage.cache_read_tokens,
    cache_write_tokens: log.usage.cache_write_tokens,
    cost_usd: computeCost(log.usage, price),
    credits_charged: log.credits,
    tools_used: log.tools,
    duration_ms: log.durationMs,
    status: log.status ?? 'ok',
    error: log.error ?? null,
  });
}
