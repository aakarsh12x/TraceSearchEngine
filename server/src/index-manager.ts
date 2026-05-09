import FlexSearch from 'flexsearch';
import { getPagesChunk } from './storage.js';
import { sql } from './db.js';
import fs from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Cache paths ──────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Stored one level up from /dist or /src so it survives TypeScript recompiles
const CACHE_DIR         = path.resolve(__dirname, '../../.cache/flexsearch');
const CACHE_META_FILE   = path.join(CACHE_DIR, 'meta.json');
const CACHE_CONTENT_FILE = path.join(CACHE_DIR, 'content-cache.json');

// ─── Index setup ──────────────────────────────────────────────────────────────

let index: any = null;
const contentCache = new Map<string, string>();

export function addDocumentToIndex(doc: {
  url: string; title: string; description: string; source: string; content?: string;
}) {
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

// ─── Disk persistence helpers ─────────────────────────────────────────────────

/** Serialize the FlexSearch index to .cache/flexsearch/ */
async function saveIndexToDisk(docCount: number): Promise<void> {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    // FlexSearch's export gives us one chunk per internal key
    const chunks: Record<string, any> = {};
    await new Promise<void>((resolve) => {
      index.export((key: string, data: any) => {
        chunks[key] = data;
      });
      // export() is synchronous in FlexSearch Document; resolve after tick
      setImmediate(resolve);
    });

    // Write each chunk as a separate file (FlexSearch requirement on import)
    for (const [key, data] of Object.entries(chunks)) {
      const safe = key.replace(/[^a-z0-9_\-]/gi, '_');
      fs.writeFileSync(path.join(CACHE_DIR, `${safe}.json`), JSON.stringify(data ?? null));
    }

    // Write content cache
    fs.writeFileSync(CACHE_CONTENT_FILE, JSON.stringify(Object.fromEntries(contentCache)));

    // Write meta (doc count + key list for import)
    fs.writeFileSync(CACHE_META_FILE, JSON.stringify({
      docCount,
      keys: Object.keys(chunks),
      savedAt: new Date().toISOString(),
    }));

    console.log(`💾 Index cache saved (${docCount} docs, ${Object.keys(chunks).length} chunks)`);
  } catch (err) {
    // Non-fatal — worst case we rebuild next time
    console.warn('⚠️  Could not save index cache:', err);
  }
}

/** Load a previously saved index from .cache/flexsearch/. Returns true on success. */
async function loadIndexFromDisk(currentDbCount?: number): Promise<boolean> {
  try {
    if (!fs.existsSync(CACHE_META_FILE)) return false;

    const meta = JSON.parse(fs.readFileSync(CACHE_META_FILE, 'utf-8'));

    // Stale check — only possible when caller already knows the DB count
    if (currentDbCount !== undefined && meta.docCount !== currentDbCount) {
      console.log(`🔄 Cache stale (cached ${meta.docCount}, DB has ${currentDbCount}) — rebuilding…`);
      return false;
    }

    console.log(`\n⚡ Loading index from disk cache (${meta.docCount} docs, saved ${meta.savedAt})…`);

    index = createIndex();

    // ── Read all chunk files in PARALLEL (async I/O, non-blocking) ────────────────────────
    const chunkPaths = meta.keys.map((key: string) => {
      const safe = key.replace(/[^a-z0-9_\-]/gi, '_');
      return { key, file: path.join(CACHE_DIR, `${safe}.json`) };
    });

    // Check all files exist before starting
    for (const { file } of chunkPaths) {
      if (!fs.existsSync(file)) {
        console.warn(`  Missing cache chunk: ${file} — falling back to DB rebuild`);
        index = createIndex();
        return false;
      }
    }

    // Read all chunks concurrently
    const chunkDataArr = await Promise.all(
      chunkPaths.map(({ file }) => readFile(file, 'utf-8').then(JSON.parse))
    );

    // Import into FlexSearch (must be sequential — FlexSearch internal state)
    for (let i = 0; i < meta.keys.length; i++) {
      index.import(meta.keys[i], chunkDataArr[i]);
    }

    // Restore content cache (read async)
    if (fs.existsSync(CACHE_CONTENT_FILE)) {
      const raw = JSON.parse(await readFile(CACHE_CONTENT_FILE, 'utf-8'));
      for (const [url, content] of Object.entries(raw)) {
        contentCache.set(url, content as string);
      }
    }

    console.log(`✅ Index loaded from cache in milliseconds.\n`);
    return true;
  } catch (err) {
    console.warn('⚠️  Cache load failed, falling back to DB rebuild:', err);
    index = createIndex();
    return false;
  }
}

