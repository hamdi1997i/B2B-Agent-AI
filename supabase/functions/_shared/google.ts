/**
 * Les apps Google de l'assistant: Agenda, Drive, Gmail.
 *
 * Chaque utilisateur connecte son propre compte; les jetons vivent dans
 * `oauth_connections`, une table que ni lui ni l'admin ne peuvent lire —
 * seul le service_role y accède, depuis ces fonctions.
 *
 * Rien n'est envoyé au monde extérieur sans l'utilisateur: Gmail sait lire
 * et préparer un brouillon, jamais envoyer.
 */

import { env, requireEnv } from './env.ts';
import type { Db } from './db.ts';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1';

export function redirectUri(): string {
  return env('GOOGLE_REDIRECT_URI') || `${env('SUPABASE_URL')}/functions/v1/oauth-callback`;
}

/** Page de consentement Google. `include_granted_scopes` cumule les accès déjà donnés. */
export function authorizeUrl(scopes: string[], state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function token(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      ...body,
    }).toString(),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(`Google a refusé: ${data.error_description ?? data.error ?? res.status}`);
  }
  return data;
}

/** Fin du parcours de consentement: on échange le code et on garde les jetons. */
export async function connect(db: Db, userId: string, code: string): Promise<void> {
  const data = await token({ code, redirect_uri: redirectUri(), grant_type: 'authorization_code' });

  const { data: existing } = await db
    .from('oauth_connections')
    .select('refresh_token, scopes')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .maybeSingle();

  // Google ne renvoie le refresh_token qu'à la première autorisation.
  const refresh = data.refresh_token ?? existing?.refresh_token ?? null;
  const scopes = [...new Set([...(existing?.scopes ?? []), ...(data.scope?.split(' ') ?? [])])];

  await db.from('oauth_connections').upsert(
    {
      user_id: userId,
      provider: 'google',
      access_token: data.access_token,
      refresh_token: refresh,
      expires_at: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
      scopes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' },
  );
}

/** Jeton valable, renouvelé si besoin. */
async function accessToken(db: Db, userId: string): Promise<string | null> {
  const { data: row } = await db
    .from('oauth_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .maybeSingle();

  if (!row) return null;

  const stillValid = row.expires_at && new Date(row.expires_at).getTime() - 60_000 > Date.now();
  if (stillValid) return row.access_token as string;
  if (!row.refresh_token) return row.access_token as string;

  const data = await token({ refresh_token: row.refresh_token as string, grant_type: 'refresh_token' });
  await db
    .from('oauth_connections')
    .update({
      access_token: data.access_token,
      expires_at: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', 'google');

  return data.access_token;
}

interface CallResult {
  ok: boolean;
  status: number;
  data: unknown;
}

/** Message d'erreur rendu au modèle: on distingue « pas relié » du reste. */
function failure(res: CallResult, fallback: string): { error: string } {
  const detail = (res.data as { error?: unknown })?.error;
  if (res.status === 401) {
    return { error: typeof detail === 'string' ? detail : 'الحساب ماهوش مربوط، لازم يعاود يربطو.' };
  }
  return { error: fallback };
}

async function call(
  db: Db,
  userId: string,
  url: string,
  init: RequestInit = {},
): Promise<CallResult> {
  const access = await accessToken(db, userId);
  if (!access) return { ok: false, status: 401, data: { error: 'الحساب ماهوش مربوط.' } };

  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  return { ok: res.ok, status: res.status, data };
}

// ═════════════════════════════════════════════════════════════ Agenda ════

export async function runCalendar(db: Db, userId: string, input: Record<string, unknown>): Promise<unknown> {
  const action = String(input.action ?? 'lister');

  if (action === 'ajouter') {
    const debut = String(input.debut ?? '');
    if (!debut) return { error: 'الوقت ناقص.' };
    const fin = String(input.fin ?? '') || new Date(new Date(debut).getTime() + 3600_000).toISOString();
    const res = await call(db, userId, `${CALENDAR}/calendars/primary/events`, {
      method: 'POST',
      body: JSON.stringify({
        summary: String(input.titre ?? 'موعد'),
        start: { dateTime: new Date(debut).toISOString(), timeZone: 'Africa/Tunis' },
        end: { dateTime: new Date(fin).toISOString(), timeZone: 'Africa/Tunis' },
      }),
    });
    if (!res.ok) return failure(res, 'ما نجّمناش نزيدو الموعد في Google Agenda.');
    const event = res.data as { id?: string; htmlLink?: string };
    return { ajoute: { id: event.id, lien: event.htmlLink } };
  }

  const timeMin = new Date(String(input.debut ?? new Date().toISOString())).toISOString();
  const timeMax = new Date(
    String(input.fin ?? new Date(Date.now() + 7 * 86400_000).toISOString()),
  ).toISOString();

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '20',
  });
  const res = await call(db, userId, `${CALENDAR}/calendars/primary/events?${params}`);
  if (!res.ok) return failure(res, 'ما نجّمناش نقراو Google Agenda.');

  const items = ((res.data as { items?: unknown[] }).items ?? []) as Array<Record<string, never>>;
  return {
    evenements: items.map((e: Record<string, unknown>) => ({
      titre: e.summary ?? '',
      debut: (e.start as Record<string, string>)?.dateTime ?? (e.start as Record<string, string>)?.date,
      fin: (e.end as Record<string, string>)?.dateTime ?? (e.end as Record<string, string>)?.date,
      lieu: e.location ?? '',
    })),
  };
}

// ══════════════════════════════════════════════════════════════ Drive ════

export async function runDrive(db: Db, userId: string, input: Record<string, unknown>): Promise<unknown> {
  const action = String(input.action ?? 'chercher');

  if (action === 'lire') {
    const id = String(input.file_id ?? '');
    if (!id) return { error: 'حدّد الملف.' };
    // Les documents Google s'exportent en texte; les autres se lisent tels quels.
    const res = await call(db, userId, `${DRIVE}/files/${id}/export?mimeType=text/plain`);
    if (!res.ok) return failure(res, 'ما نجّمناش نقراو الملف.');
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return { contenu: text.slice(0, 4000) };
  }

  const query = String(input.requete ?? '').replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: query ? `name contains '${query}' and trashed = false` : 'trashed = false',
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
    pageSize: '10',
    orderBy: 'modifiedTime desc',
  });
  const res = await call(db, userId, `${DRIVE}/files?${params}`);
  if (!res.ok) return failure(res, 'ما نجّمناش نلوّجو في Drive.');
  return { fichiers: (res.data as { files?: unknown[] }).files ?? [] };
}

