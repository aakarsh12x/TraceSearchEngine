/**
 * mega-crawl.ts
 * Exhaustive developer-focused crawl with 350 MB hard cap.
 * Organized by priority tiers — runs highest value first.
 */

import { crawl } from '../src/crawler.js';
import { sql } from '../src/db.js';

// ─── Config ───────────────────────────────────────────────────────────────────
const MAX_DB_MB      = 330;   // stop at 330 MB (leave headroom before 350 MB cap)
const CHECK_INTERVAL = 5;     // check DB size every N domains

async function getDbMB(): Promise<number> {
  const rows = await sql`SELECT pg_database_size(current_database()) AS size`;
  return Number(rows[0].size) / (1024 * 1024);
}

// ─── Seed Catalogue ───────────────────────────────────────────────────────────
// Format: { url, source, pages, depth, tags? }
// pages = maxPages per seed, depth = maxDepth

const SEEDS: Array<{ url: string; source: string; pages: number; depth: number; tags?: string[] }> = [

  // ══════════════════════════════════════════════════════════════════
  // TIER 1 — Core Reference Docs (highest search value)
  // ══════════════════════════════════════════════════════════════════

  // JavaScript / Web APIs
  { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',              source: 'mdn',        pages: 300, depth: 2, tags: ['javascript','mdn'] },
  { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference',    source: 'mdn',        pages: 300, depth: 2, tags: ['javascript','reference'] },
  { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide',        source: 'mdn',        pages: 120, depth: 2, tags: ['javascript','guide'] },
  { url: 'https://developer.mozilla.org/en-US/docs/Web/API',                     source: 'mdn',        pages: 200, depth: 2, tags: ['webapi','mdn'] },
  { url: 'https://developer.mozilla.org/en-US/docs/Web/HTML',                    source: 'mdn',        pages: 150, depth: 2, tags: ['html','mdn'] },
  { url: 'https://developer.mozilla.org/en-US/docs/Web/CSS',                     source: 'mdn',        pages: 150, depth: 2, tags: ['css','mdn'] },
  { url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP',                    source: 'mdn',        pages: 80,  depth: 2, tags: ['http','mdn'] },
  { url: 'https://developer.mozilla.org/en-US/docs/Learn',                       source: 'mdn',        pages: 100, depth: 2, tags: ['learn','mdn'] },

  // TypeScript
  { url: 'https://www.typescriptlang.org/docs/',                                 source: 'typescript', pages: 200, depth: 2, tags: ['typescript'] },
  { url: 'https://www.typescriptlang.org/tsconfig',                              source: 'typescript', pages: 60,  depth: 2, tags: ['typescript','config'] },
  { url: 'https://www.typescriptlang.org/docs/handbook/intro.html',              source: 'typescript', pages: 100, depth: 2, tags: ['typescript','handbook'] },

  // Node.js
  { url: 'https://nodejs.org/en/docs/',                                          source: 'nodejs',     pages: 200, depth: 2, tags: ['nodejs'] },
  { url: 'https://nodejs.org/dist/latest/docs/api/',                             source: 'nodejs',     pages: 150, depth: 2, tags: ['nodejs','api'] },
  { url: 'https://nodejs.org/en/learn/',                                         source: 'nodejs',     pages: 80,  depth: 2, tags: ['nodejs','learn'] },

  // React
  { url: 'https://react.dev/reference/react',                                    source: 'react',      pages: 150, depth: 2, tags: ['react','api'] },
  { url: 'https://react.dev/learn',                                              source: 'react',      pages: 120, depth: 2, tags: ['react','learn'] },
  { url: 'https://react.dev/reference/react-dom',                                source: 'react',      pages: 60,  depth: 2, tags: ['react','dom'] },
  { url: 'https://react.dev/reference/react-dom/hooks',                          source: 'react',      pages: 60,  depth: 2, tags: ['react','hooks'] },

  // Next.js
  { url: 'https://nextjs.org/docs',                                              source: 'nextjs',     pages: 250, depth: 2, tags: ['nextjs'] },
  { url: 'https://nextjs.org/docs/app',                                          source: 'nextjs',     pages: 150, depth: 2, tags: ['nextjs','app-router'] },
  { url: 'https://nextjs.org/docs/pages',                                        source: 'nextjs',     pages: 80,  depth: 2, tags: ['nextjs','pages-router'] },
  { url: 'https://nextjs.org/blog',                                              source: 'nextjs',     pages: 50,  depth: 1, tags: ['nextjs','blog'] },

  // Python
  { url: 'https://docs.python.org/3/library/',                                   source: 'python',     pages: 250, depth: 2, tags: ['python','stdlib'] },
  { url: 'https://docs.python.org/3/reference/',                                 source: 'python',     pages: 100, depth: 2, tags: ['python','reference'] },
  { url: 'https://docs.python.org/3/tutorial/',                                  source: 'python',     pages: 80,  depth: 2, tags: ['python','tutorial'] },
  { url: 'https://docs.python.org/3/howto/',                                     source: 'python',     pages: 60,  depth: 2, tags: ['python','howto'] },

  // Go
  { url: 'https://go.dev/doc/',                                                  source: 'go',         pages: 150, depth: 2, tags: ['go','golang'] },
  { url: 'https://go.dev/ref/spec',                                              source: 'go',         pages: 60,  depth: 2, tags: ['go','spec'] },
  { url: 'https://pkg.go.dev/std',                                               source: 'go',         pages: 100, depth: 2, tags: ['go','stdlib'] },
  { url: 'https://go.dev/tour/welcome/1',                                        source: 'go',         pages: 80,  depth: 2, tags: ['go','tour'] },

  // Rust
  { url: 'https://doc.rust-lang.org/book/',                                      source: 'rust',       pages: 150, depth: 2, tags: ['rust','book'] },
  { url: 'https://doc.rust-lang.org/std/',                                       source: 'rust',       pages: 120, depth: 2, tags: ['rust','std'] },
  { url: 'https://doc.rust-lang.org/rust-by-example/',                           source: 'rust',       pages: 80,  depth: 2, tags: ['rust','examples'] },
  { url: 'https://doc.rust-lang.org/reference/',                                 source: 'rust',       pages: 80,  depth: 2, tags: ['rust','reference'] },

  // ══════════════════════════════════════════════════════════════════
  // TIER 2 — Framework & Library Docs
  // ══════════════════════════════════════════════════════════════════

  // Vue / Nuxt
  { url: 'https://vuejs.org/guide/',                                             source: 'vue',        pages: 120, depth: 2, tags: ['vue'] },
  { url: 'https://vuejs.org/api/',                                               source: 'vue',        pages: 80,  depth: 2, tags: ['vue','api'] },
  { url: 'https://nuxt.com/docs',                                                source: 'nuxt',       pages: 150, depth: 2, tags: ['nuxt','vue'] },

  // Svelte / SvelteKit
  { url: 'https://svelte.dev/docs/',                                             source: 'svelte',     pages: 100, depth: 2, tags: ['svelte'] },
  { url: 'https://kit.svelte.dev/docs/',                                         source: 'sveltekit',  pages: 100, depth: 2, tags: ['sveltekit','svelte'] },

  // Angular
  { url: 'https://angular.dev/overview',                                         source: 'angular',    pages: 150, depth: 2, tags: ['angular'] },
  { url: 'https://angular.dev/api',                                              source: 'angular',    pages: 80,  depth: 2, tags: ['angular','api'] },

  // Remix / Astro / Qwik
  { url: 'https://remix.run/docs/en/main',                                       source: 'remix',      pages: 100, depth: 2, tags: ['remix','react'] },
  { url: 'https://docs.astro.build/en/getting-started/',                         source: 'astro',      pages: 100, depth: 2, tags: ['astro'] },
  { url: 'https://qwik.dev/docs/',                                               source: 'qwik',       pages: 80,  depth: 2, tags: ['qwik'] },

  // Express / Fastify / NestJS / Hono
  { url: 'https://expressjs.com/en/4x/api.html',                                 source: 'express',    pages: 60,  depth: 2, tags: ['express','nodejs'] },
  { url: 'https://fastify.dev/docs/latest/',                                     source: 'fastify',    pages: 80,  depth: 2, tags: ['fastify','nodejs'] },
  { url: 'https://docs.nestjs.com/',                                             source: 'nestjs',     pages: 150, depth: 2, tags: ['nestjs','typescript'] },
  { url: 'https://hono.dev/docs/',                                               source: 'hono',       pages: 60,  depth: 2, tags: ['hono','nodejs'] },

  // Django / FastAPI / Flask
  { url: 'https://docs.djangoproject.com/en/stable/',                            source: 'django',     pages: 200, depth: 2, tags: ['django','python'] },
  { url: 'https://fastapi.tiangolo.com/',                                        source: 'fastapi',    pages: 100, depth: 2, tags: ['fastapi','python'] },
  { url: 'https://flask.palletsprojects.com/',                                   source: 'flask',      pages: 80,  depth: 2, tags: ['flask','python'] },

  // Spring / Quarkus (Java/Kotlin)
  { url: 'https://spring.io/guides',                                             source: 'spring',     pages: 100, depth: 2, tags: ['spring','java'] },
  { url: 'https://docs.spring.io/spring-boot/docs/current/reference/html/',      source: 'spring',     pages: 120, depth: 2, tags: ['spring-boot','java'] },
  { url: 'https://quarkus.io/guides/',                                           source: 'quarkus',    pages: 80,  depth: 2, tags: ['quarkus','java'] },
  { url: 'https://kotlinlang.org/docs/',                                         source: 'kotlin',     pages: 120, depth: 2, tags: ['kotlin'] },

  // Ruby / Rails
  { url: 'https://guides.rubyonrails.org/',                                      source: 'rails',      pages: 120, depth: 2, tags: ['rails','ruby'] },
  { url: 'https://ruby-doc.org/core/',                                           source: 'ruby',       pages: 80,  depth: 1, tags: ['ruby'] },

  // GraphQL
  { url: 'https://graphql.org/learn/',                                           source: 'graphql',    pages: 60,  depth: 2, tags: ['graphql'] },
  { url: 'https://graphql.org/graphql-js/',                                      source: 'graphql',    pages: 40,  depth: 2, tags: ['graphql','js'] },

  // ══════════════════════════════════════════════════════════════════
  // TIER 3 — Database & ORM Docs
  // ══════════════════════════════════════════════════════════════════

  { url: 'https://www.postgresql.org/docs/current/',                             source: 'postgresql', pages: 200, depth: 2, tags: ['postgresql','database'] },
  { url: 'https://www.postgresql.org/docs/current/sql.html',                     source: 'postgresql', pages: 80,  depth: 2, tags: ['postgresql','sql'] },
  { url: 'https://dev.mysql.com/doc/refman/8.0/en/',                             source: 'mysql',      pages: 100, depth: 2, tags: ['mysql','database'] },
  { url: 'https://www.mongodb.com/docs/',                                        source: 'mongodb',    pages: 150, depth: 2, tags: ['mongodb','database'] },
  { url: 'https://redis.io/docs/',                                               source: 'redis',      pages: 100, depth: 2, tags: ['redis','database'] },
  { url: 'https://sqlite.org/docs.html',                                         source: 'sqlite',     pages: 60,  depth: 2, tags: ['sqlite','database'] },
  { url: 'https://www.prisma.io/docs/',                                          source: 'prisma',     pages: 150, depth: 2, tags: ['prisma','orm'] },
  { url: 'https://orm.drizzle.team/docs/',                                       source: 'drizzle',    pages: 80,  depth: 2, tags: ['drizzle','orm'] },
  { url: 'https://sequelize.org/docs/v6/',                                       source: 'sequelize',  pages: 80,  depth: 2, tags: ['sequelize','orm'] },
  { url: 'https://typeorm.io/',                                                  source: 'typeorm',    pages: 80,  depth: 2, tags: ['typeorm','orm'] },
  { url: 'https://supabase.com/docs',                                            source: 'supabase',   pages: 100, depth: 2, tags: ['supabase','database'] },

  // ══════════════════════════════════════════════════════════════════
  // TIER 4 — DevOps, Cloud & Infrastructure
  // ══════════════════════════════════════════════════════════════════

  { url: 'https://docs.docker.com/',                                             source: 'docker',     pages: 150, depth: 2, tags: ['docker','devops'] },
  { url: 'https://docs.docker.com/compose/',                                     source: 'docker',     pages: 60,  depth: 2, tags: ['docker-compose','devops'] },
  { url: 'https://kubernetes.io/docs/concepts/',                                 source: 'kubernetes', pages: 150, depth: 2, tags: ['kubernetes','devops'] },
  { url: 'https://kubernetes.io/docs/tasks/',                                    source: 'kubernetes', pages: 100, depth: 2, tags: ['kubernetes','tasks'] },
  { url: 'https://kubernetes.io/docs/reference/',                                source: 'kubernetes', pages: 80,  depth: 2, tags: ['kubernetes','reference'] },
  { url: 'https://git-scm.com/docs',                                             source: 'git',        pages: 80,  depth: 2, tags: ['git'] },
  { url: 'https://git-scm.com/book/en/v2',                                      source: 'git',        pages: 80,  depth: 2, tags: ['git','book'] },
  { url: 'https://docs.github.com/en',                                           source: 'github',     pages: 150, depth: 2, tags: ['github','git'] },
  { url: 'https://docs.github.com/en/actions',                                   source: 'github',     pages: 100, depth: 2, tags: ['github-actions','ci-cd'] },
  { url: 'https://nginx.org/en/docs/',                                           source: 'nginx',      pages: 80,  depth: 2, tags: ['nginx','devops'] },
  { url: 'https://vercel.com/docs',                                              source: 'vercel',     pages: 80,  depth: 2, tags: ['vercel','deployment'] },
  { url: 'https://railway.app/docs',                                             source: 'railway',    pages: 40,  depth: 2, tags: ['railway','deployment'] },
  { url: 'https://docs.netlify.com/',                                            source: 'netlify',    pages: 60,  depth: 2, tags: ['netlify','deployment'] },

  // AWS (selective — avoid billing noise)
  { url: 'https://docs.aws.amazon.com/lambda/',                                  source: 'aws',        pages: 80,  depth: 2, tags: ['aws','lambda','serverless'] },
  { url: 'https://docs.aws.amazon.com/ec2/',                                     source: 'aws',        pages: 60,  depth: 1, tags: ['aws','ec2'] },
  { url: 'https://docs.aws.amazon.com/s3/',                                      source: 'aws',        pages: 60,  depth: 1, tags: ['aws','s3'] },

  // ══════════════════════════════════════════════════════════════════
  // TIER 5 — Build Tools, Bundlers, Linters, Testing
  // ══════════════════════════════════════════════════════════════════

  { url: 'https://vitejs.dev/guide/',                                            source: 'vite',       pages: 80,  depth: 2, tags: ['vite','build'] },
  { url: 'https://vitejs.dev/config/',                                           source: 'vite',       pages: 60,  depth: 2, tags: ['vite','config'] },
  { url: 'https://webpack.js.org/concepts/',                                     source: 'webpack',    pages: 80,  depth: 2, tags: ['webpack','build'] },
  { url: 'https://webpack.js.org/configuration/',                                source: 'webpack',    pages: 60,  depth: 2, tags: ['webpack','config'] },
  { url: 'https://babeljs.io/docs/',                                             source: 'babel',      pages: 60,  depth: 2, tags: ['babel','transpiler'] },
  { url: 'https://eslint.org/docs/latest/',                                      source: 'eslint',     pages: 80,  depth: 2, tags: ['eslint','linting'] },
  { url: 'https://prettier.io/docs/en/',                                         source: 'prettier',   pages: 40,  depth: 2, tags: ['prettier','formatting'] },
  { url: 'https://jestjs.io/docs/getting-started',                               source: 'jest',       pages: 80,  depth: 2, tags: ['jest','testing'] },
  { url: 'https://vitest.dev/guide/',                                            source: 'vitest',     pages: 60,  depth: 2, tags: ['vitest','testing'] },
  { url: 'https://playwright.dev/docs/intro',                                    source: 'playwright', pages: 80,  depth: 2, tags: ['playwright','testing','e2e'] },
  { url: 'https://testing-library.com/docs/',                                    source: 'testing-lib',pages: 60,  depth: 2, tags: ['testing-library','testing'] },

  // ══════════════════════════════════════════════════════════════════
  // TIER 6 — CSS Frameworks & UI Libraries
  // ══════════════════════════════════════════════════════════════════

  { url: 'https://tailwindcss.com/docs/',                                        source: 'tailwind',   pages: 120, depth: 2, tags: ['tailwind','css'] },
  { url: 'https://getbootstrap.com/docs/5.3/',                                   source: 'bootstrap',  pages: 80,  depth: 2, tags: ['bootstrap','css'] },
  { url: 'https://mui.com/material-ui/getting-started/',                         source: 'mui',        pages: 100, depth: 2, tags: ['mui','react','ui'] },
  { url: 'https://ui.shadcn.com/docs',                                           source: 'shadcn',     pages: 60,  depth: 2, tags: ['shadcn','react','ui'] },
  { url: 'https://www.radix-ui.com/docs/primitives/overview/introduction',       source: 'radix',      pages: 60,  depth: 2, tags: ['radix','react','ui'] },
  { url: 'https://chakra-ui.com/docs/getting-started',                           source: 'chakra',     pages: 80,  depth: 2, tags: ['chakra','react','ui'] },
  { url: 'https://sass-lang.com/documentation/',                                 source: 'sass',       pages: 60,  depth: 2, tags: ['sass','css'] },

  // ══════════════════════════════════════════════════════════════════
  // TIER 7 — State Mgmt, Data Fetching, Auth
  // ══════════════════════════════════════════════════════════════════

  { url: 'https://redux-toolkit.js.org/introduction/getting-started',            source: 'redux',      pages: 80,  depth: 2, tags: ['redux','state'] },
  { url: 'https://zustand-demo.pmnd.rs/',                                        source: 'zustand',    pages: 30,  depth: 2, tags: ['zustand','state'] },
  { url: 'https://tanstack.com/query/latest/docs/',                              source: 'tanstack',   pages: 100, depth: 2, tags: ['react-query','tanstack'] },
  { url: 'https://trpc.io/docs/',                                                source: 'trpc',       pages: 80,  depth: 2, tags: ['trpc','typescript','api'] },
  { url: 'https://zod.dev/',                                                     source: 'zod',        pages: 40,  depth: 2, tags: ['zod','validation','typescript'] },
  { url: 'https://authjs.dev/getting-started',                                   source: 'authjs',     pages: 60,  depth: 2, tags: ['auth','nextjs'] },
  { url: 'https://clerk.com/docs',                                               source: 'clerk',      pages: 60,  depth: 2, tags: ['auth','clerk'] },
  { url: 'https://www.apollographql.com/docs/',                                  source: 'apollo',     pages: 100, depth: 2, tags: ['apollo','graphql'] },

  // ══════════════════════════════════════════════════════════════════
  // TIER 8 — Q&A & Stack Overflow (very high value)
  // ══════════════════════════════════════════════════════════════════

  { url: 'https://stackoverflow.com/questions/tagged/javascript?tab=votes',      source: 'stackoverflow', pages: 200, depth: 1, tags: ['javascript','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/typescript?tab=votes',      source: 'stackoverflow', pages: 150, depth: 1, tags: ['typescript','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/python?tab=votes',          source: 'stackoverflow', pages: 150, depth: 1, tags: ['python','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/reactjs?tab=votes',         source: 'stackoverflow', pages: 150, depth: 1, tags: ['react','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/node.js?tab=votes',         source: 'stackoverflow', pages: 100, depth: 1, tags: ['nodejs','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/next.js?tab=votes',         source: 'stackoverflow', pages: 100, depth: 1, tags: ['nextjs','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/sql?tab=votes',             source: 'stackoverflow', pages: 100, depth: 1, tags: ['sql','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/css?tab=votes',             source: 'stackoverflow', pages: 80,  depth: 1, tags: ['css','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/git?tab=votes',             source: 'stackoverflow', pages: 80,  depth: 1, tags: ['git','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/docker?tab=votes',          source: 'stackoverflow', pages: 80,  depth: 1, tags: ['docker','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/go?tab=votes',              source: 'stackoverflow', pages: 80,  depth: 1, tags: ['go','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/rust?tab=votes',            source: 'stackoverflow', pages: 80,  depth: 1, tags: ['rust','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/regex?tab=votes',           source: 'stackoverflow', pages: 60,  depth: 1, tags: ['regex','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/algorithm?tab=votes',       source: 'stackoverflow', pages: 60,  depth: 1, tags: ['algorithm','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/async-await?tab=votes',     source: 'stackoverflow', pages: 60,  depth: 1, tags: ['async','stackoverflow'] },
  { url: 'https://stackoverflow.com/questions/tagged/api?tab=votes',             source: 'stackoverflow', pages: 60,  depth: 1, tags: ['api','stackoverflow'] },

  // ══════════════════════════════════════════════════════════════════
  // TIER 9 — High-Quality Dev Blogs & Tutorials
  // ══════════════════════════════════════════════════════════════════

  { url: 'https://javascript.info/',                                             source: 'javascript-info', pages: 150, depth: 2, tags: ['javascript','tutorial'] },
  { url: 'https://javascript.info/js',                                           source: 'javascript-info', pages: 100, depth: 2, tags: ['javascript'] },
  { url: 'https://www.freecodecamp.org/news/',                                   source: 'freecodecamp',    pages: 100, depth: 1, tags: ['tutorial','learn'] },
  { url: 'https://css-tricks.com/',                                              source: 'css-tricks',      pages: 80,  depth: 1, tags: ['css','tricks'] },
  { url: 'https://www.smashingmagazine.com/',                                    source: 'smashing-mag',    pages: 60,  depth: 1, tags: ['webdev','blog'] },
  { url: 'https://blog.logrocket.com/',                                          source: 'logrocket',       pages: 80,  depth: 1, tags: ['blog','react','nodejs'] },
  { url: 'https://dev.to/',                                                      source: 'devto',           pages: 80,  depth: 1, tags: ['devto','blog'] },
  { url: 'https://www.digitalocean.com/community/tutorials',                     source: 'digitalocean',    pages: 100, depth: 1, tags: ['tutorial','devops'] },
  { url: 'https://www.theodinproject.com/paths',                                 source: 'odin',            pages: 60,  depth: 2, tags: ['tutorial','fullstack'] },
  { url: 'https://www.patterns.dev/',                                            source: 'patterns',        pages: 50,  depth: 2, tags: ['patterns','javascript','react'] },
  { url: 'https://refactoring.guru/design-patterns',                             source: 'refactoring-guru',pages: 80,  depth: 2, tags: ['design-patterns','oop'] },
  { url: 'https://www.geeksforgeeks.org/data-structures/',                       source: 'geeksforgeeks',   pages: 100, depth: 2, tags: ['dsa','algorithms'] },
  { url: 'https://www.geeksforgeeks.org/fundamentals-of-algorithms/',            source: 'geeksforgeeks',   pages: 80,  depth: 2, tags: ['algorithms','dsa'] },
  { url: 'https://roadmap.sh/',                                                  source: 'roadmap',         pages: 50,  depth: 2, tags: ['roadmap','career'] },
  { url: 'https://realpython.com/',                                              source: 'realpython',      pages: 80,  depth: 1, tags: ['python','tutorial'] },

  // ══════════════════════════════════════════════════════════════════
  // TIER 10 — Security, Performance, Web Standards
  // ══════════════════════════════════════════════════════════════════

  { url: 'https://cheatsheetseries.owasp.org/',                                  source: 'owasp',      pages: 80,  depth: 2, tags: ['security','owasp'] },
  { url: 'https://owasp.org/www-project-top-ten/',                               source: 'owasp',      pages: 30,  depth: 2, tags: ['security','owasp'] },
  { url: 'https://web.dev/learn/',                                               source: 'webdev',     pages: 100, depth: 2, tags: ['webdev','performance','google'] },
  { url: 'https://web.dev/articles/',                                            source: 'webdev',     pages: 80,  depth: 1, tags: ['webdev','performance'] },
  { url: 'https://www.w3.org/TR/',                                               source: 'w3c',        pages: 40,  depth: 1, tags: ['standards','w3c'] },
  { url: 'https://jwt.io/introduction',                                          source: 'jwt',        pages: 20,  depth: 2, tags: ['jwt','auth','security'] },

  // ══════════════════════════════════════════════════════════════════
  // TIER 11 — AI / ML Docs
  // ══════════════════════════════════════════════════════════════════

  { url: 'https://pytorch.org/docs/stable/',                                     source: 'pytorch',    pages: 100, depth: 2, tags: ['pytorch','ml','python'] },
  { url: 'https://www.tensorflow.org/api_docs/python/tf',                        source: 'tensorflow', pages: 80,  depth: 2, tags: ['tensorflow','ml','python'] },
  { url: 'https://scikit-learn.org/stable/modules/classes.html',                 source: 'sklearn',    pages: 80,  depth: 2, tags: ['scikit-learn','ml','python'] },
  { url: 'https://huggingface.co/docs/transformers/',                            source: 'huggingface',pages: 80,  depth: 2, tags: ['huggingface','nlp','ai'] },
  { url: 'https://platform.openai.com/docs/',                                    source: 'openai',     pages: 60,  depth: 2, tags: ['openai','ai','api'] },

  // ══════════════════════════════════════════════════════════════════
  // TIER 12 — Package & Ecosystem Docs
  // ══════════════════════════════════════════════════════════════════

  { url: 'https://axios-http.com/docs/intro',                                    source: 'axios',      pages: 30,  depth: 2, tags: ['axios','http','javascript'] },
  { url: 'https://lodash.com/docs/',                                             source: 'lodash',     pages: 30,  depth: 2, tags: ['lodash','javascript'] },
  { url: 'https://date-fns.org/docs/',                                           source: 'date-fns',   pages: 30,  depth: 2, tags: ['date-fns','javascript'] },
  { url: 'https://www.npmjs.com/package/socket.io',                              source: 'socketio',   pages: 20,  depth: 1, tags: ['socketio','websocket'] },
  { url: 'https://socket.io/docs/v4/',                                           source: 'socketio',   pages: 60,  depth: 2, tags: ['socketio','websocket'] },
  { url: 'https://docs.expo.dev/',                                               source: 'expo',       pages: 80,  depth: 2, tags: ['expo','react-native','mobile'] },
  { url: 'https://reactnative.dev/docs/getting-started',                         source: 'reactnative',pages: 100, depth: 2, tags: ['react-native','mobile'] },
  { url: 'https://docs.stripe.com/',                                             source: 'stripe',     pages: 80,  depth: 2, tags: ['stripe','payments','api'] },
  { url: 'https://www.sanity.io/docs/',                                          source: 'sanity',     pages: 60,  depth: 2, tags: ['sanity','cms'] },
];

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 MEGA-CRAWL starting — ${SEEDS.length} seed targets`);
  console.log(`📦 DB cap: ${MAX_DB_MB} MB\n`);

  let domainsDone = 0;
  let totalPages  = 0;

  for (const seed of SEEDS) {
    // Periodic DB size check
    if (domainsDone % CHECK_INTERVAL === 0) {
      const mb = await getDbMB();
      console.log(`\n📊 DB size: ${mb.toFixed(1)} MB / ${MAX_DB_MB} MB (${domainsDone}/${SEEDS.length} domains done, ~${totalPages} pages crawled)`);
      if (mb >= MAX_DB_MB) {
        console.log('🛑 DB cap reached — stopping crawl.');
        break;
      }
    }

    console.log(`\n[${domainsDone + 1}/${SEEDS.length}] ${seed.source} → ${seed.url}`);

    try {
      const saved = await crawl(seed.url, {
        source:         seed.source,
        maxPages:       seed.pages,
        maxDepth:       seed.depth,
        maxConcurrency: 3,
        maxLinksPerPage: 30,
        delayRange:     [800, 1600],
        tags:           seed.tags,
      });
      totalPages += saved ?? 0;
    } catch (err) {
      console.error(`  ✗ Failed: ${(err as Error).message}`);
    }

    domainsDone++;
  }

  // Final DB size report
  const finalMb = await getDbMB();
  console.log(`\n✅ MEGA-CRAWL complete!`);
  console.log(`   Domains processed : ${domainsDone}`);
  console.log(`   Pages added       : ~${totalPages}`);
  console.log(`   Final DB size     : ${finalMb.toFixed(1)} MB`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
