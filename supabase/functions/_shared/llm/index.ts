/**
 * Choix du fournisseur d'IA.
 *
 * Un seul endroit à toucher pour en brancher un autre (OpenAI, Mistral…):
 * écrire un adaptateur qui implémente `LlmProvider`, l'ajouter ici, et
 * changer le secret AI_PROVIDER. Le reste de la plateforme — outils,
 * historique, comptage des crédits, tableau de bord — ne bouge pas.
 */

import { env } from '../env.ts';
import { AnthropicProvider } from './anthropic.ts';
import type { LlmProvider } from './types.ts';

let cached: LlmProvider | null = null;

export function getProvider(): LlmProvider {
  if (cached) return cached;

  const name = env('AI_PROVIDER', 'anthropic');
  switch (name) {
    case 'anthropic':
      cached = new AnthropicProvider();
      break;
    default:
      throw new Error(
        `fournisseur d'IA inconnu: « ${name} ». Ajoute son adaptateur dans _shared/llm/.`,
      );
  }
  return cached;
}

/** Pour les tests: injecter un faux fournisseur. */
export function setProvider(provider: LlmProvider | null): void {
  cached = provider;
}

export * from './types.ts';
