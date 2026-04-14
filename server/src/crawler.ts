import puppeteer, { Browser, Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import * as crypto from 'crypto';
import { sql } from './db.js';
import { syncIndex, addDocumentToIndex } from './index-manager.js';

// ─── Type ────────────────────────────────────────────────────────────────────

export interface PageData {
  url: string;
  title: string;
  content: string;
  codeSnippets: string;
  description: string;
  source: string;
  tags: string;
  contentHash: string;
  lastCrawled: string;
}

// ─── Deduplication state (in-memory + DB-backed) ────────────────────────────

/** All URLs we have visited or queued this session */
const visitedUrls = new Set<string>();
/** All content hashes seen this session (avoids storing duplicate content) */
const seenHashes = new Set<string>();

/** Pre-warm both sets from the current database before starting */
export async function prewarmDedup() {
  console.log('Pre-warming dedup sets from DB...');
  const rows = await sql`SELECT url, content_hash FROM pages`;
  for (const r of rows) {
    visitedUrls.add(normalizeUrl(r.url));
    if (r.content_hash) seenHashes.add(r.content_hash);
  }
  console.log(`Pre-warmed: ${visitedUrls.size} URLs, ${seenHashes.size} hashes`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    // Strip common tracking/pagination params
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term',
     'ref','source','fbclid','gclid','_ga'].forEach(p => u.searchParams.delete(p));
    return u.href.replace(/\/$/, '');
  } catch {
    return raw;
  }
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** True if the URL is likely a listing / nav / auth / content-sparse page */
function shouldSkipUrl(normalised: string): boolean {
  const SKIP = [
    '/login', '/signup', '/register', '/account', '/cart', '/checkout',
    '/search?', '/tag/', '/tags/', '/category/', '/categories/',
    '/feed', '/rss', '/sitemap', '/robots.txt', '/ads/', '/cdn-cgi/',
    'stackoverflow.com/questions?sort=', 'stackoverflow.com/users',
    'stackoverflow.com/tags?', 'stackoverflow.com/review',
    '/page/', '/p/', '?page=', '&page=',
    'medium.com/tag/', 'medium.com/search',
    '/about', '/privacy', '/terms', '/legal', '/jobs', '/careers',
  ];
  return SKIP.some(s => normalised.includes(s));
}

// ─── Storage ──────────────────────────────────────────────────────────────────

async function savePage(page: PageData) {
  try {
    await sql`
      INSERT INTO pages (url, title, content, code_snippets, description, source, tags, content_hash, last_crawled)
      VALUES (
        ${page.url}, ${page.title}, ${page.content}, ${page.codeSnippets},
        ${page.description}, ${page.source}, ${page.tags}, ${page.contentHash},
        ${page.lastCrawled}
      )
      ON CONFLICT (url) DO UPDATE SET
        title        = EXCLUDED.title,
        content      = EXCLUDED.content,
        code_snippets = EXCLUDED.code_snippets,
        description  = EXCLUDED.description,
        source       = EXCLUDED.source,
        tags         = EXCLUDED.tags,
        content_hash = EXCLUDED.content_hash,
        last_crawled = EXCLUDED.last_crawled
    `;
  } catch (err) {
    console.error(`Failed to save ${page.url}:`, (err as Error).message);
  }
}

// ─── Crawler options ─────────────────────────────────────────────────────────

export interface CrawlerOptions {
  /** Hard cap on pages to crawl from this seed */
  maxPages: number;
  /** Maximum link-follow depth from seed */
  maxDepth: number;
  /** Max concurrent Puppeteer workers */
  maxConcurrency?: number;
  /** Max links to extract per page */
  maxLinksPerPage?: number;
  /** Stay within the seed domain only */
  sameDomainOnly?: boolean;
  /** Human-friendly label for this crawl batch (e.g. "stackoverflow") */
  source: string;
  /** Tag keywords to attach to every page from this seed */
  tags?: string[];
  /** Minimum / maximum delay between requests in ms [min, max] */
  delayRange?: [number, number];
}

// ─── Core crawl function ─────────────────────────────────────────────────────

export async function crawl(seedUrl: string, options: CrawlerOptions) {
  const maxConcurrency = options.maxConcurrency ?? 3;
  const maxLinksPerPage = options.maxLinksPerPage ?? 20;
  const [delayMin, delayMax] = options.delayRange ?? [1000, 2000];
  const tagsStr = (options.tags ?? []).join(',');

  let seedOrigin: string;
  try {
    seedOrigin = new URL(seedUrl).origin;
  } catch {
    console.error('Invalid seed URL:', seedUrl);
    return;
  }

  const queue: { url: string; depth: number }[] = [{ url: normalizeUrl(seedUrl), depth: 0 }];
  let pagesProcessed = 0;
  let activeWorkers = 0;

  console.log(`\n🌐 Starting crawl: [${options.source}] ${seedUrl} (limit: ${options.maxPages})`);

  const browser: Browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  while ((queue.length > 0 || activeWorkers > 0) && pagesProcessed < options.maxPages) {
    if (activeWorkers >= maxConcurrency || queue.length === 0) {
      await delay(80);
      continue;
    }

    const item = queue.shift()!;
    const normUrl = normalizeUrl(item.url);

    // Dedup check
    if (visitedUrls.has(normUrl)) continue;
    if (item.depth > options.maxDepth) continue;
    if (shouldSkipUrl(normUrl)) { visitedUrls.add(normUrl); continue; }
    visitedUrls.add(normUrl);

    activeWorkers++;

    (async () => {
      let page: Page | null = null;
      try {
        page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', req => {
          const type = req.resourceType();
          if (['image', 'stylesheet', 'font', 'media', 'ping', 'websocket'].includes(type)) {
            req.abort();
          } else {
            req.continue();
          }
        });

        await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 18000 });
        const html = await page.content();
        const $ = cheerio.load(html);

        // Strip boilerplate
        $('nav, footer, aside, script, style, noscript, svg, iframe, header,' +
          '[role="navigation"], [role="banner"], .sidebar, .ads, .advertisement,' +
          '.cookie-banner, #cookie-banner, .header, .navbar').remove();

        const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';
        const description = $('meta[name="description"]').attr('content')?.trim() ?? '';

        // Code extraction (before stripping)
        const codeChunks: string[] = [];
        $('pre, code').each((_, el) => {
          const t = $(el).text().trim();
          if (t.length > 10) codeChunks.push(t);
          $(el).remove();
        });
        const codeSnippets = codeChunks.join('\n\n').slice(0, 5000);

        // Main content
        let main = $('main, article, [role="main"], .content, .docs-content, #content, #main').first();
        if (main.length === 0) main = $('body');
        const rawText = main.text().replace(/\s+/g, ' ').trim().slice(0, 4000);

        if (rawText.length < 80) {
          // Too sparse — skip (listing page, auth wall, etc.)
          return;
        }

        // Content-hash dedup
        const hash = hashContent(rawText + title);
        if (seenHashes.has(hash)) {
          return; // duplicate content
        }
        seenHashes.add(hash);

        const pageData: PageData = {
          url: item.url,
          title,
          description,
          content: rawText,
          codeSnippets,
          source: options.source,
          tags: tagsStr,
          contentHash: hash,
          lastCrawled: new Date().toISOString(),
        };

        await savePage(pageData);
        pagesProcessed++;
        console.log(`  ✓ [${pagesProcessed}/${options.maxPages}] ${options.source} — ${title.slice(0, 70)}`);

        // Incrementally add to the live in-memory index so it's searchable immediately
        try {
          addDocumentToIndex({
            url:         pageData.url,
            title:       pageData.title       || '',
            description: pageData.description || '',
            source:      pageData.source      || '',
            content:     pageData.content     || '',
          });
        } catch (_) { /* non-fatal */ }

        // Queue child links
        if (item.depth < options.maxDepth) {
          let linksAdded = 0;
          $('a[href]').each((_, el) => {
            if (linksAdded >= maxLinksPerPage) return false; // break
            const href = $(el).attr('href');
            if (!href) return;

            let abs: string;
            try {
              abs = new URL(href.split('#')[0], item.url).href;
            } catch { return; }

            const norm = normalizeUrl(abs);
            if (visitedUrls.has(norm)) return;
            if (shouldSkipUrl(norm)) return;

            // Same-domain enforcement
            let absOrigin: string;
            try { absOrigin = new URL(abs).origin; } catch { return; }
            if (options.sameDomainOnly && absOrigin !== seedOrigin) return;

            queue.push({ url: abs, depth: item.depth + 1 });
            linksAdded++;
          });
        }

      } catch (err) {
        // swallow per-page errors, only log non-timeout ones
        const msg = (err as Error).message;
        if (!msg.includes('Timeout') && !msg.includes('Navigation')) {
          console.warn(`  ✗ ${item.url}: ${msg.slice(0, 80)}`);
        }
      } finally {
        if (page) await page.close().catch(() => {});
        await delay(delayMin + Math.random() * (delayMax - delayMin));
        activeWorkers--;
      }
    })();
  }

  // Drain workers
  while (activeWorkers > 0) await delay(150);
  await browser.close();

  console.log(`✅ Done [${options.source}]: ${pagesProcessed} pages saved`);

  // Rebuild the full index from DB so every page (including deduped ones) is correctly indexed
  if (pagesProcessed > 0) {
    console.log('🔄 Triggering full index re-sync after crawl...');
    await syncIndex().catch(err => console.error('Post-crawl syncIndex failed:', err));
  }

  return pagesProcessed;
}
