import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

export async function POST(req: Request) {
  try {
    const { term, mainQuery = '' } = await req.json();

    if (!term) {
      return new Response('Missing term parameter', { status: 400 });
    }

    const apiKey = process.env.NVIDIA_KEY;
    if (!apiKey) {
      return new Response('NVIDIA_KEY environment variable is not set', { status: 500 });
    }

    const nvidiaClient = createOpenAI({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: apiKey,
    });

    const systemPrompt = `You are Trace Concept Inspector, a fast technical dictionary for software developers.

The user is reading an explanation about: "${mainQuery}"
They clicked to inspect the specific term: "${term}"

INSTRUCTIONS:
1. Explain "${term}" in the context of "${mainQuery}".
2. Format your response cleanly into 3 sections:
   - **Overview**: 2 concise sentences explaining what it is.
   - **Role**: 2 sentences on why it matters here.
   - **Quick Command / Example**: A short code block or command if applicable.
3. Be direct, precise, and developer-focused. Keep response under 150 words.`;

    const aiResult = await streamText({
      model: nvidiaClient.chat(process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct'),
      system: systemPrompt,
      messages: [{ role: 'user', content: `Explain term: ${term}` }],
      maxOutputTokens: 250,
    });

    return aiResult.toTextStreamResponse();
  } catch (error: any) {
    console.error('EXPLAIN TERM ERROR:', error.message || error);
    return new Response(`Error: ${error.message || 'Internal error'}`, { status: 500 });
  }
}
