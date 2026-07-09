/**
 * local-crawl.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Crawls ALL targets into a local SQLite file (crawl-cache.sqlite).
 * ZERO connections to Neon / remote DB during this step.
 *
 * Run this script to fill up the local cache, then run push-to-cloud.ts
 * to bulk-upload everything in a single efficient Neon session.
 *
 * Usage:
 *   npx tsx --env-file=../.env scripts/local-crawl.ts
 *
 * Global limits:
 *   MAX_PAGES    = 50,000
 *   MAX_DEPTH    = 2
 *   MAX_LINKS    = 25
 *   DELAY        = 800–1500 ms
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import * as crypto from 'crypto';
import { savePageLocally, prewarmFromLocal, localPageCount, DB_PATH } from '../src/local-db.js';
import type { PageData } from '../src/crawler.js';
import { normalizeUrl } from '../src/crawler.js';

// ─── Global config ─────────────────────────────────────────────────────────
const GLOBAL_MAX   = 50_000;
const MAX_DEPTH    = 2;
const MAX_LINKS    = 25;
const DELAY_MIN    = 800;
const DELAY_MAX    = 1500;
const CONCURRENCY  = 4;

// ─── Dedup state (local only) ──────────────────────────────────────────────
const visitedUrls = new Set<string>();
const seenHashes  = new Set<string>();

function hashContent(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
const SKIP_PATTERNS = [
  '/login', '/signup', '/register', '/account', '/cart', '/checkout',
  '/feed', '/rss', '/sitemap', '/robots.txt', '/ads/', '/cdn-cgi/',
  '/privacy', '/terms', '/legal', '/jobs', '/careers',
  'stackoverflow.com/users', 'stackoverflow.com/tags?', 'stackoverflow.com/review',
  '?page=', '&page=', '/page/', 'medium.com/tag/', 'medium.com/search',
];
function shouldSkip(url: string) { return SKIP_PATTERNS.some(p => url.includes(p)); }

// ─── Crawl targets ─────────────────────────────────────────────────────────
interface Target { source: string; limit: number; tags: string[]; seeds: string[]; concurrency?: number }

const TARGETS: Target[] = [
  // Core Language Reference
  { source: 'mdn', limit: 2500, tags: ['javascript','web','css','html','api'], seeds: [
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference',
    'https://developer.mozilla.org/en-US/docs/Web/API',
    'https://developer.mozilla.org/en-US/docs/Web/CSS',
    'https://developer.mozilla.org/en-US/docs/Web/HTML',
    'https://developer.mozilla.org/en-US/docs/Web/HTTP',
  ]},
  { source: 'typescript', limit: 1200, tags: ['typescript','types'], seeds: [
    'https://www.typescriptlang.org/docs/',
    'https://www.typescriptlang.org/docs/handbook/intro.html',
    'https://www.typescriptlang.org/tsconfig',
  ]},
  { source: 'python', limit: 2000, tags: ['python','stdlib'], seeds: [
    'https://docs.python.org/3/library/',
    'https://docs.python.org/3/reference/',
    'https://docs.python.org/3/tutorial/',
    'https://docs.python.org/3/howto/',
  ]},
  { source: 'go', limit: 1200, tags: ['go','golang'], seeds: [
    'https://go.dev/doc/',
    'https://go.dev/ref/spec',
    'https://pkg.go.dev/std',
  ]},
  { source: 'rust', limit: 1200, tags: ['rust','systems'], seeds: [
    'https://doc.rust-lang.org/book/',
    'https://doc.rust-lang.org/std/',
    'https://doc.rust-lang.org/rust-by-example/',
  ]},
  { source: 'cppreference', limit: 1000, tags: ['cpp','c++','c'], seeds: [
    'https://en.cppreference.com/w/',
  ]},
  { source: 'java', limit: 1000, tags: ['java','jvm'], seeds: [
    'https://docs.oracle.com/en/java/',
    'https://docs.oracle.com/javase/tutorial/',
  ]},
  { source: 'php', limit: 800, tags: ['php','backend'], seeds: [
    'https://www.php.net/manual/en/',
  ]},
  { source: 'swift', limit: 800, tags: ['swift','ios'], seeds: [
    'https://docs.swift.org/swift-book/',
  ]},
  { source: 'kotlin', limit: 800, tags: ['kotlin','android'], seeds: [
    'https://kotlinlang.org/docs/',
  ]},

  // Frameworks
  { source: 'react', limit: 1200, tags: ['react','frontend'], seeds: [
    'https://react.dev/reference/react',
    'https://react.dev/learn',
    'https://react.dev/reference/react-dom',
  ]},
  { source: 'nextjs', limit: 1200, tags: ['nextjs','fullstack'], seeds: [
    'https://nextjs.org/docs',
    'https://nextjs.org/docs/app',
  ]},
  { source: 'nodejs', limit: 1000, tags: ['nodejs','backend'], seeds: [
    'https://nodejs.org/en/docs/',
    'https://nodejs.org/dist/latest/docs/api/',
  ]},
  { source: 'vue', limit: 800, tags: ['vue','frontend'], seeds: [
    'https://vuejs.org/guide/',
    'https://vuejs.org/api/',
  ]},
  { source: 'svelte', limit: 600, tags: ['svelte','frontend'], seeds: [
    'https://svelte.dev/docs/',
    'https://kit.svelte.dev/docs/',
  ]},
  { source: 'angular', limit: 800, tags: ['angular'], seeds: [
    'https://angular.dev/overview',
    'https://angular.dev/api',
  ]},
  { source: 'django', limit: 1000, tags: ['django','python'], seeds: [
    'https://docs.djangoproject.com/en/stable/',
  ]},
  { source: 'fastapi', limit: 600, tags: ['fastapi','python'], seeds: [
    'https://fastapi.tiangolo.com/',
  ]},
  { source: 'flask', limit: 500, tags: ['flask','python'], seeds: [
    'https://flask.palletsprojects.com/',
  ]},
  { source: 'nestjs', limit: 800, tags: ['nestjs','typescript'], seeds: [
    'https://docs.nestjs.com/',
  ]},
  { source: 'fastify', limit: 500, tags: ['fastify','nodejs'], seeds: [
    'https://fastify.dev/docs/latest/',
  ]},
  { source: 'remix', limit: 600, tags: ['remix','react'], seeds: [
    'https://remix.run/docs/en/main',
  ]},
  { source: 'astro', limit: 600, tags: ['astro'], seeds: [
    'https://docs.astro.build/en/getting-started/',
  ]},
  { source: 'rails', limit: 600, tags: ['rails','ruby'], seeds: [
    'https://guides.rubyonrails.org/',
  ]},
  { source: 'spring', limit: 700, tags: ['spring','java'], seeds: [
    'https://spring.io/guides',
    'https://docs.spring.io/spring-boot/docs/current/reference/html/',
  ]},

  // Databases & ORM
  { source: 'postgresql', limit: 1200, tags: ['postgresql','sql'], seeds: [
    'https://www.postgresql.org/docs/current/',
    'https://www.postgresql.org/docs/current/sql.html',
  ]},
  { source: 'mysql', limit: 700, tags: ['mysql','sql'], seeds: [
    'https://dev.mysql.com/doc/refman/8.0/en/',
  ]},
  { source: 'mongodb', limit: 800, tags: ['mongodb','nosql'], seeds: [
    'https://www.mongodb.com/docs/manual',
    'https://www.mongodb.com/docs/drivers',
  ]},
  { source: 'redis', limit: 600, tags: ['redis','cache'], seeds: [
    'https://redis.io/docs/',
  ]},
  { source: 'sqlite', limit: 400, tags: ['sqlite','database'], seeds: [
    'https://sqlite.org/docs.html',
  ]},
  { source: 'prisma', limit: 700, tags: ['prisma','orm'], seeds: [
    'https://www.prisma.io/docs/',
  ]},
  { source: 'drizzle', limit: 400, tags: ['drizzle','orm'], seeds: [
    'https://orm.drizzle.team/docs/',
  ]},
  { source: 'supabase', limit: 500, tags: ['supabase','database'], seeds: [
    'https://supabase.com/docs',
  ]},

  // DevOps & Cloud
  { source: 'docker', limit: 800, tags: ['docker','devops'], seeds: [
    'https://docs.docker.com/',
    'https://docs.docker.com/compose/',
  ]},
  { source: 'kubernetes', limit: 800, tags: ['kubernetes','k8s'], seeds: [
    'https://kubernetes.io/docs/concepts/',
    'https://kubernetes.io/docs/tasks/',
  ]},
  { source: 'git', limit: 600, tags: ['git','vcs'], seeds: [
    'https://git-scm.com/docs',
    'https://git-scm.com/book/en/v2',
  ]},
  { source: 'github', limit: 700, tags: ['github','ci'], seeds: [
    'https://docs.github.com/en',
    'https://docs.github.com/en/actions',
  ]},
  { source: 'linux', limit: 800, tags: ['linux','bash','shell'], seeds: [
    'https://man7.org/linux/man-pages/',
    'https://www.gnu.org/software/bash/manual/bash.html',
  ]},
  { source: 'nginx', limit: 400, tags: ['nginx','devops'], seeds: [
    'https://nginx.org/en/docs/',
  ]},
  { source: 'aws', limit: 1000, tags: ['aws','cloud'], seeds: [
    'https://docs.aws.amazon.com/lambda/',
    'https://docs.aws.amazon.com/ec2/',
    'https://docs.aws.amazon.com/s3/',
    'https://docs.aws.amazon.com/iam/',
  ]},
  { source: 'vercel', limit: 400, tags: ['vercel','deployment'], seeds: [
    'https://vercel.com/docs',
  ]},
  { source: 'netlify', limit: 300, tags: ['netlify','deployment'], seeds: [
    'https://docs.netlify.com/',
  ]},

  // Build tools & Testing
  { source: 'vite', limit: 500, tags: ['vite','build'], seeds: [
    'https://vitejs.dev/guide/',
    'https://vitejs.dev/config/',
  ]},
  { source: 'webpack', limit: 500, tags: ['webpack','build'], seeds: [
    'https://webpack.js.org/concepts/',
    'https://webpack.js.org/configuration/',
  ]},
  { source: 'eslint', limit: 400, tags: ['eslint','linting'], seeds: [
    'https://eslint.org/docs/latest/',
  ]},
  { source: 'jest', limit: 500, tags: ['jest','testing'], seeds: [
    'https://jestjs.io/docs/getting-started',
  ]},
  { source: 'vitest', limit: 400, tags: ['vitest','testing'], seeds: [
    'https://vitest.dev/guide/',
  ]},
  { source: 'playwright', limit: 500, tags: ['playwright','e2e'], seeds: [
    'https://playwright.dev/docs/intro',
  ]},

  // CSS & UI
  { source: 'tailwind', limit: 700, tags: ['tailwind','css'], seeds: [
    'https://tailwindcss.com/docs/',
  ]},
  { source: 'bootstrap', limit: 500, tags: ['bootstrap','css'], seeds: [
    'https://getbootstrap.com/docs/5.3/',
  ]},
  { source: 'shadcn', limit: 300, tags: ['shadcn','react','ui'], seeds: [
    'https://ui.shadcn.com/docs',
  ]},
  { source: 'mui', limit: 500, tags: ['mui','react','ui'], seeds: [
    'https://mui.com/material-ui/getting-started/',
  ]},

  // State, Auth, API
  { source: 'redux', limit: 400, tags: ['redux','state'], seeds: [
    'https://redux-toolkit.js.org/introduction/getting-started',
  ]},
  { source: 'tanstack', limit: 500, tags: ['react-query','tanstack'], seeds: [
    'https://tanstack.com/query/latest/docs/',
  ]},
  { source: 'trpc', limit: 400, tags: ['trpc','typescript'], seeds: [
    'https://trpc.io/docs/',
  ]},
  { source: 'graphql', limit: 400, tags: ['graphql','api'], seeds: [
    'https://graphql.org/learn/',
  ]},
  { source: 'stripe', limit: 500, tags: ['stripe','payments'], seeds: [
    'https://docs.stripe.com/',
  ]},
  { source: 'reactnative', limit: 700, tags: ['react-native','mobile'], seeds: [
    'https://reactnative.dev/docs/getting-started',
  ]},

  // AI/ML
  { source: 'pytorch', limit: 700, tags: ['pytorch','ml'], seeds: [
    'https://pytorch.org/docs/stable/',
  ]},
  { source: 'tensorflow', limit: 600, tags: ['tensorflow','ml'], seeds: [
    'https://www.tensorflow.org/api_docs/python/tf',
  ]},
  { source: 'huggingface', limit: 600, tags: ['huggingface','nlp','ai'], seeds: [
    'https://huggingface.co/docs/transformers/',
  ]},
  { source: 'openai', limit: 400, tags: ['openai','ai','api'], seeds: [
    'https://platform.openai.com/docs/',
  ]},

  // Security & Web Standards
  { source: 'owasp', limit: 400, tags: ['security','owasp'], seeds: [
    'https://cheatsheetseries.owasp.org/',
  ]},
  { source: 'webdev', limit: 600, tags: ['performance','webdev'], seeds: [
    'https://web.dev/learn/',
    'https://web.dev/articles/',
  ]},

  // Tutorials & Blogs
  { source: 'javascript-info', limit: 600, tags: ['javascript','tutorial'], seeds: [
    'https://javascript.info/',
  ]},
  { source: 'freecodecamp', limit: 600, tags: ['tutorial','learn'], seeds: [
    'https://www.freecodecamp.org/news/',
  ]},
  { source: 'digitalocean', limit: 600, tags: ['tutorial','devops'], seeds: [
    'https://www.digitalocean.com/community/tutorials',
  ]},
  { source: 'refactoring-guru', limit: 400, tags: ['design-patterns'], seeds: [
    'https://refactoring.guru/design-patterns',
  ]},
  { source: 'patterns', limit: 300, tags: ['patterns','javascript'], seeds: [
    'https://www.patterns.dev/',
  ]},
  { source: 'geeksforgeeks', limit: 800, tags: ['dsa','algorithms'], seeds: [
    'https://www.geeksforgeeks.org/data-structures/',
    'https://www.geeksforgeeks.org/fundamentals-of-algorithms/',
  ]},
  { source: 'css-tricks', limit: 400, tags: ['css','tricks'], seeds: [
    'https://css-tricks.com/',
  ]},
  { source: 'logrocket', limit: 400, tags: ['blog','react'], seeds: [
    'https://blog.logrocket.com/',
  ]},
  { source: 'realpython', limit: 400, tags: ['python','tutorial'], seeds: [
    'https://realpython.com/',
  ]},

  // StackOverflow (top-voted, depth=1 only)
  { source: 'stackoverflow', limit: 2000, concurrency: 2, tags: ['q&a','debugging'], seeds: [
    'https://stackoverflow.com/questions/tagged/javascript?tab=votes',
    'https://stackoverflow.com/questions/tagged/typescript?tab=votes',
    'https://stackoverflow.com/questions/tagged/python?tab=votes',
    'https://stackoverflow.com/questions/tagged/reactjs?tab=votes',
    'https://stackoverflow.com/questions/tagged/node.js?tab=votes',
    'https://stackoverflow.com/questions/tagged/next.js?tab=votes',
    'https://stackoverflow.com/questions/tagged/sql?tab=votes',
    'https://stackoverflow.com/questions/tagged/css?tab=votes',
    'https://stackoverflow.com/questions/tagged/git?tab=votes',
    'https://stackoverflow.com/questions/tagged/docker?tab=votes',
    'https://stackoverflow.com/questions/tagged/go?tab=votes',
    'https://stackoverflow.com/questions/tagged/rust?tab=votes',
    'https://stackoverflow.com/questions/tagged/regex?tab=votes',
    'https://stackoverflow.com/questions/tagged/async-await?tab=votes',
    'https://stackoverflow.com/questions/tagged/api?tab=votes',
    'https://stackoverflow.com/questions/tagged/linux?tab=votes',
    'https://stackoverflow.com/questions/tagged/bash?tab=votes',
    'https://stackoverflow.com/questions/tagged/aws?tab=votes',
    'https://stackoverflow.com/questions/tagged/php?tab=votes',
    'https://stackoverflow.com/questions/tagged/java?tab=votes',
  ]},
];

// ─── Core crawl logic (writes to SQLite only) ──────────────────────────────

async function crawlToLocal(
  seedUrl: string,
  opts: { source: string; tags: string[]; maxPages: number; maxDepth?: number; concurrency?: number }
) {
  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  const concurrency = opts.concurrency ?? CONCURRENCY;
  const tagsStr = opts.tags.join(',');

  let origin: string;
  try { origin = new URL(seedUrl).origin; } catch { console.error('Bad URL:', seedUrl); return 0; }

  const queue: { url: string; depth: number }[] = [{ url: normalizeUrl(seedUrl), depth: 0 }];
  let done = 0;
  let active = 0;

  console.log(`  🌐 [${opts.source}] ${seedUrl} (cap: ${opts.maxPages})`);

  const browser: Browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process'],
  });

  while ((queue.length > 0 || active > 0) && done < opts.maxPages) {
    if (active >= concurrency || queue.length === 0) { await delay(60); continue; }

    const item = queue.shift()!;
    const norm = normalizeUrl(item.url);
    if (visitedUrls.has(norm) || item.depth > maxDepth || shouldSkip(norm)) { visitedUrls.add(norm); continue; }
    visitedUrls.add(norm);
    active++;

    (async () => {
      let pg: Page | null = null;
      try {
        pg = await browser.newPage();
        await pg.setRequestInterception(true);
        pg.on('request', r => {
          if (['image','stylesheet','font','media','ping','websocket'].includes(r.resourceType())) r.abort();
          else r.continue();
        });
        await pg.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 18000 });
        const html = await pg.content();
        const $ = cheerio.load(html);
        $('nav,footer,aside,script,style,noscript,svg,iframe,header,[role="navigation"],.sidebar,.ads,.cookie-banner').remove();

        const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';
        const description = $('meta[name="description"]').attr('content')?.trim() ?? '';
        const codeChunks: string[] = [];
        $('pre, code').each((_, el) => { const t = $(el).text().trim(); if (t.length > 10) codeChunks.push(t); $(el).remove(); });
        const codeSnippets = codeChunks.join('\n\n').slice(0, 5000);

        let main = $('main, article, [role="main"], .content, .docs-content, #content, #main').first();
        if (!main.length) main = $('body');
        const text = main.text().replace(/\s+/g, ' ').trim().slice(0, 4000);
        if (text.length < 80) return;

        const hash = hashContent(text + title);
        if (seenHashes.has(hash)) return;
        seenHashes.add(hash);

        const pageData: PageData = {
          url: item.url, title, description, content: text,
          codeSnippets, source: opts.source, tags: tagsStr,
          contentHash: hash, lastCrawled: new Date().toISOString(),
        };

        savePageLocally(pageData);
        done++;
        if (done % 50 === 0 || done <= 5) {
          console.log(`    ✓ [${done}/${opts.maxPages}] ${opts.source} — ${title.slice(0, 60)}`);
        }

        if (item.depth < maxDepth) {
          let added = 0;
          $('a[href]').each((_, el) => {
            if (added >= MAX_LINKS) return false;
            const href = $(el).attr('href');
            if (!href) return;
            let abs: string;
            try { abs = new URL(href.split('#')[0], item.url).href; } catch { return; }
            const n = normalizeUrl(abs);
            if (visitedUrls.has(n) || shouldSkip(n)) return;
            queue.push({ url: abs, depth: item.depth + 1 });
            added++;
          });
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (!msg.includes('Timeout') && !msg.includes('Navigation') && !msg.includes('detach')) {
          console.warn(`    ✗ ${item.url.slice(0, 80)}: ${msg.slice(0, 60)}`);
        }
      } finally {
        if (pg) await pg.close().catch(() => {});
        await delay(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN));
        active--;
      }
    })();
  }

  while (active > 0) await delay(150);
  await browser.close();
  return done;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🗄️  LOCAL CRAWL — writing to SQLite (zero Neon calls)');
  console.log(`📁  Cache file: ${DB_PATH}`);
  console.log(`🎯  Targets: ${TARGETS.length} sources | Global cap: ${GLOBAL_MAX.toLocaleString()} pages\n`);

  // Pre-warm from existing SQLite data to avoid re-crawling
  prewarmFromLocal(visitedUrls, seenHashes);
  const existing = localPageCount();
  console.log(`📊  Pages already in local cache: ${existing.toLocaleString()}\n`);

  let totalSaved = 0;

  for (const target of TARGETS) {
    if (totalSaved >= GLOBAL_MAX) { console.log('\n⛔ Global cap reached.'); break; }
    const remaining = Math.min(target.limit, GLOBAL_MAX - totalSaved);
    console.log(`\n════ ${target.source.toUpperCase()} (budget: ${remaining}) ════`);
    const perSeed = Math.ceil(remaining / target.seeds.length);
    let domainTotal = 0;

    for (const seed of target.seeds) {
      if (domainTotal >= remaining) break;
      const cap = Math.min(perSeed, remaining - domainTotal);
      const saved = await crawlToLocal(seed, {
        source: target.source,
        tags: target.tags,
        maxPages: cap,
        concurrency: target.concurrency,
      });
      domainTotal += saved;
      totalSaved  += saved;
    }
    console.log(`  → ${target.source}: ${domainTotal} pages saved this run`);
  }

  const final = localPageCount();
  console.log(`\n✅ Local crawl complete!`);
  console.log(`   Pages saved this run : ${totalSaved.toLocaleString()}`);
  console.log(`   Total in local cache : ${final.toLocaleString()}`);
  console.log(`\n👉 Run push-to-cloud.ts to upload everything to Neon.`);
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
