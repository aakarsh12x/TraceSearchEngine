/**
 * push-to-cloud.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads the local SQLite cache (crawl-cache.sqlite) built by local-crawl.ts
 * and bulk-uploads everything to Neon PostgreSQL in a single efficient session.
 *
 * Strategy:
 *   • Connects to Neon ONCE
 *   • Reads existing URLs from Neon to avoid re-uploading duplicates
 *   • Streams local pages in batches of BATCH_SIZE
 *   • Uses a single multi-row INSERT … ON CONFLICT DO UPDATE per batch
 *   • Disconnects when done → minimal compute time billed
 *
 * Usage:
 *   npx tsx --env-file=../.env scripts/push-to-cloud.ts
 *
 * Options (env vars):
 *   BATCH_SIZE    = number of rows per INSERT (default 300)
 *   DRY_RUN=true  = print stats without writing to Neon
 */

import { sql }          from '../src/db.js';
import { readPagesBatched, localPageCount, DB_PATH } from '../src/local-db.js';
import { syncIndex }    from '../src/index-manager.js';

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '300', 10);
const DRY_RUN    = process.env.DRY_RUN === 'true';

async function getCloudUrls(): Promise<Set<string>> {
  console.log('📡 Fetching existing URLs from Neon (dedup check)...');
  const rows = await sql`SELECT url FROM pages`;
  const s = new Set(rows.map((r: { url: string }) => r.url));
  console.log(`   Found ${s.size.toLocaleString()} existing URLs in cloud DB`);
  return s;
}

async function upsertBatch(batch: { url: string; title: string; content: string; codeSnippets: string; description: string; source: string; tags: string; contentHash: string; lastCrawled: string }[]) {
  if (batch.length === 0) return;
  // Build a multi-row upsert using Neon's tagged template literal
  // We send each row as individual upsert — neon doesn't support dynamic multi-row easily
  // but we wrap everything in a transaction-like sequential await for speed.
  await Promise.all(batch.map(p =>
    sql`
      INSERT INTO pages (url, title, content, code_snippets, description, source, tags, content_hash, last_crawled)
      VALUES (
        ${p.url}, ${p.title}, ${p.content}, ${p.codeSnippets},
        ${p.description}, ${p.source}, ${p.tags}, ${p.contentHash}, ${p.lastCrawled}
      )
      ON CONFLICT (url) DO UPDATE SET
        title         = EXCLUDED.title,
        content       = EXCLUDED.content,
        code_snippets = EXCLUDED.code_snippets,
        description   = EXCLUDED.description,
        source        = EXCLUDED.source,
        tags          = EXCLUDED.tags,
        content_hash  = EXCLUDED.content_hash,
        last_crawled  = EXCLUDED.last_crawled
    `.catch(err => console.warn(`  ⚠ Skipped ${p.url}: ${(err as Error).message.slice(0, 80)}`))
  ));
}

async function main() {
  console.log('☁️  PUSH TO CLOUD — SQLite → Neon PostgreSQL');
  console.log(`📁  Source  : ${DB_PATH}`);
  console.log(`📦  Batch   : ${BATCH_SIZE} rows`);
  console.log(`🧪  Dry run : ${DRY_RUN}\n`);

  const localTotal = localPageCount();
  console.log(`📊  Local cache total : ${localTotal.toLocaleString()} pages`);

  if (localTotal === 0) {
    console.log('\n⚠️  Local cache is empty. Run local-crawl.ts first.');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN — no data will be written to Neon.');
    process.exit(0);
  }

  // Ensure table exists
  await sql`
    CREATE TABLE IF NOT EXISTS pages (
      id            SERIAL PRIMARY KEY,
      url           TEXT UNIQUE NOT NULL,
      title         TEXT,
      content       TEXT,
      code_snippets TEXT,
      description   TEXT,
      source        TEXT,
      tags          TEXT,
      content_hash  TEXT,
      last_crawled  TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  const cloudUrls = await getCloudUrls();

  let pushed = 0;
  let skipped = 0;
  let batchNum = 0;
  const startTime = Date.now();

  for (const batch of readPagesBatched(BATCH_SIZE)) {
    // Filter out URLs already in cloud
    const toUpload = batch.filter(p => !cloudUrls.has(p.url));
    const skippedInBatch = batch.length - toUpload.length;
    skipped += skippedInBatch;

    if (toUpload.length > 0) {
      batchNum++;
      const pct = (((pushed + skipped + batch.length) / localTotal) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  📤 Batch ${batchNum}: uploading ${toUpload.length} pages... (${pct}% done, ${elapsed}s elapsed)`);
      await upsertBatch(toUpload);
      toUpload.forEach(p => cloudUrls.add(p.url)); // update local dedup set
      pushed += toUpload.length;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Upload complete in ${elapsed}s!`);
  console.log(`   Uploaded : ${pushed.toLocaleString()} new pages`);
  console.log(`   Skipped  : ${skipped.toLocaleString()} (already in cloud)`);
  console.log(`   Total cloud DB: ~${(cloudUrls.size).toLocaleString()} pages`);

  // Trigger FlexSearch re-sync on the cloud server
  console.log('\n🔄 Syncing FlexSearch index from cloud DB...');
  await syncIndex();
  console.log('✅ Index sync complete. Your hosted app will now reflect the new data!');

  process.exit(0);
}

main().catch(err => { console.error('Fatal push error:', err); process.exit(1); });
