/**
 * Le paramètre `state` d'OAuth, signé.
 *
 * Il transporte « qui » et « pour quelle app » entre le départ de la
 * connexion et le retour de Google. Comme il fait l'aller-retour par le
 * navigateur, on le signe (HMAC) au lieu de le stocker: sans signature,
 * n'importe qui pourrait rattacher son compte Google à un autre profil.
 */

import { requireEnv } from './env.ts';

const TTL_SECONDS = 600;

interface StatePayload {
  user: string;
  tool: string;
  exp: number;
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(requireEnv('SUPABASE_SERVICE_ROLE_KEY')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function sign(body: string): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await key(), new TextEncoder().encode(body));
  return b64url(new Uint8Array(mac));
}

export async function packState(user: string, tool: string): Promise<string> {
  const payload: StatePayload = { user, tool, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await sign(body)}`;
}

export async function readState(state: string): Promise<StatePayload | null> {
  const [body, signature] = state.split('.');
  if (!body || !signature) return null;
  if (signature !== (await sign(body))) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as StatePayload;
    if (!payload.user || !payload.tool) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
