/**
 * Contrat commun à tous les fournisseurs d'IA.
 *
 * Le reste du code (agent, outils, historique en base) ne connaît que ces
 * types. Changer de fournisseur = écrire un nouvel adaptateur qui implémente
 * `LlmProvider`, sans toucher à l'agent ni aux conversations déjà stockées.
 */

export type ModelTier = 'light' | 'standard' | 'advanced';

/** Un morceau de message, neutre vis-à-vis du fournisseur. */
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; call_id: string; output: unknown; is_error?: boolean };

export interface Msg {
  role: 'user' | 'assistant';
  blocks: Block[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmRequest {
  tier: ModelTier;
  system: string;
  messages: Msg[];
  tools: ToolDef[];
  /** Autorise la recherche web côté fournisseur (outil hébergé). */
  webSearch?: boolean;
  maxTokens?: number;
}

export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export type StopReason = 'end' | 'tool_call' | 'refusal' | 'max_tokens';

export interface LlmResponse {
  provider: string;
  model: string;
  blocks: Block[];
  stop: StopReason;
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly name: string;
  /** Modèle réellement utilisé pour ce niveau de formule. */
  modelFor(tier: ModelTier): string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Aide: le texte d'un message, pour l'affichage et la synthèse vocale. */
export function textOf(blocks: Block[]): string {
  return blocks
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

export function toolCallsOf(blocks: Block[]) {
  return blocks.filter(
    (b): b is Extract<Block, { type: 'tool_call' }> => b.type === 'tool_call',
  );
}
