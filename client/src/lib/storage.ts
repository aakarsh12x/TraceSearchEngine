import { sql } from './db';

export interface PageData {
  url: string;
  title: string;
  content: string;
  description: string;
  lastCrawled: string;
}

/**
 * Fetches all pages from the Neon database.
 */
export async function getAllPages(): Promise<PageData[]> {
  try {
    const rows = await sql`SELECT * FROM pages`;
    return rows.map((r: any) => ({
      url: r.url,
      title: r.title,
      content: r.content,
      description: r.description,
      lastCrawled: r.last_crawled.toISOString()
    }));
  } catch (err) {
    console.error('Failed to get pages from DB:', err);
    return [];
  }
}

/**
 * Saves or updates a page in the Neon database.
 */
export async function savePage(page: PageData) {
  try {
    await sql`
      INSERT INTO pages (url, title, content, description, last_crawled)
      VALUES (${page.url}, ${page.title}, ${page.content}, ${page.description}, ${page.lastCrawled})
      ON CONFLICT (url) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        description = EXCLUDED.description,
        last_crawled = EXCLUDED.last_crawled
    `;
  } catch (err) {
    console.error(`Failed to save page ${page.url} to DB:`, err);
  }
}

/**
 * Clears all pages from the Neon database.
 */
export async function clearStorage() {
  try {
    await sql`DELETE FROM pages`;
  } catch (err) {
    console.error('Failed to clear pages from DB:', err);
  }
}
