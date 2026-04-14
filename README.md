# Trace

A high-performance, AI-augmented search engine built for developers. Trace indexes technical documentation, Stack Overflow threads, GitHub repositories, and developer-focused content — surfacing results in under a millisecond with a neural inference layer that synthesizes answers from the top results in real time.

<img width="1919" height="911" alt="Hero view" src="https://github.com/user-attachments/assets/33c713de-15c8-425c-8a45-c7e66160ba41" />
<img width="1919" height="906" alt="Results view" src="https://github.com/user-attachments/assets/db03ef5b-3af5-4960-8e89-cd5261ffca7a" />
<img width="1910" height="909" alt="AI terminal" src="https://github.com/user-attachments/assets/a8da18bd-524c-4e90-8c22-955c0f340f78" />

---

## Architecture Overview

Trace is a full-stack TypeScript monorepo split into two independently deployed runtimes that communicate over HTTP.

```
                         Browser
                            |
                     Next.js Frontend
                    (src/ — port 3000)
                     /              \
            /api/search         /api/ai-answer
                |                      |
         Express Backend          NVIDIA NIM API
        (server/ — port 3001)    (LLaMA 3.1 70B)
                |
         FlexSearch Index (RAM)
                |
         Neon Postgres (persistent store)
```

The frontend never talks to the database directly. All search traffic flows through the Express backend, which owns the in-memory index and the crawl pipeline exclusively. The AI answer route in Next.js is the sole consumer of the NVIDIA NIM API and streams its response directly to the browser via the Vercel AI SDK.

---

## System Components

### 1. Crawl Pipeline — `server/src/crawler.ts`

The crawler is a concurrent, Puppeteer-driven spider that handles the full lifecycle from URL discovery to database persistence. It is designed to be polite, accurate, and efficient.

**Deduplication**

Before a crawl begins, `prewarmDedup()` pre-loads all known URLs and SHA-256 content hashes from Postgres into two in-memory `Set` instances. Every URL processed is normalized — fragments stripped, tracking parameters removed — before any dedup check. Content hashes are used as a second guard: if a page's text body has not changed since the last crawl, it is skipped entirely without a database write.

**Resource filtering**

Puppeteer's request interception is activated immediately after each new page opens. Requests for images, fonts, stylesheets, media, pings, and websockets are aborted at the network layer. Only HTML and script resources are allowed through. This reduces per-page bandwidth by roughly 80% and eliminates render time waiting on assets that have no textual value.

**Content extraction**

After load, Cheerio parses the rendered HTML for structured fields:

- `title` — the page `<title>` tag or the first prominent heading.
- `description` — the `<meta name="description">` content.
- `content` — concatenated text of all `<p>`, `<article>`, `<section>`, `<li>`, and `<pre>` elements after stripping navigation, footer, sidebar, and advertisement noise.
- `codeSnippets` — all `<code>` and `<pre>` blocks joined and truncated to 10,000 characters.
- `source` — the seed label assigned to the crawl batch (e.g., "mdn", "stackoverflow").
- `tags` — user-defined keywords attached per seed for domain weighting.

**Live indexing**

Upon successfully writing a page to Postgres, the crawler immediately calls `addDocumentToIndex()` from the index manager. This ensures newly crawled pages are searchable without requiring a full server restart or manual re-sync. The content is also written directly into the in-memory `contentCache` at the same time.

**Concurrency**

The crawler uses a manual worker pool pattern. A configurable `maxConcurrency` (default: 3) controls how many Puppeteer pages are alive simultaneously within the same browser process. A configurable `delayRange` introduces randomized inter-request pauses to avoid rate limiting. The queue is a FIFO list of `{ url, depth }` tuples that workers pull from. Depth enforcement is strict: any URL exceeding `maxDepth` is discarded before processing begins.

**URL filtering**

A denylist of path patterns excludes auth pages, pagination, tag archives, sitemaps, legal pages, and other content-sparse routes before they enter the queue. This keeps the index dense with signal-bearing content.

