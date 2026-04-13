/**
 * dev-crawl.ts
 * ─────────────────────────────────────────────────────────
 * High-quality developer search index builder.
 *
 * Per-domain limits, deduplication (URL + content hash),
 * skip rules for low-value pages, and configurable delays.
 *
 * Global limits:
 *   MAX_PAGES         = 25,000
 *   STOP_AT_DB_SIZE   = 350 MB (checked via pg size query)
 *   MAX_DEPTH         = 2
 *   MAX_LINKS/PAGE    = 20
 *   DELAY             = 1–2 seconds
 *   CONTENT_LIMIT     = 4,000 chars (enforced in crawler)
 */

import { crawl, prewarmDedup } from '../src/crawler.js';
import { syncIndex } from '../src/index-manager.js';
import { sql } from '../src/db.js';

// ─── Global Limits ───────────────────────────────────────────────────────────
const GLOBAL_MAX_PAGES = 25_000;
const STOP_AT_BYTES    = 350 * 1024 * 1024; // 350 MB
const MAX_DEPTH        = 2;
const MAX_LINKS        = 20;
const DELAY_RANGE: [number, number] = [1000, 2000];

// ─── Crawl Targets ───────────────────────────────────────────────────────────
interface CrawlTarget {
  source: string;
  limit: number;
  tags: string[];
  seeds: string[];
  concurrency?: number;
}

const TARGETS: CrawlTarget[] = [
  // ── StackOverflow (HIGH PRIORITY, 5,000) ────────────────────────────────
  {
    source: 'stackoverflow',
    limit: 5000,
    tags: ['q&a', 'debugging', 'programming'],
    concurrency: 2, // respectful of SO's servers
    seeds: [
      'https://stackoverflow.com/questions/tagged/javascript',
      'https://stackoverflow.com/questions/tagged/reactjs',
      'https://stackoverflow.com/questions/tagged/node.js',
      'https://stackoverflow.com/questions/tagged/python',
      'https://stackoverflow.com/questions/tagged/typescript',
      'https://stackoverflow.com/questions/tagged/sql',
      'https://stackoverflow.com/questions/tagged/docker',
      'https://stackoverflow.com/questions/tagged/git',
      'https://stackoverflow.com/questions/tagged/postgresql',
    ],
  },

  // ── MDN (2,000) ─────────────────────────────────────────────────────────
  {
    source: 'mdn',
    limit: 2000,
    tags: ['frontend', 'web', 'javascript', 'css', 'html', 'api'],
    seeds: [
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
      'https://developer.mozilla.org/en-US/docs/Web/API',
      'https://developer.mozilla.org/en-US/docs/Web/CSS',
      'https://developer.mozilla.org/en-US/docs/Web/HTML',
    ],
  },

  // ── React (1,000) ────────────────────────────────────────────────────────
  {
    source: 'react',
    limit: 1000,
    tags: ['react', 'frontend', 'javascript'],
    seeds: [
      'https://react.dev/learn',
      'https://react.dev/reference/react',
      'https://react.dev/reference/react-dom',
    ],
  },

  // ── Next.js (1,000) ──────────────────────────────────────────────────────
  {
    source: 'nextjs',
    limit: 1000,
    tags: ['nextjs', 'react', 'frontend', 'fullstack'],
    seeds: [
      'https://nextjs.org/docs',
      'https://nextjs.org/docs/app',
    ],
  },

  // ── Node.js (1,000) ──────────────────────────────────────────────────────
  {
    source: 'nodejs',
    limit: 1000,
    tags: ['nodejs', 'backend', 'javascript'],
    seeds: [
      'https://nodejs.org/api',
      'https://nodejs.org/en/docs',
    ],
  },

  // ── Express (800) ────────────────────────────────────────────────────────
  {
    source: 'express',
    limit: 800,
    tags: ['express', 'nodejs', 'backend', 'api'],
    seeds: [
      'https://expressjs.com/en/guide/routing.html',
      'https://expressjs.com/en/guide/middleware.html',
    ],
  },

  // ── PostgreSQL (1,000) ───────────────────────────────────────────────────
  {
    source: 'postgresql',
    limit: 1000,
    tags: ['postgresql', 'database', 'sql'],
    seeds: [
      'https://www.postgresql.org/docs/current',
      'https://www.postgresql.org/docs/current/tutorial.html',
    ],
  },

  // ── MongoDB (1,000) ──────────────────────────────────────────────────────
  {
    source: 'mongodb',
    limit: 1000,
    tags: ['mongodb', 'nosql', 'database'],
    seeds: [
      'https://www.mongodb.com/docs/manual',
      'https://www.mongodb.com/docs/drivers',
    ],
  },

  // ── Python (1,500) ───────────────────────────────────────────────────────
  {
    source: 'python',
    limit: 1500,
    tags: ['python', 'backend', 'scripting'],
    seeds: [
      'https://docs.python.org/3',
      'https://docs.python.org/3/tutorial',
      'https://pandas.pydata.org/docs',
      'https://numpy.org/doc',
    ],
  },

  // ── TypeScript (1,000) ───────────────────────────────────────────────────
  {
    source: 'typescript',
    limit: 1000,
    tags: ['typescript', 'javascript', 'types'],
    seeds: [
      'https://www.typescriptlang.org/docs',
    ],
  },

  // ── Tailwind CSS (800) ───────────────────────────────────────────────────
  {
    source: 'tailwind',
    limit: 800,
    tags: ['tailwind', 'css', 'ui', 'frontend'],
    seeds: [
      'https://tailwindcss.com/docs',
    ],
  },

  // ── Docker (800) ─────────────────────────────────────────────────────────
  {
    source: 'docker',
    limit: 800,
    tags: ['docker', 'containers', 'devops'],
    seeds: [
      'https://docs.docker.com',
    ],
  },

  // ── Kubernetes (800) ─────────────────────────────────────────────────────
  {
    source: 'kubernetes',
    limit: 800,
    tags: ['kubernetes', 'k8s', 'devops', 'containers'],
    seeds: [
      'https://kubernetes.io/docs/home',
    ],
  },

  // ── Git (800) ────────────────────────────────────────────────────────────
  {
    source: 'git',
    limit: 800,
    tags: ['git', 'version-control', 'workflow'],
    seeds: [
      'https://git-scm.com/docs',
      'https://docs.github.com/en',
    ],
  },

  // ── AI / ML ─────────────────────────────────────────────────────────────
  {
    source: 'ai-ml',
    limit: 800,
    tags: ['ai', 'ml', 'python', 'data-science'],
    seeds: [
      'https://huggingface.co/docs',
      'https://pytorch.org/docs/stable/index.html',
      'https://tensorflow.org/tutorials',
      'https://scikit-learn.org/stable',
    ],
  },

  // ── Testing (800) ────────────────────────────────────────────────────────
  {
    source: 'testing',
    limit: 800,
    tags: ['testing', 'jest', 'playwright', 'vitest'],
    seeds: [
      'https://jestjs.io/docs/getting-started',
      'https://vitest.dev/guide',
      'https://playwright.dev/docs/intro',
      'https://docs.cypress.io',
    ],
  },

  // ── CSS / UI ─────────────────────────────────────────────────────────────
  {
    source: 'css-ui',
    limit: 600,
    tags: ['css', 'ui', 'design', 'frontend'],
    seeds: [
      'https://css-tricks.com',
      'https://getbootstrap.com/docs',
    ],
  },

  // ── Tooling ──────────────────────────────────────────────────────────────
  {
    source: 'tooling',
    limit: 600,
    tags: ['build', 'bundler', 'tooling', 'developer-tools'],
    seeds: [
      'https://vitejs.dev/guide',
      'https://webpack.js.org/concepts',
      'https://rollupjs.org/introduction',
      'https://babeljs.io/docs',
      'https://eslint.org/docs/latest',
      'https://prettier.io/docs/en/index.html',
    ],
  },

  // ── DevOps / Cloud ───────────────────────────────────────────────────────
  {
    source: 'devops',
    limit: 600,
    tags: ['devops', 'cloud', 'aws', 'azure', 'gcp', 'nginx'],
    seeds: [
      'https://aws.amazon.com/blogs',
      'https://cloud.google.com/blog',
      'https://learn.microsoft.com/en-us/docs',
      'https://nginx.org/en/docs',
    ],
  },

  // ── Blogs (strict combined limit 4,000) ─────────────────────────────────
  {
    source: 'blogs',
    limit: 4000,
    tags: ['blog', 'tutorial', 'programming'],
    concurrency: 2,
    seeds: [
      'https://dev.to',
      'https://medium.com/tag/programming',
      'https://freecodecamp.org/news',
      'https://hashnode.com',
      'https://blog.logrocket.com',
      'https://smashingmagazine.com',
    ],
  },
];

