import { crawl } from '../src/services/crawlerService';

// Default seed URL if none provided
const seedUrl = process.argv[2] || 'https://nextjs.org/docs';

async function main() {
  console.log(`Starting crawl of ${seedUrl}...`);
  try {
    await crawl(seedUrl, {
      maxPages: 20,
      maxDepth: 2
    });
    console.log('Crawl finished successfully!');
  } catch (error) {
    console.error('Crawl failed:', error);
    process.exit(1);
  }
}

main();
