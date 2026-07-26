import FlexSearch from 'flexsearch';
import { getAllPages, PageData } from './storage';

// Initialize FlexSearch Document index
// We use 'document' type to index objects with different fields
let index: any = null;

export function getIndex() {
  if (!index) {
    index = new FlexSearch.Document({
      preset: 'score',
      tokenize: 'forward',
      cache: true,
      document: {
        id: 'url',
        index: ['title', 'description', 'content'],
        store: ['title', 'description', 'url'], // Fields to return in results
      },
    });
  }
  return index;
}

export async function syncIndex() {
  const searchIndex = getIndex();
  const pages = await getAllPages();

  for (const page of pages) {
    searchIndex.add(page);
  }
  
  console.log(`Synced ${pages.length} pages to search index.`);
}

export async function search(query: string) {
  const searchIndex = getIndex();
  
  // Search across multiple fields
  const results = await searchIndex.search(query, {
    limit: 10,
    enrich: true, // Returns the stored fields
    suggest: true, // Handles minor typos
  });

  // FlexSearch returns results grouped by field if searching multiple, 
  // but enrich: true simplifies this.
  return results;
}