// ══════════════════════════════════════════════════════════════ Gmail ════

export async function runGmail(db: Db, userId: string, input: Record<string, unknown>): Promise<unknown> {
  const action = String(input.action ?? 'lister');

  if (action === 'brouillon') {
    const to = String(input.a ?? '');
    if (!to) return { error: 'ما نعرفش لشكون نكتب.' };
    const mime = [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(String(input.objet ?? ''))))}?=`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      String(input.corps ?? ''),
    ].join('\r\n');
    const raw = btoa(unescape(encodeURIComponent(mime)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await call(db, userId, `${GMAIL}/users/me/drafts`, {
      method: 'POST',
      body: JSON.stringify({ message: { raw } }),
    });
    if (!res.ok) return failure(res, 'ما نجّمناش نحضّرو البروجي.');
    // Volontairement: on crée un brouillon, on n'envoie jamais.
    return {
      brouillon_pret: { id: (res.data as { id?: string }).id, a: to },
      rappel: "Le brouillon attend dans Gmail: c'est l'utilisateur qui envoie.",
    };
  }

  if (action === 'lire') {
    const id = String(input.message_id ?? '');
    if (!id) return { error: 'حدّد الرسالة.' };
    const res = await call(db, userId, `${GMAIL}/users/me/messages/${id}?format=full`);
    if (!res.ok) return failure(res, 'ما نجّمناش نقراو الرسالة.');
    const message = res.data as { snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } };
    const header = (name: string) =>
      message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
    return {
      de: header('from'),
      objet: header('subject'),
      date: header('date'),
      apercu: message.snippet ?? '',
    };
  }

  const params = new URLSearchParams({ maxResults: '10' });
  const query = String(input.requete ?? '');
  if (query) params.set('q', query);

  const list = await call(db, userId, `${GMAIL}/users/me/messages?${params}`);
  if (!list.ok) return failure(list, 'ما نجّمناش نقراو Gmail.');

  const ids = ((list.data as { messages?: Array<{ id: string }> }).messages ?? []).slice(0, 6);
  const messages = [];
  for (const { id } of ids) {
    const res = await call(
      db,
      userId,
      `${GMAIL}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
    );
    if (!res.ok) continue;
    const message = res.data as { snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } };
    const header = (name: string) =>
      message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
    messages.push({ id, de: header('from'), objet: header('subject'), apercu: message.snippet ?? '' });
  }
  return { messages };
}
