import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { searchLiveWeb, triggerAutoIndex, WebSearchResult } from '@/lib/tools/agent-tools';

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

  const topic = query.replace(/^(how to|what is|how do i|running|learn|guide for)\s+/i, '').trim();
  const topTitle = results[0]?.title ? results[0].title.split(/[-|:]/)[0].trim() : topic;

  return [
    `What are the most common errors when working with ${topic}?`,
    `Can you provide a practical code example for ${topic}?`,
    `How does ${topTitle} compare to alternative solutions?`
  ];
}

function generateConcepts(query: string, results: WebSearchResult[]): string[] {
  const q = query.toLowerCase();

  if (q.includes('docker')) {
    return ['Docker Daemon', 'systemctl', 'Container Image', 'Volume Mounting'];
  }
  if (q.includes('react')) {
    return ['Virtual DOM', 'useState Hook', 'Component Lifecycle', 'Reconciliation'];
  }
  if (q.includes('node') || q.includes('express')) {
    return ['Event Loop', 'Express Middleware', 'Worker Threads', 'Non-blocking I/O'];
  }
  if (q.includes('python')) {
    return ['Virtual Environment', 'asyncio', 'GIL (Global Interpreter Lock)', 'Package Index'];
  }

  const topic = query.replace(/^(how to|what is|how do i|running|learn|guide for)\s+/i, '').trim();
  return [topic, 'Configuration', 'CLI Command', 'Architecture'];
}

export async function POST(req: Request) {
  try {
    const { prompt, results = [], searchMode = 'agentic', messages = [] } = await req.json();

    if (!prompt && (!messages || messages.length === 0)) {
      return new Response('Missing prompt or messages parameter', { status: 400 });
    }

    const currentQuery = prompt || messages[messages.length - 1]?.content || '';

    const apiKey = process.env.NVIDIA_KEY;
    if (!apiKey) {
      return new Response('NVIDIA_KEY environment variable is not set', { status: 500 });
    }

    const nvidiaClient = createOpenAI({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: apiKey,
    });

    const encoder = new TextEncoder();

    if (searchMode === 'agentic') {
      // ── AGENTIC LIVE WEB SEARCH MODE (1500 Tokens Max) ───────────────────

      // Parallel dual-query web search for rich retrieval
      const variation = `${currentQuery} guide tutorial`;
      const [primary, secondary] = await Promise.all([
        searchLiveWeb(currentQuery, 4),
        searchLiveWeb(variation, 3),
      ]);

      // Deduplicate by URL
      const seen = new Map<string, WebSearchResult>();
      [...primary, ...secondary].forEach(r => {
        if (r.url && !seen.has(r.url)) seen.set(r.url, r);
      });
      const webResults = Array.from(seen.values()).slice(0, 6);

      // Background indexing — non-blocking
      triggerAutoIndex(webResults.map(r => r.url));

      // Generate follow-up questions & key concepts
      const followUpQuestions = generateFollowUps(currentQuery, webResults);
      const keyConcepts = generateConcepts(currentQuery, webResults);

      // Build SOURCES block (sent to client before answer stream)
      const sourcesPayload = JSON.stringify({
        sources: webResults.map(r => ({
          url: r.url,
          title: r.title,
          snippet: r.snippet,
        })),
        followUps: followUpQuestions,
        concepts: keyConcepts,
      });
      const header = `[[SOURCES:${sourcesPayload}]]\n[[STATUS:Searching the web for "${currentQuery}"]]\n\n`;

      // Numbered sources for the LLM context
      const numberedSources = webResults
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`)
        .join('\n\n');

      const systemPrompt = `You are Trace, an intelligent AI web search engine.

The user is asking: "${currentQuery}"

RETRIEVED LIVE WEB SOURCES:
${numberedSources || 'No web results.'}

CRITICAL INSTRUCTIONS:
1. Answer the user's query directly and thoroughly using the web sources.
2. Include full, working code examples where helpful.
3. Cite sources inline using numbered brackets like [1], [2] immediately after factual claims.
4. Do NOT include preambles like "Based on the web sources...". Start directly with the answer.`;

      // Build message array with conversation history if available
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
        maxOutputTokens: 1500,
      });

      // Stream header first, then LLM text
      const combinedStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(header));

          try {
            const reader = aiResult.textStream.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(encoder.encode(value));
            }
          } catch (e) {
            console.error('Stream read error:', e);
          } finally {
            controller.close();
          }
        },
      });

      return new Response(combinedStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      });

    } else {
      // ── DIRECT QUICK-FACT SEARCH MODE (Max 200 Tokens - Google Snippet Style) ──
      const context = results.slice(0, 4).map((r: any, i: number) =>
        `[${i + 1}] ${r.title} — ${r.url}\n${r.description || ''}`
      ).join('\n\n');

      const systemPrompt = `You are Trace Direct Search (like Google Featured Snippets).

Your task is to answer the query in 1 to 3 short sentences. Give a direct answer first (e.g. YES/NO, exact command, or key fact), followed by a brief 1-sentence explanation.

RULES:
1. Maximum 150 to 200 tokens total.
2. Be direct, instant, and concise. Zero preamble or intro filler.
3. Highlight key facts or exact syntax.

LOCAL CONTEXT:
${context || 'No local index matches.'}`;

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
      });

      return aiResult.toTextStreamResponse();
    }
  } catch (error: any) {
    console.error('AI SEARCH ERROR:', error.message || error);
    return new Response(`Error: ${error.message || 'Internal error'}`, { status: 500 });
  }
}
