import { Pool } from 'pg';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export type Stored<T> = T & { id: string };

const DATABASE_URL = process.env.DATABASE_URL || '';
const sslRequired =
  process.env.PGSSLMODE === 'require' ||
  /render\.com/i.test(DATABASE_URL) ||
  /sslmode=require/i.test(DATABASE_URL);

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslRequired ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PGPOOL_MAX || 8),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
const SIGNING_SECRET =
  process.env.STORAGE_SIGNING_SECRET ||
  process.env.ADMIN_TOKEN ||
  'dev-change-me';
const MAX_BLOB_BYTES = Number(process.env.MAX_BLOB_BYTES || 350 * 1024 * 1024);

let ready = false;

export async function initPlatform() {
  if (ready) return;
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_records (
      table_name TEXT NOT NULL,
      id TEXT NOT NULL,
      record JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (table_name, id)
    );
    CREATE INDEX IF NOT EXISTS app_records_table_idx ON app_records(table_name);
    CREATE INDEX IF NOT EXISTS app_records_record_gin ON app_records USING gin(record);

    CREATE TABLE IF NOT EXISTS app_blobs (
      path TEXT PRIMARY KEY,
      content BYTEA NOT NULL,
      content_type TEXT NOT NULL,
      bytes BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  ready = true;
}

export const db = {
  async list<T>(table: string, options: { filter?: Record<string, unknown>; limit?: number } = {}) {
    await initPlatform();
    const params: unknown[] = [table];
    let where = 'table_name=$1';
    if (options.filter && Object.keys(options.filter).length) {
      params.push(JSON.stringify(options.filter));
      where += ` AND record @> $${params.length}::jsonb`;
    }
    params.push(Math.max(1, Math.min(options.limit || 100, 5000)));
    const result = await pool.query(
      `SELECT id, record FROM app_records WHERE ${where} ORDER BY created_at ASC LIMIT $${params.length}`,
      params,
    );
    return { items: result.rows.map(row => ({ ...row.record, id: row.id })) as Stored<T>[] };
  },

  async add<T extends Record<string, unknown>>(table: string, records: T[]) {
    await initPlatform();
    const ids: string[] = [];
    for (const record of records) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO app_records(table_name,id,record) VALUES($1,$2,$3::jsonb)`,
        [table, id, JSON.stringify(record)],
      );
      ids.push(id);
    }
    return ids;
  },

  async update<T extends Record<string, unknown>>(table: string, updates: Array<{id:string; record:T}>) {
    await initPlatform();
    const result: boolean[] = [];
    for (const update of updates) {
      const changed = await pool.query(
        `UPDATE app_records SET record=$3::jsonb,updated_at=now() WHERE table_name=$1 AND id=$2`,
        [table, update.id, JSON.stringify(update.record)],
      );
      result.push(changed.rowCount === 1);
    }
    return result;
  },

  async delete(table: string, ids: string[]) {
    await initPlatform();
    if (!ids.length) return [];
    const deleted = await pool.query(
      `DELETE FROM app_records WHERE table_name=$1 AND id=ANY($2::text[]) RETURNING id`,
      [table, ids],
    );
    const set = new Set(deleted.rows.map(row => row.id));
    return ids.map(id => set.has(id));
  }
};

function signature(path: string, expires: number) {
  return createHmac('sha256', SIGNING_SECRET)
    .update(`${path}|${expires}`)
    .digest('base64url');
}

export const storage = {
  async write(entries: Array<{path:string; content:Buffer; contentType:string}>) {
    await initPlatform();
    for (const entry of entries) {
      if (entry.content.length > MAX_BLOB_BYTES) {
        throw new Error(`${entry.path} exceeds MAX_BLOB_BYTES (${entry.content.length})`);
      }
      await pool.query(
        `INSERT INTO app_blobs(path,content,content_type,bytes,updated_at)
         VALUES($1,$2,$3,$4,now())
         ON CONFLICT(path) DO UPDATE SET
         content=EXCLUDED.content,content_type=EXCLUDED.content_type,bytes=EXCLUDED.bytes,updated_at=now()`,
        [entry.path, entry.content, entry.contentType, entry.content.length],
      );
    }
  },

  async exists(path: string) {
    await initPlatform();
    const result = await pool.query('SELECT 1 FROM app_blobs WHERE path=$1', [path]);
    return result.rowCount === 1;
  },

  async info(path: string) {
    await initPlatform();
    const result = await pool.query(
      'SELECT bytes,content_type FROM app_blobs WHERE path=$1',
      [path],
    );
    return result.rows[0] as {bytes:number; content_type:string} | undefined;
  },

  async url(path: string, ttlSeconds = 6*3600) {
    const expires = Math.floor(Date.now()/1000) + ttlSeconds;
    return `${PUBLIC_ORIGIN}/_storage?path=${encodeURIComponent(path)}&expires=${expires}&sig=${signature(path,expires)}`;
  },

  async delete(paths: string[]) {
    if (!paths.length) return;
    await pool.query('DELETE FROM app_blobs WHERE path=ANY($1::text[])', [paths]);
  }
};

export async function serveBlob(req: Request, res: Response) {
  await initPlatform();
  const path = String(req.query.path || '');
  const expires = Number(req.query.expires || 0);
  const sig = String(req.query.sig || '');
  if (!path || !expires || !sig || expires < Math.floor(Date.now()/1000)) {
    return res.status(403).end();
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(signature(path,expires));
  if (a.length !== b.length || !timingSafeEqual(a,b)) return res.status(403).end();

  const result = await pool.query(
    'SELECT content,content_type,bytes FROM app_blobs WHERE path=$1',
    [path],
  );
  const row = result.rows[0] as {content:Buffer; content_type:string; bytes:number} | undefined;
  if (!row) return res.status(404).end();

  let start = 0;
  let end = Number(row.bytes)-1;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) return res.status(416).end();
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), end) : end;
    if (start > end || start >= Number(row.bytes)) return res.status(416).end();
    const chunk = row.content.subarray(start, end+1);
    res.status(206);
    res.setHeader('content-range', `bytes ${start}-${end}/${row.bytes}`);
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('content-length', String(chunk.length));
    res.setHeader('content-type', row.content_type);
    return res.send(chunk);
  }

  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('content-length', String(row.bytes));
  res.setHeader('content-type', row.content_type);
  return res.send(row.content);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = process.env.ADMIN_TOKEN || '';
  const auth = req.headers.authorization || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (
    !token ||
    provided.length !== token.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(token))
  ) {
    return res.status(401).json({error:'Unauthorized'});
  }
  next();
}

export async function withLock<T>(name: string, work:()=>Promise<T>) {
  await initPlatform();
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS ok',
      [name],
    );
    if (!result.rows[0]?.ok) return undefined;
    try { return await work(); }
    finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [name]);
    }
  } finally {
    client.release();
  }
}
