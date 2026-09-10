/**
 * Accès à la base depuis les Edge Functions.
 *
 * Le client `service_role` contourne la RLS: il ne doit servir qu'après
 * avoir identifié l'utilisateur via son jeton, et n'agir que sur ses
 * propres lignes.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './env.ts';

export type Db = SupabaseClient;

let override: Db | null = null;

/** Point d'injection pour les tests (base PostgreSQL locale). */
export function setServiceClient(db: Db | null): void {
  override = db;
}

export function serviceClient(): Db {
  if (override) return override;
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Identifie l'appelant à partir de l'en-tête Authorization. */
export async function userFromRequest(req: Request, db: Db): Promise<{ id: string; email: string } | null> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? '' };
}
