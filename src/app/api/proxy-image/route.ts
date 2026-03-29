import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Only proxy trusted image hosts
  const ALLOWED_HOSTS = [
    'https://firebasestorage.googleapis.com/',
    'https://firebasestorage.app/',
    'https://houseofmina.store/cdn/',
  ];
  if (!ALLOWED_HOSTS.some(h => url.startsWith(h))) {
    return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
  }

  const response = await fetch(url);
  if (!response.ok) {
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: response.status });
  }

  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get('Content-Type') || 'image/png';

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
