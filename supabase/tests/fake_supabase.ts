/**
 * Un mini-client compatible `@supabase/supabase-js`, branché sur une vraie
 * base PostgreSQL locale.
 *
 * Il ne réimplémente que ce que les Edge Functions utilisent, mais il exécute
 * du vrai SQL: les tests couvrent donc aussi les contraintes, les triggers et
 * les fonctions RPC, pas seulement le code TypeScript.
 */

import pg from 'pg';

type Row = Record<string, unknown>;
type Result<T> = { data: T; error: { message: string } | null };

interface Filter {
  column: string;
  op: 'eq' | 'ilike';
  value: unknown;
}

class Query implements PromiseLike<Result<Row[] | Row | null>> {
  private filters: Filter[] = [];
  private columns = '*';
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitTo: number | null = null;
  private one: 'one' | 'maybe' | null = null;

  private pool: pg.Pool;
  private table: string;
  private mode: 'select' | 'insert' | 'update' | 'delete';
  private payload: Row | null;

  constructor(
    pool: pg.Pool,
    table: string,
    mode: 'select' | 'insert' | 'update' | 'delete',
    payload: Row | null = null,
  ) {
    this.pool = pool;
    this.table = table;
    this.mode = mode;
    this.payload = payload;
  }

  select(columns = '*'): this {
    this.columns = columns.replace(/\s+/g, ' ');
    if (this.mode !== 'select') this.columns = columns;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'eq', value });
    return this;
  }
  ilike(column: string, value: unknown): this {
    this.filters.push({ column, op: 'ilike', value });
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n: number): this {
    this.limitTo = n;
    return this;
  }
  maybeSingle(): this {
    this.one = 'maybe';
    return this;
  }
  single(): this {
    this.one = 'one';
    return this;
  }
  // deno-lint-ignore no-explicit-any
  then<R1 = any, R2 = never>(
    onfulfilled?: ((value: Result<any>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private where(params: unknown[]): string {
    if (!this.filters.length) return '';
    const parts = this.filters.map((f) => {
      params.push(f.value);
      return `${quote(f.column)} ${f.op === 'eq' ? '=' : 'ilike'} $${params.length}`;
    });
    return ` where ${parts.join(' and ')}`;
  }

  private async run(): Promise<Result<Row[] | Row | null>> {
    const params: unknown[] = [];
    let sql: string;

    if (this.mode === 'select') {
      sql = `select ${cols(this.columns)} from ${quote(this.table)}${this.where(params)}`;
      if (this.orderBy) {
        sql += ` order by ${quote(this.orderBy.column)} ${this.orderBy.ascending ? 'asc' : 'desc'}`;
      }
      if (this.limitTo != null) sql += ` limit ${this.limitTo}`;
    } else if (this.mode === 'insert') {
      const entries = Object.entries(this.payload ?? {});
      const names = entries.map(([k]) => quote(k)).join(', ');
      const values = entries
        .map(([, v]) => {
          params.push(serialize(v));
          return `$${params.length}`;
        })
        .join(', ');
      sql = `insert into ${quote(this.table)} (${names}) values (${values}) returning ${cols(this.columns)}`;
    } else if (this.mode === 'update') {
      const sets = Object.entries(this.payload ?? {}).map(([k, v]) => {
        params.push(serialize(v));
        return `${quote(k)} = $${params.length}`;
      });
      sql = `update ${quote(this.table)} set ${sets.join(', ')}${this.where(params)} returning ${cols(this.columns)}`;
    } else {
      sql = `delete from ${quote(this.table)}${this.where(params)}`;
    }

    try {
      const res = await this.pool.query(sql, params);
      const rows = res.rows as Row[];
      if (this.one) {
        if (this.one === 'one' && rows.length !== 1) {
          return { data: null, error: { message: `attendu 1 ligne, reçu ${rows.length}` } };
        }
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }
}

function quote(id: string): string {
  return `"${id.replace(/"/g, '')}"`;
}
function cols(list: string): string {
  if (list === '*') return '*';
  return list
    .split(',')
    .map((c) => quote(c.trim()))
    .join(', ');
}
function serialize(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v);
  if (Array.isArray(v) && v.length && typeof v[0] === 'object') return JSON.stringify(v);
  return v;
}

export function fakeSupabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString });

  return {
    pool,
    from(table: string) {
      return {
        select: (columns?: string) => new Query(pool, table, 'select').select(columns ?? '*'),
        insert: (payload: Row) => new Query(pool, table, 'insert', payload),
        update: (payload: Row) => new Query(pool, table, 'update', payload),
        delete: () => new Query(pool, table, 'delete'),
      };
    },
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const names = Object.keys(args);
      const params = names.map((n) => args[n]);
      const call = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
      try {
        const res = await pool.query(`select ${quote(fn)}(${call}) as result`, params);
        return { data: res.rows[0]?.result ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
    auth: {
      async getUser(token: string) {
        const res = await pool.query('select id, email from auth.users where id = $1', [token]);
        if (!res.rows.length) return { data: { user: null }, error: { message: 'jeton invalide' } };
        return { data: { user: res.rows[0] }, error: null };
      },
    },
  };
}
