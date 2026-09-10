/**
 * Retour de Google après le consentement.
 *
 * Cette route est appelée par le navigateur, sans jeton Supabase: c'est la
 * signature du `state` qui dit à quel compte rattacher les jetons. On
 * termine en renvoyant l'utilisateur dans l'app.
 */

import { fail } from '../_shared/http.ts';
import { serviceClient } from '../_shared/db.ts';
import { connect } from '../_shared/google.ts';
import { readState } from '../_shared/oauth_state.ts';
import { env } from '../_shared/env.ts';

function backToApp(status: string, tool = ''): Response {
  const base = env('APP_OAUTH_RETURN_URL', 'maawen://oauth');
  return new Response(null, {
    status: 302,
    headers: { Location: `${base}/${status}${tool ? `?tool=${encodeURIComponent(tool)}` : ''}` },
  });
}

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (error) return backToApp('fail');
  if (!code || !state) return fail('bad_request', 'réponse OAuth incomplète', 400);

  const payload = await readState(state);
  if (!payload) return fail('unauthorized', 'state invalide ou expiré', 401);

  const db = serviceClient();
  try {
    await connect(db, payload.user, code);
  } catch {
    return backToApp('fail', payload.tool);
  }

  // Connecter le compte vaut accord pour cette app.
  await db.from('user_tools').upsert(
    {
      user_id: payload.user,
      tool_key: payload.tool,
      status: 'granted',
      granted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,tool_key' },
  );

  return backToApp('success', payload.tool);
}
