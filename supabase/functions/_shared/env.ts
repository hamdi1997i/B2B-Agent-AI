/** Lecture des secrets: Deno en production, Node pour les tests. */
export function env(key: string, fallback = ''): string {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  const value = deno ? deno.env.get(key) : (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[key];
  return value ?? fallback;
}

export function requireEnv(key: string): string {
  const value = env(key);
  if (!value) throw new Error(`secret manquant: ${key}`);
  return value;
}
