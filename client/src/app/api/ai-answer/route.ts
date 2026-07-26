import { streamText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { searchLiveWeb, fetchPageContent, triggerAutoIndex, WebSearchResult } from '@/lib/tools/agent-tools';

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
  if (q.includes('docker')) return ['Docker Daemon', 'systemctl', 'Container Image', 'Volume Mounting'];
  if (q.includes('react')) return ['Virtual DOM', 'useState Hook', 'Component Lifecycle', 'Reconciliation'];
  if (q.includes('node') || q.includes('express')) return ['Event Loop', 'Express Middleware', 'Worker Threads', 'Non-blocking I/O'];
  if (q.includes('python')) return ['Virtual Environment', 'asyncio', 'GIL (Global Interpreter Lock)', 'Package Index'];
  const topic = query.replace(/^(how to|what is|how do i|running|learn|guide for)\s+/i, '').trim();
  return [topic, 'Configuration', 'CLI Command', 'Architecture'];
}

// Wraps a promise with a timeout — prevents tool calls from hanging indefinitely
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function POST(req: Request) {
  try {
    const { prompt, results = [], searchMode = 'agentic', messages = [] } = await req.json();

    if (!prompt && (!messages || messages.length === 0)) {
      return new Response('Missing prompt or messages parameter', { status: 400 });
    }

    const currentQuery = prompt || messages[messages.length - 1]?.content || '';
    const apiKey = process.env.NVIDIA_KEY;
    if (!apiKey) return new Response('NVIDIA_KEY environment variable is not set', { status: 500 });

    const nvidiaClient = createOpenAI({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: apiKey,
    });

    const encoder = new TextEncoder();

    if (searchMode === 'agentic') {
      // ── AGENTIC REACT MULTI-STEP TOOL-CALLING MODE ─────────────────────────
      const variation = `${currentQuery} guide tutorial`;
      const [primary, secondary] = await Promise.all([
        withTimeout(searchLiveWeb(currentQuery, 4), 8000, []),
        withTimeout(searchLiveWeb(variation, 3), 8000, []),
      ]);

      const seen = new Map<string, WebSearchResult>();
      [...primary, ...secondary].forEach(r => {
        if (r.url && !seen.has(r.url)) seen.set(r.url, r);
      });
      const webResults = Array.from(seen.values()).slice(0, 6);

      triggerAutoIndex(webResults.map(r => r.url));

      const followUpQuestions = generateFollowUps(currentQuery, webResults);
      const keyConcepts = generateConcepts(currentQuery, webResults);

      const sourcesPayload = JSON.stringify({
        sources: webResults.map(r => ({ url: r.url, title: r.title, snippet: r.snippet })),
        followUps: followUpQuestions,
        concepts: keyConcepts,
      });

      // Header: sources + initial status + first tool call hint
      const header = `[[SOURCES:${sourcesPayload}]]\n[[STATUS:Searching the live web for "${currentQuery}"]]\n[[TOOL_CALL:search_web|Querying web for "${currentQuery.slice(0, 60)}..."]]\n\n`;

      const numberedSources = webResults
        .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`)
        .join('\n\n');

      const systemPrompt = `You are Trace, an autonomous multi-step AI developer research agent.

USER QUERY: "${currentQuery}"

INITIAL WEB SOURCES (already retrieved):
${numberedSources || 'No web results pre-fetched.'}

INSTRUCTIONS:
1. Begin answering immediately from the sources above. Cite inline with [1], [2], etc.
2. ONLY call fetch_full_page if a source snippet is genuinely insufficient and you need exact code syntax.
3. Do NOT call search_web again — you already have the web results above.
4. Keep your answer complete, with working code examples where relevant.
5. Do NOT open with "Based on the sources" or similar filler.`;

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
        stopWhen: stepCountIs(3), // Reduced from 5 to avoid long hangs
        tools: {
          fetch_full_page: tool({
            description: 'Fetch the full content of a web page URL for deeper documentation reading.',
            inputSchema: z.object({ url: z.string().describe('The URL to read') }),
            execute: async ({ url }) => {
              // Emit a tool call progress token before fetching
              const pageData = await withTimeout(
                fetchPageContent(url),
                8000,
                { url, title: url, content: 'Page fetch timed out.', codeSnippets: [] }
              );
              return {
                title: pageData.title,
                content: pageData.content.slice(0, 3000),
                codeSnippets: pageData.codeSnippets.slice(0, 2),
              };
            },
          }),
        },
        maxOutputTokens: 1500,
      });

      // Stream: header first, then pipe LLM chunks with tool call progress events
      const combinedStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(header));

          try {
            // Use fullStream to intercept tool calls and emit progress tokens
            for await (const part of aiResult.fullStream) {
              if (part.type === 'text-delta') {
                controller.enqueue(encoder.encode(part.text));
              } else if (part.type === 'tool-call') {
                // Emit a visible progress event the UI can render
                const input = (part as any).input || (part as any).args || {};
                const toolLabel = String(input?.url || input?.query || '').slice(0, 60);
                const toolToken = `\n[[TOOL_CALL:${part.toolName}|Reading "${toolLabel}"]]\n`;
                controller.enqueue(encoder.encode(toolToken));
              } else if (part.type === 'error') {
                console.error('Stream part error:', part.error);
              }
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
      // ── DIRECT QUICK-FACT SEARCH MODE ──────────────────────────────────────
      const context = results.slice(0, 4).map((r: any, i: number) =>
        `[${i + 1}] ${r.title} — ${r.url}\n${r.description || ''}`
      ).join('\n\n');

      const systemPrompt = `You are Trace Direct Search (like Google Featured Snippets).
Answer in 1–3 short sentences. Lead with the direct fact/command/answer. Zero filler.
Max 150–200 tokens.

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