// ─── DB Size check ──────────────────────────────────────────────────────────
async function getDbSizeBytes(): Promise<number> {
  try {
    const rows = await sql`SELECT pg_database_size(current_database()) AS size`;
    return Number(rows[0].size);
  } catch {
    return 0;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Developer Search Index — Batch Crawl');
  console.log(`Global cap: ${GLOBAL_MAX_PAGES.toLocaleString()} pages / ${STOP_AT_BYTES / 1024 / 1024} MB\n`);

  // Pre-warm dedup from existing DB so we never re-crawl already stored content
  await prewarmDedup();

  let totalPages = 0;

  for (const target of TARGETS) {
    // ── Global size guard ──────────────────────────────────────────────
    const dbBytes = await getDbSizeBytes();
    if (dbBytes > 0 && dbBytes >= STOP_AT_BYTES) {
      console.log(`\n⛔ DB size limit reached (${(dbBytes / 1024 / 1024).toFixed(1)} MB). Stopping.`);
      break;
    }
    if (totalPages >= GLOBAL_MAX_PAGES) {
      console.log(`\n⛔ Global page limit reached (${GLOBAL_MAX_PAGES.toLocaleString()}). Stopping.`);
      break;
    }

    const remaining = Math.min(target.limit, GLOBAL_MAX_PAGES - totalPages);
    console.log(`\n════ ${target.source.toUpperCase()} (limit: ${remaining}) ════`);

    // Split the per-domain budget across seeds proportionally
    const perSeed = Math.ceil(remaining / target.seeds.length);

    let domainPages = 0;
    for (const seed of target.seeds) {
      if (domainPages >= remaining) break;

      const seedCap = Math.min(perSeed, remaining - domainPages);
      const saved = await crawl(seed, {
        source: target.source,
        tags: target.tags,
        maxPages: seedCap,
        maxDepth: MAX_DEPTH,
        maxConcurrency: target.concurrency ?? 3,
        maxLinksPerPage: MAX_LINKS,
        sameDomainOnly: false,
        delayRange: DELAY_RANGE,
      });

      const n = saved ?? 0;
      domainPages += n;
      totalPages  += n;
    }

    console.log(`  → ${target.source} total: ${domainPages} pages`);
  }

  console.log(`\n✅ Crawl finished. Total pages indexed this run: ${totalPages}`);

  // Sync FlexSearch
  console.log('Syncing FlexSearch index...');
  await syncIndex();
  console.log('Index sync complete.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error in batch crawl:', err);
  process.exit(1);
});