---

### 2. Index Manager — `server/src/index-manager.ts`

The index manager is the performance-critical core of the system. Every search query resolves entirely in memory without touching the database.

**FlexSearch Document Index**

The primary index is a `FlexSearch.Document` instance with three indexed fields: `title` (forward tokenized), `description` (forward tokenized), and `source` (strict tokenized). The `content` field is explicitly excluded from the FlexSearch index to prevent memory exhaustion on large corpora — a full-text index over content at scale would require multiple gigabytes of RAM.

Only lightweight display fields (`url`, `title`, `description`, `source`) are stored inside FlexSearch. This keeps the index memory footprint minimal while still enabling low-latency retrieval.

**In-Memory Content Cache**

A module-level `Map<string, string>` called `contentCache` stores the first 1,000 characters of the full body content for each indexed document. This cache serves two purposes:

1. Supplying body text to the multi-signal relevance scorer without issuing any database query.
2. Displaying a content preview snippet in search results immediately.

At index sync time, every page's content is written to the cache. At crawl time, `addDocumentToIndex()` writes to both the FlexSearch index and the cache simultaneously. The result is that the hot search path makes exactly zero I/O calls.

**Index Sync**

`syncIndex()` is called once when the Express server starts. It iterates the full Postgres `pages` table in chunks of 1,000 rows using offset-based pagination via `getPagesChunk()`, loading each chunk into both the FlexSearch index and the content cache. For a table of 50,000 pages, this takes approximately 10–15 seconds at startup and thereafter requires no further database access for reads.

An HTTP admin endpoint (`POST /admin/resync`) allows triggering a full re-sync at runtime without restarting the server.

**Search Pipeline — Five Stages**

1. **Candidate retrieval.** FlexSearch receives the raw query string with `enrich: true` and `suggest: true`. A candidate pool of up to 40 documents is returned across all indexed field layers simultaneously. This stage typically completes in under 1 millisecond.

2. **Cross-field deduplication.** FlexSearch returns separate result arrays for each indexed field. These are merged into a single `Map<url, doc>` using the URL as the unique key. Hits from higher-weight fields simply overwrite duplicate entries.

3. **Content resolution.** For each candidate URL, the in-memory `contentCache` is consulted. This is a plain `Map.get()` — no async I/O, no database round-trip.

4. **Multi-signal scoring.** Each candidate is scored by `scoreDoc()`, which applies a weighted combination of signals:
   - Exact phrase match in title (+50), description (+20), body (+10).
   - Title prefix/suffix position match (+30/+10).
   - Per-term occurrence counts in title, description, and body, capped to prevent term stuffing.
   - Query term coverage ratios across title and description.
   - Domain authority boost (+50) for a curated list of trusted technical sources including MDN, TypeScript, React, Node.js, Rust, Docker, Kubernetes, Tailwind, and others.
   - Boilerplate title penalty (−3) for pages matching noise patterns like login, 404, or privacy policy.

5. **Sort and return.** Candidates are sorted descending by final score and the top 10 are returned.

The complete end-to-end latency for a typical search query is under 5 milliseconds.

---

### 3. Express Backend — `server/src/index.ts`

The backend is a minimal Express server with four HTTP endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/search?q=` | Execute a search query against the in-memory FlexSearch index |
| `POST` | `/crawler/start` | Kick off a background Puppeteer crawl from a given seed URL |
| `POST` | `/crawler/reddit` | Kick off a Reddit-specific crawl across given subreddits |
| `POST` | `/admin/resync` | Re-synchronize the FlexSearch index from Postgres without restart |

On server start, `syncIndex()` is awaited before the process becomes ready. This guarantees the index is fully populated before any search request is handled.

---

### 4. Next.js API Bridge — `src/app/api/search/route.ts`

The search API route is a lightweight proxy between the browser and the Express backend. It relays the `q` parameter to `http://127.0.0.1:3001/search` over loopback. The explicit use of `127.0.0.1` instead of `localhost` eliminates a well-documented Node.js behavior where IPv6 DNS resolution adds 300–500 milliseconds of latency per request on Windows and some Linux configurations, as Node.js first attempts to resolve `::1` before falling back to `127.0.0.1`.

