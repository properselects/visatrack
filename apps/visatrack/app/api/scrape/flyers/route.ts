import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { scrapeArtistFlyers } from '@/lib/scraper/instagram-flyers';

export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.object({
  handle: z.string().min(1).max(40).transform((s) => s.replace(/^@/, '').trim().toLowerCase()),
  artistName: z.string().min(1).max(120),
});

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: 'invalid_body', detail: String(err) }, { status: 400 });
  }
  try {
    const bookings = await scrapeArtistFlyers(parsed.handle, parsed.artistName);
    return NextResponse.json({ bookings });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[scrape/flyers]', detail);
    return NextResponse.json({ error: 'scrape_failed', detail }, { status: 500 });
  }
}
