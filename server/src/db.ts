import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import path from 'path';

// Load .env from the root directory
config({ path: path.resolve(process.cwd(), '../.env') });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in .env');
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
