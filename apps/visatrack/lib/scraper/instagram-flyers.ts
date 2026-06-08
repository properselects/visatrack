import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';

const STATE_DIR = path.join(process.cwd(), '.scraper-state');
const STATE_FILE = path.join(STATE_DIR, 'instagram.json');
const IG_APP_ID = '936619743392459';

export interface FlyerBooking {
  postUrl: string;
  imageUrl: string;
  postedBy: string;
  eventName?: string;
  eventDate?: string;
  venue?: string;
  billingPosition?: 'headliner' | 'featured' | 'supporting' | 'unknown';
  otherActs?: string[];
  isFlyer: boolean;
  rawCaption?: string;
}

// -- Browser/context shared with main scraper (same session) -----------------

let browserPromise: Promise<Browser> | null = null;
let contextPromise: Promise<BrowserContext> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
  }
  return browserPromise;
}

async function readStorageState(): Promise<unknown | undefined> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function getContext(): Promise<BrowserContext> {
  if (contextPromise) return contextPromise;
  contextPromise = (async () => {
    const browser = await getBrowser();
    const storageState = await readStorageState();
    return browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      storageState: storageState as never,
    });
  })();
  return contextPromise;
}

// -- Scrape tagged posts for a handle ----------------------------------------

interface TaggedPost {
  shortcode: string;
  imageUrl: string;
  caption: string;
  ownerUsername: string;
  likeCount: number;
}

async function fetchTaggedPosts(page: Page, handle: string): Promise<TaggedPost[]> {
  await page.goto(`https://www.instagram.com/${handle}/tagged/`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });

  if (page.url().includes('/accounts/login')) return [];

  await page.waitForTimeout(2500);

  // Scroll once to load more posts
  await page.evaluate(() => window.scrollBy(0, 1200));
  await page.waitForTimeout(1500);

  // Extract post shortcodes + thumbnail images from the grid
  const posts = await page.evaluate(() => {
    const results: { shortcode: string; imageUrl: string }[] = [];
    const links = Array.from(document.querySelectorAll('a[href*="/p/"]'));
    for (const link of links) {
      const href = (link as HTMLAnchorElement).href;
      const match = href.match(/\/p\/([A-Za-z0-9_-]+)/);
      if (!match) continue;
      const shortcode = match[1];
      if (!shortcode) continue;
      const img = link.querySelector('img');
      const imageUrl = img?.src ?? '';
      if (results.length < 20) results.push({ shortcode, imageUrl });
    }
    return results;
  });

  // For each post, open it and grab caption + poster username
  const enriched: TaggedPost[] = [];
  for (const post of posts.slice(0, 12)) {
    try {
      const postPage = await page.context().newPage();
      await postPage.goto(`https://www.instagram.com/p/${post.shortcode}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await postPage.waitForTimeout(1200);

      const meta = await postPage.evaluate(() => {
        const ownerEl = document.querySelector('a[role="link"] span');
        const captionEl = document.querySelector('h1._ap3a, div._a9zs, div[data-testid="post-comment-root"] span');
        const imgEl = document.querySelector('img._aagt, article img');
        return {
          ownerUsername: ownerEl?.textContent?.trim() ?? '',
          caption: captionEl?.textContent?.trim() ?? '',
          imageUrl: (imgEl as HTMLImageElement)?.src ?? '',
        };
      });

      enriched.push({
        shortcode: post.shortcode,
        imageUrl: meta.imageUrl || post.imageUrl,
        caption: meta.caption,
        ownerUsername: meta.ownerUsername,
        likeCount: 0,
      });
      await postPage.close();
    } catch {
      // skip posts that fail to load
    }
  }

  return enriched;
}

// -- Claude Vision: analyze a single post image ------------------------------

async function analyzeFlyerImage(
  imageUrl: string,
  artistName: string,
  caption: string,
  postedBy: string,
): Promise<Omit<FlyerBooking, 'postUrl' | 'imageUrl' | 'postedBy'>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { isFlyer: false };

  // Fetch image as base64
  let imageBase64: string;
  let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg';
  try {
    const res = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return { isFlyer: false };
    const buf = await res.arrayBuffer();
    imageBase64 = Buffer.from(buf).toString('base64');
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('png')) mediaType = 'image/png';
    else if (ct.includes('webp')) mediaType = 'image/webp';
  } catch {
    return { isFlyer: false };
  }

  const client = new Anthropic({ apiKey });

  const prompt = `This Instagram post was made by @${postedBy} and tags or mentions the artist "${artistName}".

Caption: ${caption || '(none)'}

Analyze the image. Is this a promotional flyer or event announcement?

If YES, extract:
- eventName: the festival, show, or event name
- eventDate: date or dates (e.g. "Aug 12, 2025" or "Summer 2025")
- venue: venue or city/country
- billingPosition: is "${artistName}" listed as "headliner", "featured" (midcard), or "supporting" (bottom of bill)?
- otherActs: up to 5 other artist names visible on the flyer

If NO (regular photo, ad, etc.), just return isFlyer: false.

Respond with ONLY valid JSON, no commentary:
{ "isFlyer": true, "eventName": "...", "eventDate": "...", "venue": "...", "billingPosition": "headliner|featured|supporting|unknown", "otherActs": ["..."] }
or
{ "isFlyer": false }`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const raw = text.trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return { isFlyer: false };

    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      isFlyer: boolean;
      eventName?: string;
      eventDate?: string;
      venue?: string;
      billingPosition?: FlyerBooking['billingPosition'];
      otherActs?: string[];
    };
    return parsed;
  } catch {
    return { isFlyer: false };
  }
}

// -- Main export: scrape + analyze all tagged posts --------------------------

export async function scrapeArtistFlyers(
  handle: string,
  artistName: string,
): Promise<FlyerBooking[]> {
  const ctx = await getContext();
  const page = await ctx.newPage();
  let taggedPosts: TaggedPost[] = [];

  try {
    taggedPosts = await fetchTaggedPosts(page, handle);
  } finally {
    await page.close().catch(() => {});
  }

  if (taggedPosts.length === 0) return [];

  // Analyze images in parallel (cap at 8 concurrent to avoid rate limits)
  const results: FlyerBooking[] = [];
  const CHUNK = 4;
  for (let i = 0; i < taggedPosts.length; i += CHUNK) {
    const chunk = taggedPosts.slice(i, i + CHUNK);
    const analyzed = await Promise.all(
      chunk.map(async (post) => {
        const analysis = await analyzeFlyerImage(
          post.imageUrl,
          artistName,
          post.caption,
          post.ownerUsername,
        );
        return {
          postUrl: `https://www.instagram.com/p/${post.shortcode}/`,
          imageUrl: post.imageUrl,
          postedBy: post.ownerUsername,
          rawCaption: post.caption,
          ...analysis,
        } satisfies FlyerBooking;
      }),
    );
    results.push(...analyzed);
  }

  return results.filter((b) => b.isFlyer);
}
