import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { fetchPageContent, searchLiveWeb, triggerAutoIndex, WebSearchResult } from '@/lib/tools/agent-tools';

// Force this route to always be dynamic (never cached) and stream immediately
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cleanSearchQuery(rawQuery: string): string {
  let q = rawQuery.trim();
  // Strip conversational prefixes and typo request phrasing (tell/rell/cell/talk/explain/show/give/find/search)
  q = q.replace(/^(?:can\s+you|please|could\s+you|i\s+want\s+to|i\s+need\s+to|help\s+me|kindly|would\s+you)?\s*(?:tell|rell|cell|talk|explain|show|give|find|search|lookup|get|fetch|describe|detail|summarize|provide)\s+(?:me\s+)?(?:(?:about|on|for|with|regarding|to|an?\s+overview\s+of|details?\s+on|information\s+on)\s+)?/i, '');
  // Strip "what is", "who is", "where is", "how do i", "how to"
  q = q.replace(/^(?:what\s+is|what\s+are|who\s+is|where\s+is|how\s+does|how\s+do\s+i|how\s+to|can\s+you\s+explain|give\s+me|overview\s+of|details\s+on)\s+/i, '');
  return q.trim() || rawQuery.trim();
}

function normalizeProvidedResults(rawResults: unknown): WebSearchResult[] {
  if (!Array.isArray(rawResults)) return [];

  return rawResults
    .filter((result: any) => typeof result?.url === 'string' && result.url.startsWith('http'))
    .map((result: any) => ({
      title: result.title || result.url,
      url: result.url,
      snippet: result.snippet || result.description || result.content || '',
      source: result.source === 'local' ? 'local' as const : 'web' as const,
    }));
}

function generateFollowUps(query: string, results: WebSearchResult[]): string[] {
  const q = query.toLowerCase();
  if (q.includes('docker')) {
    return [
      'How do I mount a local directory volume into a Docker container?',
      'What is the difference between Docker Compose and a Dockerfile?',
      'How do I view container logs and manage running containers?'
    ];
  }
  if (q.includes('react')) {
    return [
      'What is the difference between useState and useReducer in React?',
      'How do I optimize React component rendering performance?',
      'What are the best practices for fetching data in Next.js App Router?'
    ];
  }
  if (q.includes('node') || q.includes('express')) {
    return [
      'How do I implement custom middleware and error handling in Express?',
      'What is the difference between CommonJS and ES Modules in Node.js?',
      'How do I handle background tasks and worker threads in Node.js?'
    ];
  }
  if (q.includes('python')) {
    return [
      'What are the best virtual environment managers for Python (uv, venv, poetry)?',
      'How does asyncio work compared to multi-threading in Python?',
      'How do I build production-ready REST APIs with FastAPI?'
    ];
  }
  const topic = cleanSearchQuery(query);
  const topTitle = results[0]?.title ? results[0].title.split(/[-|:]/)[0].trim() : topic;
  return [
    `What are the primary use cases and key features of ${topic}?`,
    `Can you provide a practical example or setup guide for ${topic}?`,
    `How does ${topTitle} compare to alternative solutions?`
  ];
}

function generateConcepts(query: string, results: WebSearchResult[]): string[] {
  const concepts: string[] = [];
  const cleanQ = cleanSearchQuery(query);
  const qLower = cleanQ.toLowerCase();

  if (qLower.includes('docker')) return ['Docker Daemon', 'Container Image', 'Volume Mounting', 'Docker Compose'];
  if (qLower.includes('react')) return ['Virtual DOM', 'useState Hook', 'Component Lifecycle', 'Reconciliation'];
  if (qLower.includes('node') || qLower.includes('express')) return ['Event Loop', 'Express Middleware', 'Worker Threads', 'Non-blocking I/O'];
  if (qLower.includes('python')) return ['Virtual Environment', 'asyncio', 'GIL Lock', 'Package Index'];

  // Add the cleaned query term first
  concepts.push(cleanQ.charAt(0).toUpperCase() + cleanQ.slice(1));

  // Extract titles and key terms from live search results
  results.forEach(r => {
    if (r.title) {
      const cleanTitle = r.title.split(/[-|:–—]/)[0].trim();
      if (cleanTitle && cleanTitle.length < 35 && !concepts.includes(cleanTitle)) {
        concepts.push(cleanTitle);
      }
    }
  });

  // Extract individual main terms if needed
  const terms = cleanQ.split(/\s+/).filter(w => w.length > 2 && !/^(vs|versus|and|the|for|with|how|what|why|in|on|at|of|to|is|are)$/i.test(w));
  terms.forEach(t => {
    if (concepts.length < 4 && !concepts.includes(t)) {
      concepts.push(t.charAt(0).toUpperCase() + t.slice(1));
    }
  });

  return Array.from(new Set(concepts)).slice(0, 4);
}

