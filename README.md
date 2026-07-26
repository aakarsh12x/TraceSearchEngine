# Trace

> High-performance, agentic search engine designed for software developers.

Trace combines sub-millisecond local index retrieval with an autonomous live-web search agent. It indexes developer documentation, GitHub repositories, and technical resources—synthesizing streaming answers with inline citations, code blocks, interactive concept inspection, and automated follow-up suggestions.

---

## Capabilities

- **Autonomous Web Search Mode**: Live parallel web discovery across multiple search variations, automated background indexing, and real-time streaming synthesis via LLaMA 3.1 70B.
- **Direct Fast Search Mode**: Sub-millisecond candidate retrieval powered by FlexSearch in-memory index with multi-signal document scoring (exact phrase match, domain authority boost, term coverage, and title quality penalties).
- **Sub-Second Indexing Pipeline**: Concurrent Puppeteer spider with network-layer resource filtering, SHA-256 deduplication, and Neon Postgres persistence.
- **Interactive Concept Inspector**: Clickable code tags and technical term chips open a side drawer with live explanations and contextual reference material.
- **Zero-Throttling Streaming Pipeline**: `requestAnimationFrame` debounced rendering, zero-buffer HTTP response chunking, and lazy syntax highlighting during active streaming to maintain 60 FPS performance without CPU throttling.
- **Mobile-Responsive Layout**: Adaptive viewport positioning, virtual keyboard displacement compensation, and persistent top-bar navigation mode.

---

## Architecture

### System Flow

```mermaid
graph TD
    Browser["Client Browser (React 19 / Next.js)"]

    Browser -->|"GET /api/search?q="| SearchProxy["Search Proxy (/api/search/route.ts)"]
    Browser -->|"POST /api/ai-answer"| AIRoute["AI Agent Route (/api/ai-answer/route.ts)"]

    subgraph NextJS["Next.js Application Layer"]
        SearchProxy
        AIRoute
    end

    AIRoute -->|"Parallel Web Retrieval"| LiveWeb["DuckDuckGo / Web APIs"]
    AIRoute -->|"LLaMA 3.1 70B Instruct"| NVIDIA["NVIDIA NIM API"]
    
    SearchProxy -->|"Loopback HTTP (127.0.0.1:3001)"| ExpressServer["Express Search Server"]

    subgraph Express["Express Index & Crawl Engine (Port 3001)"]
        ExpressServer -->|"In-Memory Query"| IndexManager["FlexSearch In-Memory Index"]
        ExpressServer -->|"Crawl Jobs"| CrawlEngine["Puppeteer Crawler"]
        IndexManager -->|"Content Resolution"| ContentCache["RAM Content Cache (Map<string, string>)"]
        IndexManager -->|"Multi-Signal Scoring"| Scorer["Scoring Engine (phrase, domain boost)"]
    end

    subgraph DB["Database Layer"]
        Postgres[("Neon Postgres Serverless")]
    end

    CrawlEngine -->|"Upsert Page Records"| Postgres
    CrawlEngine -->|"Live Index Injection"| IndexManager
    Postgres -->|"Sync Index on Startup"| IndexManager
```

### Agentic Search Execution Sequence

```mermaid
sequenceDiagram
    autonumber
    actor User as User Browser
    participant API as Next.js API (/api/ai-answer)
    participant Web as Live Web Search
    participant LLM as NVIDIA NIM (LLaMA 3.1 70B)
    participant Index as In-Memory Indexer

    User->>API: POST /api/ai-answer (query, searchMode: "agentic")
    API-->>User: Stream [[STATUS: Searching the web...]]
    
    par Parallel Discovery Search
        API->>Web: Query Primary: "query"
        API->>Web: Query Variation: "query guide tutorial"
    end

    Web-->>API: Return Top Web Results
    
    Note over API: Deduplicate URLs & Build Sources Payload
    API-->>User: Stream [[SOURCES:{...}]] & [[STEP:synthesizing]]
    
    opt Non-blocking Auto Indexing
        API->>Index: Queue discovered URLs for background crawl
    end

    API->>LLM: Send system prompt + numbered sources + conversation history
    
    loop Real-time Text Streaming
        LLM-->>API: Token delta chunks
        API-->>User: HTTP chunked stream
        Note over User: rAF debounced rendering (60 FPS, 0% CPU throttle)
    end
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Framer Motion, Tailwind CSS |
| Frontend Performance | `requestAnimationFrame` render debouncing, Prism syntax highlighting deferral |
| Search Backend | Express.js, Node.js 20 |
| Local Search Index | FlexSearch (in-memory document index), Custom Scoring Engine |
| Crawler & Spider | Puppeteer, Cheerio, SHA-256 Hash Deduplication |
| Database | Neon Postgres (Serverless PostgreSQL) |
| AI Inference | LLaMA 3.1 70B Instruct via NVIDIA NIM API |
| Streaming Protocol | Vercel AI SDK (`streamText`), HTTP Chunked Transfer Encoding (`force-dynamic`) |

---

## Performance Metrics

| Operation | Latency |
|---|---|
| FlexSearch candidate retrieval | < 1 ms |
| Memory content cache lookup (`Map.get`) | < 0.1 ms |
| Multi-signal candidate scoring (40 candidates) | 1–3 ms |
| Local search pipeline end-to-end | 2–5 ms |
| Next.js proxy to Express loopback | 8–15 ms |
| Agent web search discovery | 400–900 ms |
| AI inference first-token latency | 250–500 ms |
| Frontend streaming render rate | 60 FPS (debounced) |

---

## Core Components

### 1. Agentic AI Answer Route (`client/src/app/api/ai-answer/route.ts`)

- **Dynamic Execution**: Exported as `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'` to prevent Next.js response buffering.
- **Parallel Retrieval**: Executes primary and query-variation web searches simultaneously using `Promise.all` with fail-safe fallbacks.
- **Immediate Header Emission**: Emits `[[STATUS:...]]` and `[[SOURCES:...]]` control tokens over the HTTP stream before triggering LLM generation, allowing the UI to render source cards immediately.
- **Zero-Buffer Response**: Configured with `Cache-Control: no-store`, `X-Accel-Buffering: no`, and `Transfer-Encoding: chunked`.

