/**
 * Départ de la connexion d'un compte Google pour une app donnée.
 *
 *   POST { tool: 'gmail' }  →  { url }   (l'app ouvre cette page)
 *
 * On ne demande que les accès de l'app choisie: connecter l'agenda ne
 * donne aucun droit sur Gmail.
 */

import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient, userFromRequest } from '../_shared/db.ts';
import { authorizeUrl } from '../_shared/google.ts';
import { packState } from '../_shared/oauth_state.ts';

export async function handler(req: Request): Promise<Response> {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== 'POST') return fail('method', 'POST seulement', 405);

  const db = serviceClient();
  const user = await userFromRequest(req, db);
  if (!user) return fail('unauthorized', 'جدّد الدخول للتطبيق.', 401);

  const { tool } = (await req.json().catch(() => ({}))) as { tool?: string };
  if (!tool) return fail('bad_request', 'حدّد التطبيق.', 400);

  const { data: row } = await db
    .from('tools')
    .select('key, kind, oauth_provider, oauth_scopes, is_enabled')
    .eq('key', tool)
    .maybeSingle();

  if (!row || !row.is_enabled || row.kind !== 'oauth') {
    return fail('bad_request', 'التطبيق هذا ما يتربطش بحساب.', 400);
  }
  if (row.oauth_provider !== 'google') {
    return fail('bad_request', `الربط مع ${row.oauth_provider} مازال ما تعملش.`, 400);
  }

  const scopes = (row.oauth_scopes as string[]) ?? [];
  if (!scopes.length) return fail('server', 'التطبيق بلا scopes.', 500);

  return json({ url: authorizeUrl(scopes, await packState(user.id, tool)) });
}
