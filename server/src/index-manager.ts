import FlexSearch from 'flexsearch';
import { getAllPages } from './storage.js';

// ─── Index setup ──────────────────────────────────────────────────────────────

let index: any = null;

export function getIndex() {
  if (!index) {
    index = new FlexSearch.Document({
      tokenize: 'full',
      cache: 100,
      document: {
        id: 'url',
        index: [
          { field: 'title',        tokenize: 'full' },
          { field: 'description',  tokenize: 'full' },
          { field: 'content',      tokenize: 'full' },
          { field: 'codeSnippets', tokenize: 'full' },
        ],
        store: ['url', 'title', 'description', 'content'],
      },
    });
  }
  return index;
}

export async function syncIndex() {
  const searchIndex = getIndex();
  const pages = await getAllPages();
  for (const page of pages) {
    searchIndex.add({
      url:          page.url,
      title:        page.title        || '',
      description:  page.description  || '',
      content:      page.content      || '',
      codeSnippets: page.codeSnippets || '',
    });
  }
  console.log(`Synced ${pages.length} pages to FlexSearch index.`);
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
 * Called after FlexSearch produces a candidate set — this re-ranks by
 * text-level signals that FlexSearch doesn't compute.
 *
 * Signals (additive):
 *  +50  Exact query phrase in title
 *  +20  Exact query phrase in description
 *  +10  Exact query phrase in content
 *  +15 × n  Each occurrence of a query term in the title (capped at 3)
 *  +8  × n  Each occurrence of a query term in the description (capped at 3)
 *  +2  × n  Each occurrence of a query term in the content (capped at 5)
 *  +8  Each query term found in the URL (e.g. /react-hooks/)
 *  +20 Title coverage: (query terms present in title) / (total query terms) × 20
 *  +15 Description coverage
 *  +30 Title starts with query phrase
 *  +10 Title ends with query phrase
 *  −5  Content is very short (< 80 chars) — likely a stub or nav page
 *  −3  Title contains boilerplate words (e.g. "login", "sign up", "404")
 */
function scoreDoc(doc: any, queryTerms: string[], rawQuery: string): number {
  const title   = (doc.title       || '').toLowerCase();
  const desc    = (doc.description || '').toLowerCase();
  const content = (doc.content     || '').toLowerCase();
  const url     = (doc.url         || '').toLowerCase();
  const q       = rawQuery.toLowerCase().trim();

  let score = 0;

  // ── Exact phrase bonuses ────────────────────────────────────────────────
  if (title.includes(q))   score += 50;
  if (desc.includes(q))    score += 20;
  if (content.includes(q)) score += 10;

  // ── Title position bonuses ──────────────────────────────────────────────
  if (title.startsWith(q)) score += 30;
  if (title.endsWith(q))   score += 10;

  // ── Per-term scoring ────────────────────────────────────────────────────
  for (const term of queryTerms) {
    if (term.length < 2) continue;

    const tInTitle   = Math.min(countOccurrences(title, term), 3);
    const tInDesc    = Math.min(countOccurrences(desc, term),  3);
    const tInContent = Math.min(countOccurrences(content, term), 5);

    score += tInTitle   * 15;
    score += tInDesc    *  8;
    score += tInContent *  2;

    // URL keyword match (e.g. "/react-hooks/", "react" in hostname)
    if (url.includes(term)) score += 8;
  }

  // ── Term coverage ratios ────────────────────────────────────────────────
  const meaningful = queryTerms.filter(t => t.length >= 2);
  if (meaningful.length > 0) {
    const titleCov = meaningful.filter(t => title.includes(t)).length / meaningful.length;
    const descCov  = meaningful.filter(t => desc.includes(t)).length  / meaningful.length;
    score += titleCov * 20;
    score += descCov  * 15;
  }

  // ── Penalties ───────────────────────────────────────────────────────────
  const contentLen = (doc.content || '').length;
  if (contentLen < 80) score -= 5;  // Stub / nav page

  const BOILERPLATE = ['login', 'sign up', 'signup', '404', 'not found', 'cookie', 'privacy policy'];
  if (BOILERPLATE.some(b => title.includes(b))) score -= 3;

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
  const searchIndex = getIndex();
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  // Normalise query terms (lowercase, split on whitespace, dedupe)
  const queryTerms = [...new Set(
    trimmedQuery.toLowerCase().split(/\s+/).filter(t => t.length >= 2)
  )];

  // Step 1 — FlexSearch candidate retrieval
  const raw: any[] = await searchIndex.search(trimmedQuery, {
    limit: 40,         // wider net; re-ranker will trim to 10
    enrich: true,
    suggest: true,
  });

  // Step 2 — Merge across field layers (deduplicate by URL, keep doc)
  const candidates = new Map<string, any>(); // url → doc
  for (const layer of raw) {
    for (const hit of (layer.result || [])) {
      const url = hit.id as string;
      if (url && !candidates.has(url)) {
        candidates.set(url, hit.doc);
      }
    }
  }

  if (candidates.size === 0) return [];

  // Step 3 — Score each candidate
  const scored = Array.from(candidates.entries()).map(([url, doc]) => ({
    doc: { ...doc, url: doc?.url ?? url }, // ensure url always on doc
    score: scoreDoc(doc, queryTerms, trimmedQuery),
  }));

  // Step 4 — Sort + return top 10
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 10).map(({ doc }) => doc);
}
