/**
 * local-db.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SQLite wrapper for offline crawling.
 * Zero network calls — all data lands in a local .sqlite file.
 * Run push-to-cloud.ts afterwards to upload to Neon in one session.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PageData } from './crawler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = path.resolve(__dirname, '../../crawl-cache.sqlite');

let _db: Database.Database | null = null;

export function getLocalDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');   // faster concurrent writes
  _db.pragma('synchronous = NORMAL'); // safe + fast
  _db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      url           TEXT PRIMARY KEY,
      title         TEXT NOT NULL DEFAULT '',
      content       TEXT NOT NULL DEFAULT '',
      code_snippets TEXT NOT NULL DEFAULT '',
      description   TEXT NOT NULL DEFAULT '',
      source        TEXT NOT NULL DEFAULT '',
      tags          TEXT NOT NULL DEFAULT '',
      content_hash  TEXT NOT NULL DEFAULT '',
      last_crawled  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_source ON pages(source);
    CREATE INDEX IF NOT EXISTS idx_hash   ON pages(content_hash);
  `);
  return _db;
}

/** Upsert a single page into the local SQLite DB */
export function savePageLocally(page: PageData): void {
  const db = getLocalDb();
  db.prepare(`
    INSERT INTO pages (url, title, content, code_snippets, description, source, tags, content_hash, last_crawled)
    VALUES (@url, @title, @content, @codeSnippets, @description, @source, @tags, @contentHash, @lastCrawled)
    ON CONFLICT(url) DO UPDATE SET
      title         = excluded.title,
      content       = excluded.content,
      code_snippets = excluded.code_snippets,
      description   = excluded.description,
      source        = excluded.source,
      tags          = excluded.tags,
      content_hash  = excluded.content_hash,
      last_crawled  = excluded.last_crawled
  `).run(page);
}

/** Pre-warm URL + hash dedup sets from local SQLite (no Neon calls) */
export function prewarmFromLocal(urlSet: Set<string>, hashSet: Set<string>): void {
  const db = getLocalDb();
  const rows = db.prepare('SELECT url, content_hash FROM pages').all() as { url: string; content_hash: string }[];
  for (const r of rows) {
    urlSet.add(r.url);
    if (r.content_hash) hashSet.add(r.content_hash);
  }
  console.log(`📦 Local SQLite pre-warm: ${urlSet.size} URLs, ${hashSet.size} hashes`);
}

/** Count total pages in local DB */
export function localPageCount(): number {
  const db = getLocalDb();
  const row = db.prepare('SELECT COUNT(*) as n FROM pages').get() as { n: number };
  return row.n;
}

/** Read pages in batches for pushing to cloud */
export function* readPagesBatched(batchSize = 500): Generator<PageData[]> {
  const db = getLocalDb();
  const total = localPageCount();
  let offset = 0;
  while (offset < total) {
    const rows = db.prepare(
      `SELECT url, title, content, code_snippets as codeSnippets, description,
              source, tags, content_hash as contentHash, last_crawled as lastCrawled
       FROM pages LIMIT ? OFFSET ?`
    ).all(batchSize, offset) as PageData[];
    if (rows.length === 0) break;
    yield rows;
    offset += rows.length;
  }
}

export function closeLocalDb(): void {
  _db?.close();
  _db = null;
}
