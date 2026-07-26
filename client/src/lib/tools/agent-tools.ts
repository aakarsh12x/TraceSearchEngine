import * as cheerio from 'cheerio';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: 'web' | 'local';
}

export interface PageContentResult {
  url: string;
  title: string;
  content: string;
  codeSnippets: string[];
}

/**
 * Searches the live web using DuckDuckGo HTML API with cheerio parsing.
 * Supports Tavily / Serper API key fallback if configured in environment.
 */
export async function searchLiveWeb(query: string, maxResults = 5): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = [];

  try {
    // Check if Tavily API key is available
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      const resp = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: query,
          search_depth: 'basic',
          include_answer: false,
          max_results: maxResults,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.results && Array.isArray(data.results)) {
          return data.results.map((r: any) => ({
            title: r.title || r.url,
            url: r.url,
            snippet: r.content || r.snippet || '',
            source: 'web' as const,
          }));
        }
      }
    }

    // Default: Free zero-config DuckDuckGo HTML web search fetcher
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(ddgUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      console.warn(`DuckDuckGo search fetch returned status ${response.status}`);
      return results;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    $('.result').each((_, element) => {
      if (results.length >= maxResults) return false;

      const titleEl = $(element).find('.result__title a');
      const snippetEl = $(element).find('.result__snippet');
      const rawUrl = titleEl.attr('href') || '';

      // Extract real URL if DuckDuckGo uses redirect URLs (/l/?uddg=...)
      let cleanUrl = rawUrl;
      if (rawUrl.includes('uddg=')) {
        try {
          const match = rawUrl.match(/uddg=([^&]+)/);
          if (match && match[1]) {
            cleanUrl = decodeURIComponent(match[1]);
          }
        } catch {
          cleanUrl = rawUrl;
        }
      }

      const title = titleEl.text().trim();
      const snippet = snippetEl.text().trim();

      if (cleanUrl && title && !cleanUrl.startsWith('/')) {
        results.push({
          title,
          url: cleanUrl,
          snippet,
          source: 'web',
        });
      }
    });
  } catch (error) {
    console.error('Error performing live web search:', error);
  }

  return results;
}

/**
 * Fetches and parses a web page URL to extract clean text and code blocks.
 */
export async function fetchPageContent(url: string): Promise<PageContentResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        url,
        title: url,
        content: `Failed to fetch page content. Status: ${response.status}`,
        codeSnippets: [],
      };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove noise elements
    $('script, style, nav, footer, iframe, svg, noscript, header').remove();

    const title = $('title').text().trim() || $('h1').first().text().trim() || url;

    // Extract code snippets
    const codeSnippets: string[] = [];
    $('pre, code').each((_, el) => {
      const codeText = $(el).text().trim();
      if (codeText.length > 20 && codeSnippets.length < 5) {
        codeSnippets.push(codeText.substring(0, 1000));
      }
    });

    // Extract main text content
    let mainText = $('main, article, #content, .content, body').text().replace(/\s+/g, ' ').trim();
    if (mainText.length > 2500) {
      mainText = mainText.substring(0, 2500) + '... [truncated]';
    }

    return {
      url,
      title,
      content: mainText,
      codeSnippets,
    };
  } catch (err: any) {
    return {
      url,
      title: url,
      content: `Could not reach URL: ${err.message || err}`,
      codeSnippets: [],
    };
  }
}

/**
 * Background auto-indexer to queue newly discovered web URLs into the local Express crawler backend.
 */
export async function triggerAutoIndex(urls: string[]) {
  if (!urls || urls.length === 0) return;
  try {
    const expressHost = process.env.EXPRESS_BACKEND_URL || 'http://localhost:3001';
    await fetch(`${expressHost}/crawler/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: urls.slice(0, 3) }),
    }).catch(() => {
      // Background task silently ignores connection issues if express backend is offline
    });
  } catch {
    // Ignore error
  }
}
