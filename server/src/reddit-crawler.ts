import Snoowrap from 'snoowrap';
import { syncIndex } from './index-manager.js';
import { config } from 'dotenv';
import path from 'path';
import * as crypto from 'crypto';

// Force load to grab newly appended variables if not restarted natively
config({ path: path.resolve(process.cwd(), '../.env') });

const reddit = new Snoowrap({
  userAgent: 'MySearchEngine/1.0',
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD
});

export async function crawlReddit(subreddits: string[]) {
  console.log(`Starting Reddit crawler for subs: ${subreddits.join(', ')}...`);
  
  let processedCount = 0;

  for (const sub of subreddits) {
    try {
      console.log(`Fetching 'Top' posts for r/${sub}...`);
      
      // Fetch the top 30 posts from the past week
      const topPosts = await reddit.getSubreddit(sub).getTop({ time: 'week', limit: 30 });
      
      for (const post of topPosts) {
        // We only care about self-posts (text posts) or link posts tightly matching dev subjects
        // For simplicity, we just extract text or the URL title
        const title = post.title || 'No Title';
        const rawContent = post.selftext || '';
        
        // Clean out excessive whitespace or linebreaks
        const content = rawContent.replace(/\s+/g, ' ').trim().slice(0, 5000);
        
        // Use Reddit post URL as the unique ID
        const url = `https://www.reddit.com${post.permalink}`;
        
        const contentHash = crypto.createHash('sha256').update(content + title).digest('hex');

        const pageData = {
          url,
          title: `[r/${sub}] ${title}`,
          description: `Reddit discussion from r/${sub} with ${post.score} upvotes.`,
          content,
          codeSnippets: '',
          source: 'reddit',
          tags: `reddit,${sub}`,
          contentHash,
          lastCrawled: new Date().toISOString(),
        };

        // Inline save so we don't depend on the removed storage.savePage
        const { sql } = await import('./db.js');
        await sql`
          INSERT INTO pages (url, title, content, code_snippets, description, source, tags, content_hash, last_crawled)
          VALUES (
            ${pageData.url}, ${pageData.title}, ${pageData.content}, ${pageData.codeSnippets},
            ${pageData.description}, ${pageData.source}, ${pageData.tags}, ${pageData.contentHash},
            ${pageData.lastCrawled}
          )
          ON CONFLICT (url) DO UPDATE SET
            title = EXCLUDED.title, content = EXCLUDED.content,
            description = EXCLUDED.description, source = EXCLUDED.source,
            tags = EXCLUDED.tags, content_hash = EXCLUDED.content_hash,
            last_crawled = EXCLUDED.last_crawled
        `.catch((e: Error) => console.error('DB save error:', e.message));
        processedCount++;
      }
    } catch (err) {
      console.error(`Failed to fetch top posts for r/${sub}:`, (err as Error).message);
    }
  }

  // Once complete, sync FlexSearch index with the new database entries
  await syncIndex();
  console.log(`Reddit crawl complete. Synced ${processedCount} new threads into the index.`);
}
