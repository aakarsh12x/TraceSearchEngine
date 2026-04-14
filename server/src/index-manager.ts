import FlexSearch from 'flexsearch';
import { getPagesChunk } from './storage.js';
import { sql } from './db.js';

// ─── Index setup ──────────────────────────────────────────────────────────────

let index: any = null;
const contentCache = new Map<string, string>();

export function addDocumentToIndex(doc: { url: string, title: string, description: string, source: string, content?: string }) {
  const searchIndex = getIndex();
  searchIndex.add({
    url:         doc.url,
    title:       doc.title,
    description: doc.description,
    source:      doc.source,
  });
  if (doc.content) {
    contentCache.set(doc.url, doc.content.substring(0, 1000));
  }
}

function createIndex() {
  return new FlexSearch.Document({
    document: {
      id: 'url',
      // ONLY index small fields — content would consume multiple GB of RAM
      index: [
        { field: 'title',       tokenize: 'forward' },
        { field: 'description', tokenize: 'forward' },
        { field: 'source',      tokenize: 'strict'  },
      ],
      // Store essential display fields in-memory
      store: ['url', 'title', 'description', 'source'],
    },
  });
}

export function getIndex() {
  if (!index) index = createIndex();
  return index;
}

export async function syncIndex() {
  // Always rebuild a fresh index to avoid stale data from hot-reloads
  index = createIndex();
  const searchIndex = index;

  const countRes = await sql`SELECT count(*) as c FROM pages`;
  const total = Number(countRes[0].c);

  console.log(`\n📚 Syncing index: ${total} pages...`);

  const CHUNK_SIZE = 1000;
  let offset = 0;
  let synced = 0;

  while (offset < total) {
    const rows = await getPagesChunk(offset, CHUNK_SIZE);
    if (rows.length === 0) break;

    for (const page of rows) {
      addDocumentToIndex({
        url:         page.url,
        title:       page.title       || '',
        description: page.description || '',
        source:      page.source      || '',
        content:     page.content     || '',
      });
    }

    synced += rows.length;
    offset  += CHUNK_SIZE;
    console.log(`   ✓ ${synced}/${total} indexed`);
  }

  console.log(`✅ Index ready: ${synced} pages loaded.\n`);
}

// ─── Relevance Ranker ─────────────────────────────────────────────────────────

/** Count non-overlapping occurrences of a substring */
function countOccurrences(text: string, term: string): number {
  if (!term || !text) return 0;
  let count = 0;
  let pos = text.indexOf(term);
  while (pos !== -1) {
    count++;
    pos = text.indexOf(term, pos + term.length);
  }
  return count;
}

/**
 * Multi-signal relevance scorer.
 * doc only stores: url, title, description (in-memory).
 * content is fetched from DB and passed in separately for scoring signals.
 */