---

### 5. AI Answer Route — `src/app/api/ai-answer/route.ts`

The AI synthesis route uses the Vercel AI SDK's `streamText()` to stream a response directly from the NVIDIA NIM inference API to the browser. The model is Meta's LLaMA 3.1 70B Instruct, accessed via the NVIDIA integration endpoint.

The route accepts the user's query and the top four search results from the current session. It builds a structured system prompt containing the title, description, URL, and any extracted code snippets from each result, then asks the model to synthesize a concise, technically precise answer without conversational filler.

The response is streamed as raw text using the Vercel AI SDK's `useCompletion` hook on the frontend, which means the first tokens appear in the UI within roughly 300–500 milliseconds of initiating the request.

---

### 6. Frontend — `src/app/page.tsx`

The frontend is a single-page Next.js application built with Framer Motion and Tailwind CSS.

**State model**

```typescript
const isResultsMode = isAITriggered || hasSearched || query.trim().length > 0;
```

Transitioning to results mode requires only that the user has begun typing. The entire view reorganization — hero exit, top bar entrance, terminal reveal — is driven by this single boolean.

**Search-as-you-type**

A 400ms debounce on the query input fires a fetch to `/api/search`. Results populate without pressing Enter, giving users live signal about what the index contains while they refine their query.

**Layout morphing**

The search input and the Trace logo both carry Framer Motion `layoutId` attributes. When `isResultsMode` becomes true, these elements smoothly morph to their new positions inside the fixed top navigation bar using Framer Motion's shared layout animation system. The spring physics are configured with an `[0.22, 1, 0.36, 1]` cubic bezier and a duration of 850ms, giving the transition a premium, unhurried character.

The page body's flex alignment toggles from `justify-center` to `justify-start` simultaneously, so the content that follows the search bar renders flush from below the nav rather than jumping in from screen center. The Hero block exits using `AnimatePresence` with `mode="popLayout"`, which removes the exiting element from document flow immediately, preventing it from displacing the incoming results layout.

**AI terminal**

The Neural Inference Engine terminal becomes visible as soon as `isResultsMode` is true. Before the AI is triggered, it renders a styled keyboard hint (`Press Enter to generate an AI summary`). After triggering, it transitions through a pulsing "Synthesizing context…" state into streaming markdown rendered by `react-markdown`. The terminal box appears with a 50ms delay relative to the search transition to avoid competing with the layout morph animation.

---

## Data Store — Neon Postgres

The `pages` table is the sole persistent store:

| Column | Type | Notes |
|--------|------|-------|
| `url` | `text` PRIMARY KEY | Normalized, deduplicated |
| `title` | `text` | From page `<title>` or first heading |
| `description` | `text` | From meta description |
| `content` | `text` | Extracted body text |
| `code_snippets` | `text` | All `<code>` and `<pre>` content |
| `source` | `text` | Crawl batch label |
| `tags` | `text` | Comma-separated tag keywords |
| `content_hash` | `text` | SHA-256 of content for dedup |
| `last_crawled` | `timestamptz` | Crawl timestamp |

Upserts use `ON CONFLICT (url) DO UPDATE SET` to keep records fresh when a page is recrawled.

---

## Performance Characteristics

| Operation | Typical Latency |
|-----------|----------------|
| FlexSearch candidate retrieval | < 1ms |
| Content cache resolution (Map.get) | < 0.1ms |
| Multi-signal scoring (40 candidates) | 1–3ms |
| Full search pipeline (end-to-end) | 2–5ms |
| Next.js API to Express round-trip | 8–20ms |
| Browser fetch to first result render | 20–40ms |
| AI first token appearance | 300–600ms |

