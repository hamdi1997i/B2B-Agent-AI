/** Coût réel d'un appel au fournisseur, à partir des tarifs en base. */

import type { LlmUsage } from './llm/types.ts';

export interface ModelPrice {
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  cache_read_usd_per_mtok: number;
  cache_write_usd_per_mtok: number;
}

const PER_MILLION = 1_000_000;

export function computeCost(usage: LlmUsage, price: ModelPrice | null): number {
  if (!price) return 0;
  const usd =
    (usage.input_tokens * price.input_usd_per_mtok +
      usage.output_tokens * price.output_usd_per_mtok +
      usage.cache_read_tokens * price.cache_read_usd_per_mtok +
      usage.cache_write_tokens * price.cache_write_usd_per_mtok) /
    PER_MILLION;
  return Math.round(usd * 1e6) / 1e6;
}
