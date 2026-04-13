import got from 'got';
import * as cheerio from 'cheerio';
import { PageData, savePage } from '../lib/storage';
import { syncIndex } from '../lib/search-index';

export interface CrawlerOptions {
  maxPages: number;
  maxDepth: number;
}

export async function crawl(seedUrl: string, options: CrawlerOptions) {
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: seedUrl, depth: 0 }];
  let pagesProcessed = 0;

  const baseUrl = new URL(seedUrl).origin;

  while (queue.length > 0 && pagesProcessed < options.maxPages) {
    const { url, depth } = queue.shift()!;

    if (visited.has(url) || depth > options.maxDepth) continue;
    visited.add(url);

    try {
      console.log(`Crawling: ${url} (Depth: ${depth})`);
      const response = await got(url, {
        timeout: { request: 5000 },
        headers: { 'user-agent': 'MySearchEngineBot/1.0' }
      });

      const html = response.body;
      const $ = cheerio.load(html);

      // Extract details
      const title = $('title').text().trim() || 'No Title';
      const description = $('meta[name="description"]').attr('content')?.trim() || '';
      const content = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 5000); // Sample content

      const pageData: PageData = {
        url,
        title,
        description,
        content,
        lastCrawled: new Date().toISOString()
      };

      await savePage(pageData);
      pagesProcessed++;

      // Find links
      if (depth < options.maxDepth) {
        $('a[href]').each((_, el) => {
          let href = $(el).attr('href');
          if (!href) return;

          try {
            const absoluteUrl = new URL(href, url).href;
            if (absoluteUrl.startsWith(baseUrl) && !visited.has(absoluteUrl)) {
              queue.push({ url: absoluteUrl, depth: depth + 1 });
            }
          } catch {
            // Invalid URL
          }
        });
      }
    } catch (error) {
      console.error(`Failed to crawl ${url}:`, (error as Error).message);
    }
  }

  // After crawling, sync the index
  await syncIndex();
  console.log(`Crawling complete. Processed ${pagesProcessed} pages.`);
}
