/**
 * Le catalogue d'« apps » de l'agent.
 *
 * Trois filtres successifs décident de ce que le modèle voit:
 *   1. l'admin a activé l'app        (tools.is_enabled)
 *   2. la formule de l'utilisateur y donne droit (tools.min_plan)
 *   3. l'utilisateur a donné son accord (user_tools.status = 'granted')
 *
 * Une app `device` s'exécute sur le téléphone: la fonction rend la main à
 * l'app mobile, qui exécute et rappelle avec le résultat.
 */

import type { Db } from './db.ts';
import type { ToolDef } from './llm/types.ts';

export interface CatalogueEntry {
  key: string;
  name_ar: string;
  kind: 'device' | 'server' | 'oauth';
  icon: string | null;
  android_permissions: string[];
  oauth_provider: string | null;
  requires_consent: boolean;
  min_plan: string | null;
  model_description: string;
  input_schema: Record<string, unknown>;
  prompt_hint: string | null;
  consent: 'granted' | 'denied' | null;
  available: boolean; // la formule y donne droit
}

/** Clé de l'app de recherche web: outil hébergé par le fournisseur d'IA. */
export const WEB_SEARCH_KEY = 'recherche_web';

export async function loadCatalogue(db: Db, userId: string, planKey: string | null): Promise<CatalogueEntry[]> {
  const [{ data: tools }, { data: consents }, { data: plans }] = await Promise.all([
    db.from('tools').select('*').eq('is_enabled', true).order('sort'),
    db.from('user_tools').select('tool_key, status').eq('user_id', userId),
    db.from('plans').select('key, sort'),
  ]);

  const rank = new Map((plans ?? []).map((p: { key: string; sort: number }) => [p.key, p.sort]));
  const userRank = planKey ? (rank.get(planKey) ?? 0) : 0;
  const consentByKey = new Map(
    (consents ?? []).map((c: { tool_key: string; status: string }) => [c.tool_key, c.status]),
  );

  return (tools ?? []).map((t: Record<string, unknown>) => {
    const minPlan = t.min_plan as string | null;
    return {
      key: t.key as string,
      name_ar: t.name_ar as string,
      kind: t.kind as CatalogueEntry['kind'],
      icon: (t.icon as string) ?? null,
      android_permissions: (t.android_permissions as string[]) ?? [],
      oauth_provider: (t.oauth_provider as string) ?? null,
      requires_consent: t.requires_consent as boolean,
      min_plan: minPlan,
      model_description: t.model_description as string,
      input_schema: t.input_schema as Record<string, unknown>,
      prompt_hint: (t.prompt_hint as string) ?? null,
      consent: (consentByKey.get(t.key as string) as 'granted' | 'denied') ?? null,
      available: !minPlan || (rank.get(minPlan) ?? 0) <= userRank,
    };
  });
}

/** Une app est utilisable si la formule y donne droit et que l'accord est là. */
export function isUsable(entry: CatalogueEntry): boolean {
  if (!entry.available) return false;
  if (entry.consent === 'denied') return false;
  return entry.requires_consent ? entry.consent === 'granted' : true;
}

/** Les apps que l'agent peut réellement appeler, au format du fournisseur. */
export function toolDefs(catalogue: CatalogueEntry[]): ToolDef[] {
  return catalogue
    .filter(isUsable)
    .filter((e) => e.key !== WEB_SEARCH_KEY) // outil hébergé, pas un outil client
    .map((e) => ({
      name: e.key,
      description: e.model_description,
      input_schema: e.input_schema,
    }));
}

export function webSearchAllowed(catalogue: CatalogueEntry[]): boolean {
  const entry = catalogue.find((e) => e.key === WEB_SEARCH_KEY);
  return entry ? isUsable(entry) : false;
}

/** Apps activées par l'admin qui attendent encore une réponse de l'utilisateur. */
export function pendingConsents(catalogue: CatalogueEntry[]): CatalogueEntry[] {
  return catalogue.filter((e) => e.available && e.requires_consent && e.consent === null);
}

export function kindOf(catalogue: CatalogueEntry[], key: string): CatalogueEntry['kind'] | null {
  return catalogue.find((e) => e.key === key)?.kind ?? null;
}

// ─────────────────────────────────────────── exécution côté serveur ───────

/**
 * Les apps `server` s'exécutent ici. Pour l'instant: la mémoire de
 * l'assistant (notes). Les apps `oauth` viendront s'ajouter dans ce même
 * aiguillage quand les connexions Google seront branchées.
 */
export async function runServerTool(
  db: Db,
  userId: string,
  key: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (key === 'notes') return runNotes(db, userId, input);
  return { error: `l'app « ${key} » n'est pas encore branchée côté serveur.` };
}

async function runNotes(db: Db, userId: string, input: Record<string, unknown>): Promise<unknown> {
  const action = String(input.action ?? 'lister');
  const texte = typeof input.texte === 'string' ? input.texte.trim() : '';
  const tags = Array.isArray(input.tags) ? (input.tags as string[]) : [];

  switch (action) {
    case 'ajouter': {
      if (!texte) return { error: 'النص فارغ.' };
      const { data, error } = await db
        .from('notes')
        .insert({ user_id: userId, text: texte, tags })
        .select('id, text, created_at')
        .single();
      return error ? { error: error.message } : { ajoutee: data };
    }
    case 'lister': {
      const { data, error } = await db
        .from('notes')
        .select('id, text, tags, done, created_at')
        .eq('user_id', userId)
        .eq('done', false)
        .order('created_at', { ascending: false })
        .limit(20);
      return error ? { error: error.message } : { notes: data };
    }
    case 'chercher': {
      const { data, error } = await db
        .from('notes')
        .select('id, text, tags, done, created_at')
        .eq('user_id', userId)
        .ilike('text', `%${texte}%`)
        .limit(20);
      return error ? { error: error.message } : { notes: data };
    }
    case 'terminer':
    case 'supprimer': {
      const id = String(input.note_id ?? '');
      if (!id) return { error: 'حدّد النوتة.' };
      if (action === 'supprimer') {
        const { error } = await db.from('notes').delete().eq('user_id', userId).eq('id', id);
        return error ? { error: error.message } : { supprimee: id };
      }
      const { error } = await db
        .from('notes')
        .update({ done: true })
        .eq('user_id', userId)
        .eq('id', id);
      return error ? { error: error.message } : { terminee: id };
    }
    default:
      return { error: `action inconnue: ${action}` };
  }
}
