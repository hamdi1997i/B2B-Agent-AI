/**
 * Tests des apps Google: le parcours de connexion (et ce qu'il refuse),
 * le renouvellement du jeton, et les trois apps — dont Gmail, qui doit
 * savoir préparer un brouillon sans jamais envoyer.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fakeSupabase } from './fake_supabase.ts';
import { setServiceClient } from '../functions/_shared/db.ts';
import { handler as oauthStart } from '../functions/oauth-start/handler.ts';
import { handler as oauthCallback } from '../functions/oauth-callback/handler.ts';
import { runServerTool, loadCatalogue, isUsable } from '../functions/_shared/tools.ts';
import { packState, readState } from '../functions/_shared/oauth_state.ts';

const URL_DB = process.env.PG_TEST_URL ?? 'postgres://postgres@/maawen?host=/tmp&port=5433';
const SAMI = '11111111-1111-1111-1111-111111111111';

let db: ReturnType<typeof fakeSupabase>;
let requests: Array<{ url: string; init?: RequestInit }>;
let responder: (url: string, init?: RequestInit) => { status?: number; body: unknown };

const realFetch = globalThis.fetch;

before(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret';
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret';

  db = fakeSupabase(URL_DB);
  setServiceClient(db as never);

  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    requests.push({ url: href, init });
    const out = responder(href, init);
    return Promise.resolve(
      new Response(JSON.stringify(out.body), {
        status: out.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  await db.pool.end();
});

beforeEach(async () => {
  execFileSync('bash', ['supabase/tests/reset.sh'], { stdio: 'pipe' });
  await db.pool.query(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, 'sami@test.tn', '{"full_name":"سامي"}'::jsonb)`,
    [SAMI],
  );
  // Les apps Google sont livrées éteintes: l'admin les allume.
  await db.pool.query(`update public.tools set is_enabled = true where kind = 'oauth'`);
  await db.pool.query(`select public.grant_subscription($1, 'max', 'manual', 'test', 1)`, [SAMI]);
  requests = [];
  responder = () => ({ body: {} });
});

const post = (body: unknown, token = SAMI) =>
  new Request('http://localhost/oauth-start', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

async function rows(query: string, params: unknown[] = []) {
  return (await db.pool.query(query, params)).rows;
}

async function connectGoogle(tool = 'gmail') {
  responder = () => ({
    body: {
      access_token: 'ya29.first',
      refresh_token: '1//refresh',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/gmail.modify',
    },
  });
  const state = await packState(SAMI, tool);
  return oauthCallback(new Request(`http://localhost/oauth-callback?code=abc&state=${state}`));
}

describe('connexion du compte Google', () => {
  it('ne demande que les accès de l’app choisie', async () => {
    const body = await (await oauthStart(post({ tool: 'google_agenda' }))).json();
    const url = new URL(body.url);

    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events');
    assert.equal(url.searchParams.get('access_type'), 'offline', 'il faut un refresh_token');
    assert.ok(!url.searchParams.get('scope')?.includes('gmail'), 'aucun accès Gmail au passage');
  });

  it('refuse une app qui ne se connecte pas à un compte', async () => {
    assert.equal((await oauthStart(post({ tool: 'notes' }))).status, 400);
    assert.equal((await oauthStart(post({ tool: 'inconnue' }))).status, 400);
  });

  it('refuse une app que l’admin a éteinte', async () => {
    await db.pool.query(`update public.tools set is_enabled = false where key = 'gmail'`);
    assert.equal((await oauthStart(post({ tool: 'gmail' }))).status, 400);
  });

  it('range les jetons et vaut accord pour l’app', async () => {
    const res = await connectGoogle('gmail');

    assert.equal(res.status, 302);
    assert.match(res.headers.get('Location') ?? '', /^maawen:\/\/oauth\/success/);

    const [connection] = await rows('select * from public.oauth_connections where user_id = $1', [SAMI]);
    assert.equal(connection.access_token, 'ya29.first');
    assert.equal(connection.refresh_token, '1//refresh');
    assert.deepEqual(connection.scopes, ['https://www.googleapis.com/auth/gmail.modify']);

    const [consent] = await rows(`select status from public.user_tools where tool_key = 'gmail'`);
    assert.equal(consent.status, 'granted');
  });

  it('rejette un state trafiqué ou périmé', async () => {
    const forged = 'eyJ1c2VyIjoiYXV0cmUifQ.signature-bidon';
    const res = await oauthCallback(new Request(`http://localhost/oauth-callback?code=abc&state=${forged}`));
    assert.equal(res.status, 401, 'sans signature valable, pas de rattachement de compte');

    assert.equal(await readState('rien'), null);
    const good = await packState(SAMI, 'gmail');
    assert.deepEqual((await readState(good))?.user, SAMI);
    assert.equal(await readState(good.replace(/.$/, 'X')), null, 'signature altérée');
  });

  it('garde le refresh_token quand Google ne le renvoie pas', async () => {
    await connectGoogle('gmail');
    responder = () => ({
      body: { access_token: 'ya29.second', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' },
    });
    await oauthCallback(
      new Request(`http://localhost/oauth-callback?code=def&state=${await packState(SAMI, 'google_drive')}`),
    );

    const [connection] = await rows('select * from public.oauth_connections where user_id = $1', [SAMI]);
    assert.equal(connection.refresh_token, '1//refresh', 'le premier refresh_token est conservé');
    assert.equal(connection.scopes.length, 2, 'les accès se cumulent');
  });
});

describe('les apps Google', () => {
  it('reste inutilisable tant que le compte n’est pas relié', async () => {
    const before = await loadCatalogue(db as never, SAMI, 'max');
    assert.equal(isUsable(before.find((t) => t.key === 'gmail')!), false);

    await connectGoogle('gmail');

    const after = await loadCatalogue(db as never, SAMI, 'max');
    const gmail = after.find((t) => t.key === 'gmail')!;
    assert.equal(gmail.connected, true);
    assert.equal(isUsable(gmail), true);
  });

  it('lit l’agenda Google', async () => {
    await connectGoogle('google_agenda');
    responder = (url) =>
      url.includes('/calendar/v3')
        ? {
            body: {
              items: [
                { summary: 'طبيب', start: { dateTime: '2026-09-11T15:00:00+01:00' }, end: {}, location: 'أريانة' },
              ],
            },
          }
        : { body: {} };

    const out = (await runServerTool(db as never, SAMI, 'google_agenda', { action: 'lister' })) as {
      evenements: Array<{ titre: string }>;
    };
    assert.equal(out.evenements[0].titre, 'طبيب');
    assert.match(requests.at(-1)!.url, /singleEvents=true/);
  });

  it('prépare un brouillon Gmail et n’envoie jamais', async () => {
    await connectGoogle('gmail');
    responder = () => ({ body: { id: 'draft-1' } });

    const out = (await runServerTool(db as never, SAMI, 'gmail', {
      action: 'brouillon',
      a: 'ami@example.com',
      objet: 'سلام',
      corps: 'نتلاقاو غدوة.',
    })) as { brouillon_pret: { id: string } };

    assert.equal(out.brouillon_pret.id, 'draft-1');
    const call = requests.at(-1)!;
    assert.match(call.url, /\/users\/me\/drafts$/, 'on crée un brouillon');
    assert.ok(!call.url.includes('/send'), 'aucun appel à /send');
  });

  it('renouvelle le jeton expiré tout seul', async () => {
    await connectGoogle('google_drive');
    await db.pool.query(
      `update public.oauth_connections set expires_at = now() - interval '1 hour' where user_id = $1`,
      [SAMI],
    );

    requests = []; // on ne veut voir que les appels du renouvellement
    responder = (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return { body: { access_token: 'ya29.renouvele', expires_in: 3600 } };
      }
      return { body: { files: [{ id: 'f1', name: 'facture.pdf' }] } };
    };

    const out = (await runServerTool(db as never, SAMI, 'google_drive', {
      action: 'chercher',
      requete: 'facture',
    })) as { fichiers: unknown[] };

    assert.equal(out.fichiers.length, 1);
    const refresh = requests.find((r) => r.url.includes('oauth2.googleapis.com/token'));
    assert.ok(refresh, 'le jeton a été renouvelé');
    assert.match(String(refresh!.init?.body), /grant_type=refresh_token/);

    const driveCall = requests.at(-1)!;
    assert.equal(
      (driveCall.init?.headers as Record<string, string>).Authorization,
      'Bearer ya29.renouvele',
      'le nouvel accès est utilisé',
    );

    const [connection] = await rows('select access_token from public.oauth_connections where user_id = $1', [SAMI]);
    assert.equal(connection.access_token, 'ya29.renouvele', 'et il est rangé pour la prochaine fois');
  });

  it('répond proprement quand le compte n’est pas relié', async () => {
    const out = (await runServerTool(db as never, SAMI, 'gmail', { action: 'lister' })) as { error: string };
    assert.match(out.error, /ماهوش مربوط/);
  });
});
