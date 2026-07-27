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

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return results;

  const firefoxHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    // Tier 1: Tavily API (if TAVILY_API_KEY is set)
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      try {
        const resp = await fetchWithTimeout('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: normalizedQuery,
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

    // Tier 2: DuckDuckGo HTML GET provider (Most reliable keyless engine with Firefox headers)
    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(normalizedQuery)}`;
      const ddgResp = await fetchWithTimeout(ddgUrl, {
        cache: 'no-store',
        headers: firefoxHeaders,
      });
      if (ddgResp.ok) {
        const html = await ddgResp.text();
        const $ = cheerio.load(html);
        $('.result').each((_, el) => {
          if (results.length >= maxResults) return false;
          const titleEl = $(el).find('.result__title a');
          const snippet = $(el).find('.result__snippet').text().trim();
          const rawUrl = titleEl.attr('href') || '';
          let url = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
          if (rawUrl.includes('uddg=')) {
            const m = rawUrl.match(/uddg=([^&]+)/);
            if (m?.[1]) url = decodeURIComponent(m[1]);
          }
          const title = titleEl.text().trim();
          if (url && title && url.startsWith('http') && !results.some(r => r.url === url)) {
            results.push({ title, url, snippet: snippet || title, source: 'web' });
          }
        });
      }
    } catch { /* fall through */ }

    // Tier 3: DuckDuckGo Lite GET provider
    if (results.length < maxResults) {
      try {
        const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(normalizedQuery)}`;
        const liteResp = await fetchWithTimeout(liteUrl, {
          cache: 'no-store',
          headers: firefoxHeaders,
        });
        if (liteResp.ok) {
          const html = await liteResp.text();
          const $ = cheerio.load(html);
          let currentItem: Partial<WebSearchResult> | null = null;
          $('tr').each((_, el) => {
            if (results.length >= maxResults) return false;
            const link = $(el).find('a.result-link');
            const snippetTd = $(el).find('td.result-snippet');
            if (link.length > 0) {
              const title = link.text().trim();
              const rawUrl = link.attr('href') || '';
              let url = rawUrl;
              if (rawUrl.includes('uddg=')) {
                const m = rawUrl.match(/uddg=([^&]+)/);
                if (m?.[1]) url = decodeURIComponent(m[1]);
              }
              if (title && url && url.startsWith('http') && !results.some(r => r.url === url)) {
                currentItem = { title, url, snippet: '', source: 'web' };
              }
            } else if (snippetTd.length > 0 && currentItem) {
              currentItem.snippet = snippetTd.text().trim();
              results.push(currentItem as WebSearchResult);
              currentItem = null;
            }
          });
        }
      } catch { /* fall through */ }
    }

    // Tier 4: Bing HTML Scraper (with fixed Base64URL decoding)
    if (results.length < maxResults) {
      try {
        const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(normalizedQuery)}&count=${maxResults * 2}`;
        const bingResp = await fetchWithTimeout(bingUrl, {
          cache: 'no-store',
          headers: firefoxHeaders,
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

            if (url.includes('bing.com/ck/a')) {
              try {
                const uParam = new URL(url).searchParams.get('u');
                if (uParam) {
                  let raw = uParam.startsWith('a1') ? uParam.slice(2) : uParam;
                  raw = raw.replace(/-/g, '+').replace(/_/g, '/');
                  while (raw.length % 4 !== 0) raw += '=';
                  const decoded = Buffer.from(raw, 'base64').toString('utf-8');
                  if (decoded.startsWith('http')) url = decoded;
                }
              } catch {}
            }

            if (url && title && url.startsWith('http') && !url.includes('bing.com') && !results.some(r => r.url === url)) {
              results.push({ title, url, snippet: snippet || title, source: 'web' });
            }
          });
        }
      } catch { /* fall through */ }
    }

    // Tier 5: Wikipedia OpenSearch API fallback
    if (results.length < 3) {
      try {
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(normalizedQuery)}&utf8=&format=json`;
        const wikiResp = await fetchWithTimeout(wikiUrl);
        if (wikiResp.ok) {
          const data = await wikiResp.json();
          const hits = data.query?.search || [];
          for (const hit of hits) {
            if (results.length >= maxResults) break;
            const title = hit.title;
            const snippet = hit.snippet ? hit.snippet.replace(/<[^>]+>/g, '').trim() : title;
            const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
            if (!results.some(r => r.url === url)) {
              results.push({ title, url, snippet, source: 'web' });
            }
          }
        }
      } catch {}
    }

  } catch (error) {
    console.error('Live web search error:', error);
  }

  const terms = normalizedQuery.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
  const preferredDomains = [
    'react.dev', 'nextjs.org', 'nodejs.org', 'developer.mozilla.org',
    'typescriptlang.org', 'docs.python.org', 'docs.docker.com', 'github.com',
  ];
  const noiseDomains = [
    'merriam-webster.com', 'dictionary.com', 'sapling.ai', 'wiktionary.org',
    'collinsdictionary.com', 'dictionary.cambridge.org', 'vocabulary.com',
    'redkiwiapp.com', 'thesaurus.com', 'wordreference.com',
  ];

  // Filter out noise domains (dictionaries)
  const filtered = results.filter(r => r.url && !noiseDomains.some(d => r.url.toLowerCase().includes(d)));
  const unique = Array.from(new Map(filtered.map((result) => [result.url, result])).values());

  unique.sort((a, b) => {
    const score = (result: WebSearchResult) => {
      const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
      let value = terms.reduce((total, term) => total + (haystack.includes(term) ? 4 : 0), 0);
      if (result.title.toLowerCase().includes(normalizedQuery.toLowerCase())) value += 20;
      if (preferredDomains.some((domain) => result.url.includes(domain))) value += 8;
      return value;
    };
    return score(b) - score(a);
  });

  return unique.slice(0, maxResults);
}

/**
 * Fetches and parses a web page URL to extract clean text and code blocks.
 */
export async function fetchPageContent(url: string): Promise<PageContentResult> {
  // Skip non-scrapable media/app store domains that hang or block headless HTTP requests
  if (/apps\.apple\.com|play\.google\.com|youtube\.com|youtu\.be/i.test(url)) {
    return { url, title: url, content: '', codeSnippets: [] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

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
  } finally {
    clearTimeout(timeout);
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