The dominant cost in browser-perceived latency is the HTTP round-trip over loopback, not the search computation itself.

---

## Local Development

**Prerequisites**

- Node.js 20+
- A Neon Postgres database with the `pages` table created
- An NVIDIA NIM API key for AI features

**Environment**

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://...
NVIDIA_KEY=nvapi-...
```

**Start the backend**

```bash
cd server
npm install
npm run dev
```

The server starts on port 3001, syncs the full index from Postgres, and is ready to handle search queries.

**Start the frontend**

```bash
cd src
npm install
npm run dev
```

The Next.js dev server starts on port 3000.

**Run a crawl**

Send a POST to the crawler endpoint with a seed URL:

```bash
curl -X POST http://localhost:3001/crawler/start \
  -H "Content-Type: application/json" \
  -d '{"seedUrl": "https://nextjs.org/docs"}'
```

The crawl runs in the background. Pages are indexed live and become searchable within seconds of being crawled.

**Re-sync the index**

If pages were added to Postgres externally or the server was restarted with stale state:

```bash
curl -X POST http://localhost:3001/admin/resync
```

---

## Project Structure

```
SearchEngine/
  server/                    Express backend
    src/
      index.ts               Server entry point, HTTP routes
      crawler.ts             Puppeteer crawl engine
      index-manager.ts       FlexSearch index, content cache, relevance scorer
      storage.ts             Neon Postgres query layer
      db.ts                  Database connection pool
      reddit-crawler.ts      Reddit-specific crawl pipeline
    scripts/
      mega-crawl.ts          Seeded multi-domain crawl runner
      verify-index.ts        Index correctness diagnostics
      check-count.ts         Database row count utility
  src/                       Next.js frontend
    app/
      page.tsx               Main search UI
      globals.css            Theme, scrollbars, animations
      api/
        search/route.ts      Search proxy to Express
        ai-answer/route.ts   NVIDIA NIM streaming endpoint
    components/
      ui/
        text-animate.tsx     Framer Motion character animation
        terminal.tsx         Styled terminal output component
        shimmer-button.tsx   Animated submit button
        meteors.tsx          Background particle effect
```

---

## Design Decisions

**Why a separate Express backend?**

Next.js API routes are serverless-compatible and stateless by design, which makes them unsuitable for hosting an in-memory search index. The Express backend is a persistent Node.js process that holds the FlexSearch index in RAM for the lifetime of the server. In production, the Express service runs as a long-lived container or VM instance, while the Next.js frontend deploys to Vercel or a similar edge-aware platform.

**Why FlexSearch over a vector database?**

For developer documentation search, keyword and phrase relevance is often more precise than cosine similarity over embeddings. A user searching for `useEffect cleanup` wants documents that contain those exact tokens, not documents semantically adjacent in a latent space. FlexSearch provides sub-millisecond full-text search with forward tokenization at negligible memory cost compared to embedding stores.

**Why not index content in FlexSearch?**

A forward-tokenized inverted index on the content field would generate hundreds of index positions per document. At 10,000 documents with an average content length of 2,000 characters, the content index alone would consume several hundred megabytes of RAM and meaningfully slow each insertion. The scoring system instead uses the raw content string from the in-memory cache for signal computation, which is computationally cheaper than indexed lookup for this use case.

**Why SHA-256 for deduplication?**

Content-addressed deduplication catches pages that changed their URL (redirects, canonicalization) but not their body. It also guards against re-crawling mirror sites. The hash is computed server-side before any database write and checked against a pre-warmed in-memory set, making the dedup check free of round-trips.

---

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, TypeScript, Framer Motion, Tailwind CSS |
| Backend | Express, Node.js 20 |
| Search | FlexSearch (in-memory inverted index) |
| Crawler | Puppeteer, Cheerio |
| Database | Neon Postgres (serverless) |
| AI | NVIDIA NIM API, LLaMA 3.1 70B Instruct |
| AI SDK | Vercel AI SDK (streaming) |

---

Built by a developer, for developers.
