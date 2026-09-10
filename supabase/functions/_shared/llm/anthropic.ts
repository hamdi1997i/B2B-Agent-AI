/**
 * Adaptateur Claude (Anthropic) — la seule partie du code qui connaît
 * l'API du fournisseur. Il traduit dans les deux sens entre nos types
 * neutres (`Block`, `Msg`) et le format Messages d'Anthropic.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.ts';
import type {
  Block,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  ModelTier,
  Msg,
  StopReason,
  ToolDef,
} from './types.ts';

/** Niveau de formule → modèle. Surchargeable par secret, sans redéploiement. */
const DEFAULT_MODELS: Record<ModelTier, string> = {
  light: 'claude-haiku-4-5',
  standard: 'claude-sonnet-5',
  advanced: 'claude-opus-5',
};

const MAX_PAUSE_RESUMES = 3;

function toAnthropicMessages(messages: Msg[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.blocks.map((b): Anthropic.ContentBlockParam => {
      switch (b.type) {
        case 'text':
          return { type: 'text', text: b.text };
        case 'tool_call':
          return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: b.call_id,
            content: typeof b.output === 'string' ? b.output : JSON.stringify(b.output),
            ...(b.is_error ? { is_error: true } : {}),
          };
      }
    }),
  }));
}

function toTools(tools: ToolDef[]): Anthropic.ToolUnion[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));
}

function fromAnthropicContent(content: Anthropic.ContentBlock[]): Block[] {
  const blocks: Block[] = [];
  for (const b of content) {
    if (b.type === 'text') {
      blocks.push({ type: 'text', text: b.text });
    } else if (b.type === 'tool_use') {
      blocks.push({
        type: 'tool_call',
        id: b.id,
        name: b.name,
        input: (b.input ?? {}) as Record<string, unknown>,
      });
    }
    // Les blocs d'outils hébergés (recherche web) restent côté fournisseur:
    // seul leur résultat en texte nous intéresse.
  }
  return blocks;
}

function mapStop(reason: string | null): StopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_call';
    case 'refusal':
      return 'refusal';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return 'end';
  }
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey = env('ANTHROPIC_API_KEY')) {
    this.client = new Anthropic({ apiKey });
  }

  modelFor(tier: ModelTier): string {
    return env(`MODEL_${tier.toUpperCase()}`) || DEFAULT_MODELS[tier];
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const model = this.modelFor(request.tier);
    const messages = toAnthropicMessages(request.messages);

    const tools: Anthropic.ToolUnion[] = toTools(request.tools);
    if (request.webSearch) {
      tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 4 });
    }

    const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
    let content: Anthropic.ContentBlock[] = [];
    let stop: string | null = null;

    // `pause_turn` = le fournisseur a mis en pause un outil hébergé (recherche
    // web) et attend qu'on relance; on lui rend la main avant de répondre.
    for (let attempt = 0; attempt <= MAX_PAUSE_RESUMES; attempt++) {
      const response = await this.client.messages.create({
        model,
        max_tokens: request.maxTokens ?? 8000,
        system: [
          { type: 'text', text: request.system, cache_control: { type: 'ephemeral' } },
        ],
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
        ...(tools.length ? { tools } : {}),
        messages,
      });

      usage.input_tokens += response.usage.input_tokens ?? 0;
      usage.output_tokens += response.usage.output_tokens ?? 0;
      usage.cache_read_tokens += response.usage.cache_read_input_tokens ?? 0;
      usage.cache_write_tokens += response.usage.cache_creation_input_tokens ?? 0;

      content = response.content;
      stop = response.stop_reason;

      if (response.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: response.content });
    }

    return {
      provider: this.name,
      model,
      blocks: fromAnthropicContent(content),
      stop: mapStop(stop),
      usage,
    };
  }
}
