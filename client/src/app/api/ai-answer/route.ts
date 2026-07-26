import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { searchLiveWeb, triggerAutoIndex, WebSearchResult } from '@/lib/tools/agent-tools';

// Force this route to always be dynamic (never cached) and stream immediately
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
      // ── AGENTIC MODE: Fast primary fetch → emit sources → synthesize ─────────

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enqueue = (text: string) => controller.enqueue(encoder.encode(text));

          try {
            // Immediately emit status so client shows activity in <100ms
            enqueue(`[[STATUS:Searching the web for "${currentQuery.slice(0, 50)}…"]]\n`);

            // Build smart query variation based on query intent
            let variation = `${currentQuery} overview specs`;
            if (/\b(vs|versus|compared|difference|between)\b/i.test(currentQuery)) {
              variation = `${currentQuery} comparison benchmark overview`;
            } else if (/\b(error|bug|issue|failed|exception|fix)\b/i.test(currentQuery)) {
              variation = `${currentQuery} solution fix issue`;
            }

            const [primary, secondary] = await Promise.all([
              searchLiveWeb(currentQuery, 4).catch(() => [] as WebSearchResult[]),
              searchLiveWeb(variation, 3).catch(() => [] as WebSearchResult[]),
            ]);

            // Deduplicate
            const seen = new Map<string, WebSearchResult>();
            [...primary, ...secondary].forEach(r => {
              if (r.url && !seen.has(r.url)) seen.set(r.url, r);
            });
            const webResults = Array.from(seen.values()).slice(0, 6);

            // Background indexing
            triggerAutoIndex(webResults.map(r => r.url));

            // Emit sources header — client renders source cards immediately
            const followUps = generateFollowUps(currentQuery, webResults);
            const concepts = generateConcepts(currentQuery, webResults);
            const sourcesPayload = JSON.stringify({
              sources: webResults.map(r => ({ url: r.url, title: r.title, snippet: r.snippet })),
              followUps,
              concepts,
            });

            enqueue(`[[SOURCES:${sourcesPayload}]]\n`);
            enqueue(`[[STEP:synthesizing]]\n\n`);

            // Step 5: Build numbered context for the LLM
            const numberedSources = webResults
              .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nExcerpt: ${r.snippet}`)
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
5. Format your response in clean Markdown with headers, bullet points, and code blocks where applicable. Do NOT use intro filler such as "Based on the web sources...".`;

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
              maxOutputTokens: 1500,
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