// ─── Public sync ──────────────────────────────────────────────────────────────────────────────────

export async function syncIndex() {
  // ── Fast path: try disk cache FIRST (no DB round-trip needed) ───────────────────────────
  const cachedOk = await loadIndexFromDisk(); // no count arg = skip stale check
  if (cachedOk) return;

  // ── Slow path: cache missing / corrupt — hit DB to build from scratch ───────────────────
  const countRes = await sql`SELECT count(*) as c FROM pages`;
  const total = Number(countRes[0].c);

  index = createIndex();
  contentCache.clear();

  console.log(`\n📚 Building index from DB: ${total} pages…`);

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

  // Persist to disk so next startup is instant
  await saveIndexToDisk(synced);
}

/** Force a full DB rebuild regardless of disk cache (used by /admin/resync). */
export async function forceSync() {
  const countRes = await sql`SELECT count(*) as c FROM pages`;
  const total = Number(countRes[0].c);
  index = createIndex();
  contentCache.clear();
  console.log(`\n🔄 Force-rebuilding index from DB: ${total} pages…`);
  const CHUNK_SIZE = 1000;
  let offset = 0;
  let synced = 0;
  while (offset < total) {
    const rows = await getPagesChunk(offset, CHUNK_SIZE);
    if (rows.length === 0) break;
    for (const page of rows) {
      addDocumentToIndex({
        url: page.url, title: page.title || '',
        description: page.description || '', source: page.source || '',
        content: page.content || '',
      });
    }
    synced += rows.length;
    offset += CHUNK_SIZE;
  }
  console.log(`✅ Force-sync done: ${synced} pages.\n`);
  await saveIndexToDisk(synced);
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

// ─── Fuzzy helpers ────────────────────────────────────────────────────────────

/**
 * Generate 1-edit-distance typo variants for a single word.
 * Covers the most-common typing mistakes:
 *   - Adjacent-key transpositions  ("typscript"  → "typescript")
 *   - Single-char deletions        ("typescritp" → "typescript")
 *   - Double-letter collapse       ("reacct"     → "react")
 * Only for words >= 4 chars to avoid noise on short terms.
 */
function typoVariants(word: string): string[] {
  if (word.length < 4) return [];
  const variants = new Set<string>();

  // Adjacent transpositions (fast-typing finger-swap)
  for (let i = 0; i < word.length - 1; i++) {
    variants.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  }

  // Single-char deletion (dropped key)
  for (let i = 0; i < word.length; i++) {
    const del = word.slice(0, i) + word.slice(i + 1);
    if (del.length >= 3) variants.add(del);
  }

  // Double-letter collapse ("reacct" → "react")
  for (let i = 0; i < word.length - 1; i++) {
    if (word[i] === word[i + 1]) variants.add(word.slice(0, i) + word.slice(i + 1));
  }

  variants.delete(word);
  return Array.from(variants);
}

/**
 * Phonetic skeleton: strip vowels + collapse repeated chars.
 * Last-resort pass for severe typos ("javascrip", "typescrpt").
 */
function phoneticSkeleton(word: string): string {
  return word.toLowerCase()
    .replace(/[aeiou]/g, '')
    .replace(/(.)\1+/g, '$1')
    .slice(0, 8);
}

/** Merge FlexSearch raw results into candidates map, return count added. */
function mergeRaw(raw: any[], candidates: Map<string, any>): number {
  let added = 0;
  for (const layer of raw) {
    for (const hit of (layer.result || [])) {
      const url = hit.id as string;
      if (url && !candidates.has(url)) {
        candidates.set(url, hit.doc ?? { url });
        added++;
      }
    }
  }
  return added;
}

// ─── Public search function ───────────────────────────────────────────────────

/**
 * Multi-pass fuzzy search pipeline:
 *
 *  Pass 1 — Exact FlexSearch query (fast, always runs)
 *  Pass 2 — If candidates sparse (< 8): typo variants per term
 *  Pass 3 — If still sparse (< 5): phonetic skeleton of query
 *
 *  Fuzzy-only candidates receive a score penalty so exact matches
 *  always rank above them.
 */
export async function search(query: string): Promise<{ results: any[]; total: number }> {
  const t0 = Date.now();
  const searchIndex = getIndex();
  const trimmedQuery = query.trim();
  if (!trimmedQuery || trimmedQuery.length < 2) return { results: [], total: 0 };

  const queryTerms = [...new Set(
    trimmedQuery.toLowerCase().split(/\s+/).filter(t => t.length >= 2)
  )];

  // ── Pass 1: exact query ──────────────────────────────────────────────────
  const raw1: any[] = await searchIndex.search(trimmedQuery, {
    limit: 150,
    enrich: true,
    suggest: true,
  });
  const t1 = Date.now();

  const candidates = new Map<string, any>();
  const fuzzyUrlSet = new Set<string>(); // urls only found via fuzzy passes

  // Collect pass-1 url set before merging for later comparison
  const pass1Urls = new Set<string>(
    raw1.flatMap((l: any) => (l.result || []).map((h: any) => h.id as string))
  );
  mergeRaw(raw1, candidates);

  // ── Pass 2: typo variants ────────────────────────────────────────────────
  const t2Start = Date.now();
  if (candidates.size < 8 && queryTerms.length > 0) {
    const allVariants = [...new Set(queryTerms.flatMap(t => typoVariants(t)))].slice(0, 30);

    for (const variant of allVariants) {
      const raw2: any[] = await searchIndex.search(variant, {
        limit: 60,
        enrich: true,
        suggest: true,
      });
      mergeRaw(raw2, candidates);
    }

    // Mark every url NOT in pass-1 as fuzzy
    for (const url of candidates.keys()) {
      if (!pass1Urls.has(url)) fuzzyUrlSet.add(url);
    }

    if (fuzzyUrlSet.size > 0)
      console.log(`   🔀 Fuzzy pass 2 (typo variants): +${fuzzyUrlSet.size} new candidates`);
  }

  // ── Pass 3: phonetic skeleton (last resort) ──────────────────────────────
  const t3Start = Date.now();
  if (candidates.size < 5 && queryTerms.length > 0) {
    const skeletonQuery = queryTerms
      .map(phoneticSkeleton)
      .filter(s => s.length >= 2)
      .join(' ');

    if (skeletonQuery && skeletonQuery !== trimmedQuery) {
      const beforeSize = candidates.size;
      const raw3: any[] = await searchIndex.search(skeletonQuery, {
        limit: 60,
        enrich: true,
        suggest: true,
      });
      const added = mergeRaw(raw3, candidates);

      // Mark all newly added as fuzzy
      const urlsNow = Array.from(candidates.keys());
      for (const url of urlsNow.slice(beforeSize)) fuzzyUrlSet.add(url);

      if (added > 0)
        console.log(`   🔀 Fuzzy pass 3 (phonetic): +${added} new candidates`);
    }
  }
  const t3End = Date.now();

  if (candidates.size === 0) return { results: [], total: 0 };

  // ── Content cache lookup for scoring ────────────────────────────────────
  const contentMap: Record<string, string> = {};
  for (const url of candidates.keys()) {
    contentMap[url] = contentCache.get(url) || '';
  }

  // ── Score — fuzzy-only hits get a penalty so exact matches rank above them
  const FUZZY_PENALTY = 8;
  const scored = Array.from(candidates.entries()).map(([url, doc]) => {
    const base = scoreDoc(doc, queryTerms, trimmedQuery, contentMap[url] || '');
    const score = fuzzyUrlSet.has(url) ? Math.max(0, base - FUZZY_PENALTY) : base;
    return { doc: { ...doc, url: doc?.url ?? url }, score };
  });

  // ── Sort and return top 50 (frontend paginates) ──────────────────────────
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 50);
  const tEnd = Date.now();

  console.log(
    `Search "${query}": exact=${t1 - t0}ms, fuzzy=${t3End - t2Start}ms, ` +
    `total=${tEnd - t0}ms | candidates=${candidates.size} (fuzzy=${fuzzyUrlSet.size}), returning=${top.length}`
  );

  return { results: top.map(({ doc }) => doc), total: top.length };
}


