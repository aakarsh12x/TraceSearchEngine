import { sql } from './db.js';

// Re-export the enriched PageData type from crawler
export type { PageData } from './crawler.js';

/**
 * Fetches all pages from the Neon database.
 */
export async function getAllPages() {
  try {
    const rows = await sql`SELECT * FROM pages`;
    return rows.map((r: any) => ({
      url: r.url,
      title: r.title,
      content: r.content,
      codeSnippets: r.code_snippets,
      description: r.description,
      source: r.source ?? '',
      tags: r.tags ?? '',
      contentHash: r.content_hash ?? '',
      lastCrawled: r.last_crawled?.toISOString?.() ?? ''
    }));
  } catch (err) {
    console.error('Failed to get pages from DB:', err);
    return [];
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
