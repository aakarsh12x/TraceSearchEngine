import { getIndex, syncIndex } from '../src/index-manager.js';

async function run() {
  await syncIndex();
  const index = getIndex();
  
  const query = 'typescript';
  console.log(`Searching index for "${query}" with high limit...`);
  
  const raw: any[] = await index.search(query, {
    limit: 500,
    enrich: true
  });

  const urlsFound = new Set<string>();
  for (const layer of raw) {
    (layer.result || []).forEach((hit: any) => urlsFound.add(hit.id));
  }

  console.log(`Total candidates found from index: ${urlsFound.size}`);
  
  const tsDocs = Array.from(urlsFound).filter(u => u.includes('typescriptlang.org'));
  console.log(`TypeScript official docs in candidates: ${tsDocs.length}`);
  
  if (tsDocs.length > 0) {
    console.log(`Sample candidates:\n  ${tsDocs.slice(0, 5).join('\n  ')}`);
  } else {
    console.log(`❌ No official TypeScript docs found in candidate pool!`);
    // Check first 10 generic results to see what's winning
    console.log(`Top 10 generic candidates in index:`);
    const sample = Array.from(urlsFound).slice(0, 10);
    sample.forEach(u => console.log(`  ${u}`));
  }
  
  process.exit(0);
}

run();