### 2. Frontend Trajectory Renderer (`client/src/components/search/AgentTrajectory.tsx`)

- **Frame-Rate Debouncing**: Uses `requestAnimationFrame` to batch incoming stream tokens, preventing O(n²) markdown re-parsing bottlenecks on every character delta.
- **Lazy Syntax Highlighting**: Bypasses heavy Prism.js syntax tokenization during active streaming to prevent CPU thread blocking, upgrading to full color highlighting upon completion.
- **Inline Citation Mapping**: Automatically converts `[n]` bracketed citations in LLM output into clickable markdown links pointing directly to retrieved source URLs.

### 3. Local Search Engine (`server/src/index-manager.ts`)

- **In-Memory Index**: Indexes `title`, `description`, and `source` using FlexSearch forward tokenization. Excludes heavy body text to maintain minimal memory footprint.
- **Multi-Signal Scorer**: Evaluates exact phrase matches, term occurrence counts, query coverage ratios, title quality penalties, and domain authority boosts (+50 boost for MDN, TypeScript, React, Node.js, Rust, Docker, Kubernetes, etc.).
- **Startup Sync**: `syncIndex()` loads all records from Neon Postgres on server boot in 1,000-row chunks.

### 4. Web Crawler (`server/src/crawler.ts`)

- **Network Interception**: Intercepts Puppeteer network requests to abort images, fonts, stylesheets, and media downloads, reducing bandwidth per page by ~80%.
- **Deduplication**: Checks pre-warmed URL sets and SHA-256 content hashes before writing to database.
- **Persistence**: Writes normalized page titles, descriptions, clean body text, and code snippets into Neon Postgres using `ON CONFLICT (url) DO UPDATE`.

---

## API Reference

### Express Server (Port 3001)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/search?q=<query>` | Queries the in-memory FlexSearch index and returns top scored results |
| `POST` | `/crawler/start` | Initiates a background web crawl starting from a seed URL |
| `POST` | `/crawler/reddit` | Triggers a crawl across specified subreddits |
| `POST` | `/admin/resync` | Re-synchronizes the in-memory FlexSearch index from Neon Postgres |

### Next.js API Routes (Port 3000)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/search?q=<query>` | Proxy route forwarding search requests to `127.0.0.1:3001/search` |
| `POST` | `/api/ai-answer` | Streams agentic web research or direct search answers via AI SDK |
| `GET` | `/api/status` | Returns database and index readiness status |
| `POST` | `/api/explain-term` | Generates short technical concept explanations for the side drawer |

---

## Database Schema

Database table definition in **Neon Postgres**:

```sql
CREATE TABLE IF NOT EXISTS pages (
  url TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT,
  code_snippets TEXT,
  source TEXT,
  tags TEXT,
  content_hash TEXT,
  last_crawled TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

---

## Local Development Setup

### Prerequisites

- Node.js 20+
- Neon Postgres database instance
- NVIDIA NIM API Key

### Environment Configuration

Create `.env` files in both root and `client/` directories:

```env
DATABASE_URL=postgresql://user:password@ep-example.neon.tech/dbname?sslmode=require
NVIDIA_KEY=nvapi-your-nvidia-nim-api-key
```

### Running the Application

1. **Install Root Dependencies**:
   ```bash
   npm run install:all
   ```

2. **Start Client and Server Concurrently**:
   ```bash
   npm run dev
   ```

   - **Client**: `http://localhost:3000`
   - **Express Server**: `http://localhost:3001`

3. **Build for Production**:
   ```bash
   npm run build
   ```
