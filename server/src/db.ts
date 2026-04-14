import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set.');
}

export const sql = neon(process.env.DATABASE_URL);

/**
 * Initialize the database schema for the search engine.
 */
export async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS pages (
      id SERIAL PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      title TEXT,
      content TEXT,
      code_snippets TEXT,
      description TEXT,
      last_crawled TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  console.log('Database schema initialized.');
}
