import { NextResponse } from 'next/server';
import { searchLiveWeb } from '@/lib/tools/agent-tools';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ results: [], total: 0 });
  }

  try {
    const webQuery = query.trim()
      .replace(/^(?:can\s+you|please|could\s+you|help\s+me|would\s+you)?\s*(?:tell|talk|explain|show|give|find|search|lookup|get|fetch|describe|summarize|provide)\s+(?:me\s+)?(?:(?:about|on|for|with|regarding|to)\s+)?/i, '')
      .replace(/^(?:what\s+is|what\s+are|who\s+is|where\s+is|how\s+does|how\s+do\s+i|how\s+to)\s+/i, '')
      .trim() || query.trim();
    const results = (await searchLiveWeb(webQuery, 10)).map((result) => ({
      url: result.url,
      title: result.title,
      description: result.snippet,
      snippet: result.snippet,
      source: 'web' as const,
    }));

    return NextResponse.json({ results, total: results.length, source: 'web' });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

// Trigger crawler
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const seedUrl = body.seedUrl || 'https://nextjs.org/docs';
    
    const backendUrl = process.env.API_URL || 'http://127.0.0.1:3001';
    const response = await fetch(`${backendUrl}/crawler/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seedUrl })
    });
    
    if (!response.ok) {
      throw new Error("Backend crawl failed");
    }

    return NextResponse.json({ message: 'Crawler started in background' });
  } catch (error) {
    console.error('Crawl Error:', error);
    return NextResponse.json({ error: 'Crawl failed' }, { status: 500 });
  }
}
