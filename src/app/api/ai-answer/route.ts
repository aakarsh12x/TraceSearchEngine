import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

export async function POST(req: Request) {
  try {
    const { prompt, results } = await req.json();

    if (!prompt || !results) {
      return new Response('Missing prompt or results', { status: 400 });
    }

    // Force grab process.env or fallback to literal if missed by Next HMR cache
    const apiKey = process.env.NVIDIA_KEY;
    if (!apiKey) {
      return new Response('NVIDIA_KEY environment variable is not set', { status: 500 });
    }

    const nvidiaClient = createOpenAI({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: apiKey,
    });

    const topContext = results.slice(0, 4).map((r: any, idx: number) => {
      return `[Source ${idx + 1} - ${r.url}]\n${r.title}\n${r.description}\nCode Snippet: ${r.codeSnippets || 'None'}\n`;
    }).join("\n---\n");

    const systemPrompt = `You are Trace AI, an intelligent, concise search engine assistant specifically tailored for developers.
Given the following top search results, formulate a high-quality, deeply technical answer to the user's query.
IMPORTANT: Keep your answer to a MAXIMUM of 10 sentences. Be direct and dense — no intro phrases, no conclusions, no padding.
If the context contains code snippets, utilize them. If context is insufficient, answer from your own knowledge.

SEARCH CONTEXT:
${topContext}`;

    const res = await streamText({
      model: nvidiaClient.chat('meta/llama-3.1-70b-instruct'),
      system: systemPrompt,
      messages: [
        { role: 'user', content: prompt }
      ],
      maxOutputTokens: 250,
    });

    return res.toTextStreamResponse();
  } catch (error: any) {
    console.error("AI GENERATION ERROR:", error.message || error);
    return new Response(error.message || "Internal Server Error", { status: 500 });
  }
}
