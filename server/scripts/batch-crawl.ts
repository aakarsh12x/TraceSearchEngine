import { crawl } from '../src/crawler.js';

const SEED_URLS = [
  // Core Docs
  "https://developer.mozilla.org",
  "https://react.dev",
  "https://nextjs.org/docs",
  "https://nodejs.org/en/docs",
  "https://expressjs.com",
  "https://docs.python.org",
  "https://docs.oracle.com/javase",
  "https://kotlinlang.org/docs",
  "https://go.dev/doc",
  "https://rust-lang.org/learn",
  "https://angular.dev",
  "https://vuejs.org/guide",
  "https://svelte.dev/docs",
  "https://tailwindcss.com/docs",
  "https://getbootstrap.com/docs",
  "https://redux.js.org",
  "https://graphql.org/learn",
  "https://www.typescriptlang.org/docs",
  "https://deno.land/manual",
  "https://vitejs.dev/guide",
  
  // Q&A
  "https://stackoverflow.com",
  "https://superuser.com",
  "https://serverfault.com",
  "https://stackapps.com",
  "https://askubuntu.com",
  "https://mathoverflow.net",
  "https://softwareengineering.stackexchange.com",
  "https://webmasters.stackexchange.com",
  "https://datascience.stackexchange.com",
  "https://devops.stackexchange.com",
  
  // Blogs
  "https://dev.to",
  "https://medium.com/tag/programming",
  "https://freecodecamp.org/news",
  "https://css-tricks.com",
  "https://smashingmagazine.com",
  "https://sitepoint.com",
  "https://hashnode.com",
  "https://blog.logrocket.com",
  "https://betterprogramming.pub",
  "https://towardsdatascience.com",
  
  // Infra
  "https://aws.amazon.com/blogs",
  "https://cloud.google.com/blog",
  "https://learn.microsoft.com",
  "https://kubernetes.io/docs",
  "https://docker.com/blog",
  "https://nginx.org/en/docs",
  "https://redis.io/docs",
  "https://postgresql.org/docs",
  "https://mongodb.com/docs",
  "https://elastic.co/guide",
  
  // AI/ML
  "https://huggingface.co/docs",
  "https://pytorch.org/docs",
  "https://tensorflow.org/tutorials",
  "https://scikit-learn.org/stable",
  "https://keras.io",
  "https://openai.com/blog",
  "https://deepmind.com/blog",
  "https://fast.ai",
  "https://paperswithcode.com",
  "https://arxiv.org",
  
  // Tools
  "https://eslint.org/docs",
  "https://prettier.io/docs",
  "https://jestjs.io/docs",
  "https://vitest.dev",
  "https://playwright.dev/docs",
  "https://cypress.io",
  "https://storybook.js.org",
  "https://rollupjs.org",
  "https://webpack.js.org",
  "https://babeljs.io/docs",
  
  // Misc
  "https://git-scm.com/docs",
  "https://github.blog",
  "https://docs.github.com",
  "https://gitlab.com/help",
  "https://bitbucket.org/product",
  "https://conventionalcommits.org",
  "https://semver.org",
  "https://opensource.guide",
  "https://choosealicense.com",
  "https://roadmap.sh",
  
  // Mobile
  "https://reactnative.dev/docs",
  "https://flutter.dev/docs",
  "https://developer.android.com/docs",
  "https://developer.apple.com/documentation",
  "https://ionicframework.com/docs",
  "https://expo.dev/docs",
  "https://nativescript.org/docs",
  "https://capacitorjs.com/docs",
  
  // Security
  "https://owasp.org/www-project-top-ten",
  "https://auth0.com/docs",
  "https://jwt.io/introduction",
  "https://developer.okta.com/docs",
  "https://cheatsheetseries.owasp.org",
  "https://portswigger.net/web-security",
  
  // Extras
  "https://geeksforgeeks.org",
  "https://tutorialspoint.com",
  "https://w3schools.com",
  "https://javatpoint.com",
  "https://programiz.com",
  "https://realpython.com",
  "https://javascript.info",
  "https://learnxinyminutes.com",
  "https://codepen.io",
  "https://replit.com"
];

async function runBatch() {
  console.log(`Starting batch crawl for ${SEED_URLS.length} domains...`);
  
  let count = 1;
  for (const url of SEED_URLS) {
    console.log(`\n[${count}/${SEED_URLS.length}] Initiating crawl for: ${url}`);
    try {
      // By awaiting this sequentially, we ensure we only use up to 'maxConcurrency' (5) 
      // Puppeteer browsers globally at any given time, avoiding RAM spikes.
      // We limit to 5 pages per generic domain just to get a good seed without taking 3 days.
      await crawl(url, { maxPages: 5, maxDepth: 1, maxConcurrency: 5, source: 'batch' });
    } catch (err) {
       console.error(`Crawl totally failed for ${url}`, err);
    }
    count++;
  }
  
  console.log("\nBatch Crawling fully complete!");
  process.exit(0);
}

runBatch();