export async function POST(req: Request) {
  try {
    const { prompt, results = [], searchMode = 'agentic', messages = [] } = await req.json();

    if (!prompt && (!messages || messages.length === 0)) {
      return new Response('Missing prompt or messages parameter', { status: 400 });
    }

    const currentQuery = prompt || messages[messages.length - 1]?.content || '';
    const cleanedQuery = cleanSearchQuery(currentQuery);
    const providedResults = normalizeProvidedResults(results);

    const apiKey = process.env.NVIDIA_KEY;
    if (!apiKey) return new Response('NVIDIA_KEY environment variable is not set', { status: 500 });

    const nvidiaClient = createOpenAI({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: apiKey,
    });

    const encoder = new TextEncoder();

    if (searchMode === 'agentic') {
      // ── AGENTIC MODE: Fast primary fetch → emit sources → synthesize ─────────

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enqueue = (text: string) => controller.enqueue(encoder.encode(text));

          try {
            // Immediately emit status so client shows activity in <100ms
            enqueue(`[[STATUS:Searching the web for "${cleanedQuery.slice(0, 50)}…"]]\n`);

            // AI mode is web-only: combine the client search with fresh retrieval, then
            // broaden once when the first provider returns too few useful sources.
            const liveResults = await searchLiveWeb(cleanedQuery, 8).catch(() => [] as WebSearchResult[]);
            let backupResults: WebSearchResult[] = [];
            if (liveResults.length < 5) {
              backupResults = await searchLiveWeb(`${cleanedQuery} documentation guide`, 6)
                .catch(() => [] as WebSearchResult[]);
            }
            let primary = [...providedResults.slice(0, 8), ...liveResults, ...backupResults];

            // Fallback to the raw wording if the cleaned query is too narrow.
            if (primary.length < 4 && cleanedQuery !== currentQuery) {
              const rawResults = await searchLiveWeb(currentQuery, 4).catch(() => [] as WebSearchResult[]);
              primary = [...primary, ...rawResults];
            }

            let secondary: WebSearchResult[] = [];
            if (primary.length < 3) {
              let variation = `${cleanedQuery} overview specs`;
              if (/\b(vs|versus|compared|difference|between)\b/i.test(cleanedQuery)) {
                variation = `${cleanedQuery} comparison benchmark`;
              } else if (/\b(error|bug|issue|failed|exception|fix)\b/i.test(cleanedQuery)) {
                variation = `${cleanedQuery} solution fix`;
              }
              secondary = await searchLiveWeb(variation, 4).catch(() => [] as WebSearchResult[]);
            }

            // Deduplicate results by URL
            const seen = new Map<string, WebSearchResult>();
            [...primary, ...secondary].forEach(r => {
              if (r.url && !seen.has(r.url)) seen.set(r.url, r);
            });
            const webResults = Array.from(seen.values()).slice(0, 8);

            // Background indexing
            triggerAutoIndex(webResults.map(r => r.url));

            // Emit sources header — client renders source cards immediately
            const followUps = generateFollowUps(cleanedQuery, webResults);
            const concepts = generateConcepts(cleanedQuery, webResults);
            const sourcesPayload = JSON.stringify({
              sources: webResults.map(r => ({ url: r.url, title: r.title, snippet: r.snippet })),
              followUps,
              concepts,
            });

            enqueue(`[[SOURCES:${sourcesPayload}]]\n`);
            enqueue(`[[STEP:synthesizing]]\n\n`);

            // Step 5: Fetch the most relevant pages so the model gets evidence, not only SERP text.
            const pageContext = await Promise.all(
              webResults.slice(0, 3).map(async (result) => {
                const page = await fetchPageContent(result.url);
                return { url: result.url, content: page.content.slice(0, 1800) };
              })
            );
            const pageContextByUrl = new Map(pageContext.map((page) => [page.url, page.content]));
            const numberedSources = webResults
              .map((r, i) => {
                const pageText = pageContextByUrl.get(r.url);
                const evidence = pageText && !pageText.startsWith('Could not reach') && !pageText.startsWith('Failed to fetch')
                  ? pageText
                  : r.snippet;
                return `[${i + 1}] ${r.title}\nURL: ${r.url}\nEvidence: ${evidence}`;
              })
              .join('\n\n');

            const systemPrompt = `You are Trace, a real-time autonomous RAG search engine for developers.

USER QUERY: "${currentQuery}"

LIVE WEB SEARCH CONTEXT (retrieved real-time from the internet):
${numberedSources || 'No web sources retrieved.'}

CRITICAL RAG GROUNDING & KNOWLEDGE RULES:
1. Treat the LIVE WEB SEARCH CONTEXT above as your primary, up-to-date ground truth.
2. IGNORE any pre-trained internal knowledge cutoff dates (e.g., September 2023). If the live web sources contain information about recent models, tools, frameworks, releases, or developments (from 2024, 2025, or 2026), present those facts directly to the user.
3. NEVER reply with "I don't know", "My knowledge cutoff is...", or "I don't have information up to 2026". Synthesize whatever information is present in the web sources or analyze the user query directly using the provided web context.
4. Inline Citations: Cite sources inline using [1], [2], etc., immediately after every claim derived from a source.
5. Format your response in clean Markdown with headers, bullet points, and code blocks where applicable. Do NOT use intro filler such as "Based on the web sources...".
6. If no sources were retrieved, answer from your general knowledge but say that live retrieval was unavailable and do not invent citations.
7. Prefer primary documentation over tutorial pages when both are available.
8. For code examples, verify the implementation yourself. Event listeners must remove the exact same function reference they add, and fetch examples should use AbortController when cancellation matters.`;

            const formattedMessages = messages.length > 0
              ? messages.map((m: any) => ({
                  role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
                  content: m.content,
                }))
              : [{ role: 'user' as const, content: currentQuery }];

            // Step 6: Stream LLM synthesis directly
            const aiResult = await streamText({
              model: nvidiaClient.chat('meta/llama-3.1-70b-instruct'),
              system: systemPrompt,
              messages: formattedMessages,
              maxOutputTokens: 1200,
              abortSignal: req.signal,
            });

            const reader = aiResult.textStream.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              enqueue(value);
            }
          } catch (e: any) {
            console.error('Agentic stream error:', e.message || e);
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Accel-Buffering': 'no',
          'Transfer-Encoding': 'chunked',
        },
      });

    } else {
      // ── DIRECT MODE: Fast snippet-style answer ──────────────────────────────
      const context = results.slice(0, 4).map((r: any, i: number) =>
        `[${i + 1}] ${r.title} — ${r.url}\n${r.description || ''}`
      ).join('\n\n');

      const systemPrompt = `You are Trace Direct Search. Answer in 1–3 sentences maximum.
Lead with the direct fact, command, or yes/no answer. Zero filler text.
Max 200 tokens.

WEB SEARCH CONTEXT:
${context || 'No web sources were retrieved.'}`;

      const formattedMessages = messages.length > 0
        ? messages.map((m: any) => ({
            role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
            content: m.content,
          }))
        : [{ role: 'user' as const, content: currentQuery }];

      const aiResult = await streamText({
        model: nvidiaClient.chat('meta/llama-3.1-70b-instruct'),
        system: systemPrompt,
        messages: formattedMessages,
        maxOutputTokens: 200,
        abortSignal: req.signal,
      });

      return aiResult.toTextStreamResponse();
    }
  } catch (error: any) {
    console.error('AI SEARCH ERROR:', error.message || error);
    return new Response(`Error: ${error.message || 'Internal error'}`, { status: 500 });
  }
}
