/** Faux fournisseur d'IA: on lui donne d'avance les réponses du modèle. */

import type { Block, LlmProvider, LlmRequest, LlmResponse, ModelTier } from '../functions/_shared/llm/types.ts';

export class FakeProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly calls: LlmRequest[] = [];
  private script: LlmResponse[] = [];
  private failWith: Error | null = null;

  modelFor(tier: ModelTier): string {
    return { light: 'claude-haiku-4-5', standard: 'claude-sonnet-5', advanced: 'claude-opus-5' }[tier];
  }

  /** Enchaîne les réponses que le modèle « donnera », dans l'ordre. */
  script_(...responses: Array<Partial<LlmResponse> & { blocks: Block[] }>): this {
    this.script = responses.map((r) => ({
      provider: this.name,
      model: r.model ?? 'claude-sonnet-5',
      stop: r.stop ?? (r.blocks.some((b) => b.type === 'tool_call') ? 'tool_call' : 'end'),
      usage: r.usage ?? {
        input_tokens: 1200,
        output_tokens: 90,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      },
      blocks: r.blocks,
    }));
    return this;
  }

  fail(error: Error): this {
    this.failWith = error;
    return this;
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(structuredClone(request));
    if (this.failWith) return Promise.reject(this.failWith);
    const next = this.script.shift();
    if (!next) throw new Error('scénario épuisé: le modèle a été appelé plus que prévu');
    return Promise.resolve(next);
  }
}

export const text = (t: string): Block => ({ type: 'text', text: t });
export const call = (name: string, input: Record<string, unknown>, id = `tu_${name}`): Block => ({
  type: 'tool_call',
  id,
  name,
  input,
});
