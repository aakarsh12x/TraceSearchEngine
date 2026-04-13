import { sql } from '../src/db.js';

/**
 * Adds source, tags, and content_hash columns to the pages table.
 * Safe to run multiple times (uses IF NOT EXISTS / does nothing on existing).
 */
async function migrate() {
  try {
    console.log('Running schema migration...');
    
    await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS source TEXT;`;
    await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS tags TEXT;`;
    await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS content_hash TEXT;`;
    
    // Add index on content_hash and source for fast dedup lookups
    await sql`CREATE INDEX IF NOT EXISTS idx_pages_content_hash ON pages(content_hash);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pages_source ON pages(source);`;
    
    console.log('Migration successful.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

migrate();
