import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const backendUrl = process.env.API_URL || 'http://127.0.0.1:3001';
    const response = await fetch(`${backendUrl}/status`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Backend unreachable');
    const data = await response.json();
    return NextResponse.json({ indexReady: data.indexReady ?? false });
  } catch {
    // Backend not yet up — treat as not ready
    return NextResponse.json({ indexReady: false });
  }
}