function scoreDoc(doc: any, queryTerms: string[], rawQuery: string, content: string = ''): number {
  const title = (doc.title       || '').toLowerCase();
  const desc  = (doc.description || '').toLowerCase();
  const body  = content.toLowerCase();
  const url   = (doc.url         || '').toLowerCase();
  const q     = rawQuery.toLowerCase().trim();

  let score = 0;

  // ── Exact phrase bonuses ────────────────────────────────────────────────
  if (title.includes(q)) score += 50;
  if (desc.includes(q))  score += 20;
  if (body.includes(q))  score += 10;

  // ── Title position bonuses ──────────────────────────────────────────────
  if (title.startsWith(q)) score += 30;
  if (title.endsWith(q))   score += 10;

  // ── Per-term scoring ────────────────────────────────────────────────────
  for (const term of queryTerms) {
    if (term.length < 2) continue;
    score += Math.min(countOccurrences(title, term), 3) * 15;
    score += Math.min(countOccurrences(desc, term),  3) * 8;
    score += Math.min(countOccurrences(body, term),  5) * 2;
    if (url.includes(term)) score += 8;
  }

  // ── Coverage ratios ─────────────────────────────────────────────────────
  const meaningful = queryTerms.filter(t => t.length >= 2);
  if (meaningful.length > 0) {
    const titleCov = meaningful.filter(t => title.includes(t)).length / meaningful.length;
    const descCov  = meaningful.filter(t => desc.includes(t)).length  / meaningful.length;
    score += titleCov * 20;
    score += descCov  * 15;
  }

  // ── Penalties ───────────────────────────────────────────────────────────
  const BOILERPLATE = ['login', 'sign up', 'signup', '404', 'not found', 'cookie', 'privacy policy'];
  if (BOILERPLATE.some(b => title.includes(b))) score -= 3;

  // ── Domain Authority Boost ──────────────────────────────────────────────
  const TRUSTED = [
    'typescriptlang.org', 'react.dev', 'nextjs.org', 'nodejs.org',
    'developer.mozilla.org', 'docs.python.org', 'go.dev', 'rust-lang.org',
    'vuejs.org', 'svelte.dev', 'angular.dev', 'postgresql.org',
    'docs.docker.com', 'kubernetes.io', 'fastapi.tiangolo.com',
    'docs.djangoproject.com', 'flask.palletsprojects.com', 'docs.nestjs.com',
    'www.prisma.io', 'tailwindcss.com', 'jestjs.io', 'vitest.dev',
    'playwright.dev', 'redux-toolkit.js.org', 'trpc.io', 'zod.dev',
  ];
  if (TRUSTED.some(d => url.includes(d))) score += 50;

  return score;
}

// ─── Public search function ───────────────────────────────────────────────────

/**
 * Search and return deduplicated, multi-signal ranked results.
 *
 * Pipeline:
 *  1. FlexSearch retrieves a candidate pool (limit: 40) via full-tokenized search
 *  2. Candidates are field-deduplicated and merged into a Map
 *  3. Each candidate is scored by the multi-signal ranker
 *  4. Sorted by final score, top 10 returned
 */
export async function search(query: string): Promise<any[]> {
  const t0 = Date.now();
  const searchIndex = getIndex();
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const queryTerms = [...new Set(
    trimmedQuery.toLowerCase().split(/\s+/).filter(t => t.length >= 2)
  )];

  // Step 1 — FlexSearch candidate retrieval (title + description only)
  const raw: any[] = await searchIndex.search(trimmedQuery, {
    limit: 40,
    enrich: true,
    suggest: true,
  });
  const t1 = Date.now();

  // Step 2 — Merge across field layers, deduplicate by URL
  const candidates = new Map<string, any>(); // url → stored doc
  for (const layer of raw) {
    for (const hit of (layer.result || [])) {
      const url = hit.id as string;
      if (url && !candidates.has(url)) {
        candidates.set(url, hit.doc ?? { url });
      }
    }
  }

  if (candidates.size === 0) return [];

  // Step 3 — Fetch full content from memory cache for top candidates (for scoring only)
  const urls = Array.from(candidates.keys());
  let contentMap: Record<string, string> = {};
  
  for (const url of urls) {
    contentMap[url] = contentCache.get(url) || '';
  }

  const t2 = Date.now();

  // Step 4 — Score each candidate
  const scored = Array.from(candidates.entries()).map(([url, doc]) => ({
    doc: { ...doc, url: doc?.url ?? url },
    score: scoreDoc(doc, queryTerms, trimmedQuery, contentMap[url] || ''),
  }));

  // Step 5 — Sort and return top 10
  scored.sort((a, b) => b.score - a.score);
  const t3 = Date.now();
  console.log(`Search trace for "${query}": FlexSearch=${t1-t0}ms, MapMerge=${t2-t1}ms, Scoring=${t3-t2}ms, Total=${t3-t0}ms`);
  return scored.slice(0, 10).map(({ doc }) => doc);
}
