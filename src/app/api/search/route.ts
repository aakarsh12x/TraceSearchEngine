import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  try {
    const response = await fetch(`http://localhost:3001/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('Backend search failed');

    const data = await response.json();
    let results: any[] = data.results || [];

    // Handle old FlexSearch layered format: [{field, result:[{id, doc}]}]
    // The new index-manager returns a flat sorted array, but guard against the old format
    if (results.length > 0 && results[0]?.field !== undefined) {
      // Old format - flatten and deduplicate manually
      const FIELD_SCORE: Record<string, number> = { title: 10, description: 5, content: 2, codeSnippets: 1 };
      const scoreMap = new Map<string, { doc: any; score: number }>();
      for (const layer of results) {
        const weight = FIELD_SCORE[layer.field] ?? 1;
        for (const hit of (layer.result || [])) {
          const url = hit.id as string;
          const existing = scoreMap.get(url);
          if (existing) { existing.score += weight; }
          else { scoreMap.set(url, { doc: hit.doc, score: weight }); }
        }
      }
      results = Array.from(scoreMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(({ doc }) => doc);
    }

    // Filter out any entries without a URL
    results = results.filter((r: any) => r?.url);

    return NextResponse.json({ results });
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
    
    const response = await fetch('http://localhost:3001/crawler/start', {
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
