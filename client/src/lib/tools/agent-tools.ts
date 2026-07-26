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
 * Searches the live web using a 4-tier fallback chain:
 * 1. Tavily API (if TAVILY_API_KEY is set)
 * 2. DuckDuckGo HTML POST
 * 3. DuckDuckGo Lite POST
 * 4. Bing HTML scraping (most reliable server-side fallback)
 */
export async function searchLiveWeb(query: string, maxResults = 5): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = [];

  try {
    // Tier 1: Tavily API (if TAVILY_API_KEY is set)
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      try {
        const resp = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query,
            search_depth: 'basic',
            include_answer: false,
            max_results: maxResults,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.results?.length) {
            return data.results.map((r: any) => ({
              title: r.title || r.url,
              url: r.url,
              snippet: r.content || r.snippet || '',
              source: 'web' as const,
            }));
          }
        }
      } catch { /* fall through */ }
    }

    // Tier 2: Bing HTML scraping (Most reliable server-side provider with canonical URL decoding)
    try {
      const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults * 2}`;
      const bingResp = await fetch(bingUrl, {
        cache: 'no-store',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (bingResp.ok) {
        const html = await bingResp.text();
        const $ = cheerio.load(html);
        $('li.b_algo').each((_, el) => {
          if (results.length >= maxResults) return false;
          const titleEl = $(el).find('h2 a');
          let url = titleEl.attr('href') || '';
          const title = titleEl.text().trim();
          const snippet = $(el).find('.b_caption p, .b_algoSlug, .b_lineclamp2').first().text().trim();

          // Decode Bing redirect wrapper URL (e.g. /ck/a?!&&p=...&u=a1aHR0cHM...)
          if (url.includes('bing.com/ck/a')) {
            try {
              const uParam = new URL(url).searchParams.get('u');
              if (uParam) {
                const raw = uParam.startsWith('a1') ? uParam.slice(2) : uParam;
                const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
                if (decoded.startsWith('http')) url = decoded;
              }
            } catch {}
          }

          if (url && title && url.startsWith('http') && !url.includes('bing.com/ck/a')) {
            results.push({ title, url, snippet: snippet || title, source: 'web' });
          }
        });
      }
    } catch { /* fall through */ }

    // Tier 3: DuckDuckGo GET HTML fallback
    if (results.length < maxResults) {
      try {
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const ddgResp = await fetch(ddgUrl, {
          cache: 'no-store',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        if (ddgResp.ok) {
          const html = await ddgResp.text();
          const $ = cheerio.load(html);
          $('.result').each((_, el) => {
            if (results.length >= maxResults) return false;
            const titleEl = $(el).find('.result__title a');
            const snippet = $(el).find('.result__snippet').text().trim();
            const rawUrl = titleEl.attr('href') || '';
            let url = rawUrl;
            if (rawUrl.includes('uddg=')) {
              const m = rawUrl.match(/uddg=([^&]+)/);
              if (m?.[1]) url = decodeURIComponent(m[1]);
            }
            const title = titleEl.text().trim();
            if (url && title && !url.startsWith('/') && url.startsWith('http') && !results.some(r => r.url === url)) {
              results.push({ title, url, snippet: snippet || title, source: 'web' });
            }
          });
        }
      } catch { /* fall through */ }
    }

    // Tier 4: DuckDuckGo Lite fallback
    if (results.length < maxResults) {
      try {
        const liteResp = await fetch('https://lite.duckduckgo.com/lite/', {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ q: query }).toString(),
        });
        if (liteResp.ok) {
          const html = await liteResp.text();
          const $ = cheerio.load(html);
          $('tr').each((_, el) => {
            if (results.length >= maxResults) return false;
            const link = $(el).find('a.result-link');
            const snippet = $(el).next().find('td.result-snippet').text().trim();
            const rawUrl = link.attr('href') || '';
            let url = rawUrl;
            if (rawUrl.includes('uddg=')) {
              const m = rawUrl.match(/uddg=([^&]+)/);
              if (m?.[1]) url = decodeURIComponent(m[1]);
            }
            const title = link.text().trim();
            if (url && title && !url.startsWith('/') && url.startsWith('http') && !results.some(r => r.url === url)) {
              results.push({ title, url, snippet: snippet || title, source: 'web' });
            }
          });
        }
      } catch { /* fall through */ }
    }

    // Tier 5: Wikipedia Search API fallback
    if (results.length === 0) {
      try {
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
        const wikiResp = await fetch(wikiUrl, { cache: 'no-store' });
        if (wikiResp.ok) {
          const data = await wikiResp.json();
          const wikiItems = data.query?.search || [];
          wikiItems.slice(0, 3).forEach((item: any) => {
            const cleanSnippet = (item.snippet || '').replace(/<[^>]*>/g, '').trim();
            results.push({
              title: item.title,
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`,
              snippet: cleanSnippet || item.title,
              source: 'web',
            });
          });
        }
      } catch {}
    }

  } catch (error) {
    console.error('Live web search error:', error);
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
