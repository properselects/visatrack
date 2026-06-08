import 'server-only';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { ScrapedPost, ScrapedProfile } from '@/db/schema';

const STATE_DIR = path.join(process.cwd(), '.scraper-state');
const STATE_FILE = path.join(STATE_DIR, 'instagram.json');
const IG_APP_ID = '936619743392459';

export class InstagramScraperError extends Error {
  code:
    | 'account_not_found'
    | 'account_private'
    | 'login_required'
    | 'rate_limited'
    | 'login_failed'
    | 'parse_failed'
    | 'unknown';
  constructor(code: InstagramScraperError['code'], message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

let browserPromise: Promise<Browser> | null = null;
let contextPromise: Promise<BrowserContext> | null = null;

function requireCreds(): { username: string; password: string } {
  const username = process.env.IG_SCRAPER_USERNAME;
  const password = process.env.IG_SCRAPER_PASSWORD;
  if (!username || !password) {
    throw new InstagramScraperError(
      'login_required',
      'Missing IG_SCRAPER_USERNAME / IG_SCRAPER_PASSWORD env',
    );
  }
  return { username, password };
}

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

async function persistStorageState(ctx: BrowserContext) {
  await fs.mkdir(STATE_DIR, { recursive: true });
  const state = await ctx.storageState();
  await fs.writeFile(STATE_FILE, JSON.stringify(state), 'utf8');
}

async function getContext(): Promise<BrowserContext> {
  if (contextPromise) return contextPromise;
  contextPromise = (async () => {
    const browser = await getBrowser();
    const storageState = await readStorageState();
    const ctx = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      // playwright accepts the storageState shape it persisted
      storageState: storageState as never,
    });
    return ctx;
  })();
  return contextPromise;
}

async function isLoggedIn(page: Page): Promise<boolean> {
  // Visit IG home; if not logged in, IG redirects to /accounts/login/
  const resp = await page.goto('https://www.instagram.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  // If we see a form#loginForm or url contains /accounts/login -> not logged in
  await page.waitForTimeout(1500);
  const url = page.url();
  if (url.includes('/accounts/login')) return false;
  const hasLoginForm = await page.$('form#loginForm');
  return !hasLoginForm;
}

async function performLogin(ctx: BrowserContext): Promise<void> {
  const { username, password } = requireCreds();
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    // Cookie banner sometimes intercepts clicks. Dismiss if present.
    try {
      const declineBtn = page.locator('button', {
        hasText: /(decline|only allow essential|reject)/i,
      });
      if ((await declineBtn.count()) > 0) {
        await declineBtn.first().click({ timeout: 3000 }).catch(() => {});
      }
    } catch {
      /* noop */
    }
    await page.waitForSelector('input[type="text"], input[name="username"]', { timeout: 30000 });
    await page.locator('input[type="text"]').first().fill(username);
    await page.locator('input[type="password"]').first().fill(password);
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {}),
      page.getByRole('button', { name: /log in/i }).first().click(),
    ]);
    // Wait a bit for any "Save info" / "Turn on notifications" interstitials.
    await page.waitForTimeout(4000);

    // Dismiss "Save your login info?" if present.
    const notNow = page.locator('button', { hasText: /^not now$/i });
    if ((await notNow.count()) > 0) {
      await notNow.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }

    // Check for failure state — error text under the form.
    const errEl = await page.$('p[data-testid="login-error-message"], #slfErrorAlert');
    if (errEl) {
      const text = (await errEl.textContent()) ?? 'login failed';
      throw new InstagramScraperError('login_failed', text.trim());
    }

    if (page.url().includes('/accounts/login') || page.url().includes('/challenge/')) {
      throw new InstagramScraperError(
        'login_failed',
        `IG redirected to ${page.url()} — likely checkpoint/challenge`,
      );
    }

    await persistStorageState(ctx);
  } finally {
    await page.close().catch(() => {});
  }
}

async function ensureLoggedIn(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();
  try {
    if (await isLoggedIn(page)) return;
  } finally {
    await page.close().catch(() => {});
  }
  await performLogin(ctx);
}

type WebProfileResponse = {
  data?: {
    user?: {
      biography?: string | null;
      full_name?: string | null;
      is_private?: boolean;
      edge_followed_by?: { count?: number };
      edge_follow?: { count?: number };
      edge_owner_to_timeline_media?: {
        count?: number;
        edges?: Array<{
          node: {
            shortcode?: string;
            edge_media_to_caption?: { edges?: Array<{ node: { text?: string } }> };
            edge_liked_by?: { count?: number };
            edge_media_to_comment?: { count?: number };
            taken_at_timestamp?: number;
            is_video?: boolean;
            __typename?: string;
          };
        }>;
      };
    };
  };
};

function classifyMediaType(typename?: string, isVideo?: boolean): ScrapedPost['media_type'] {
  if (typename === 'GraphSidecar' || typename === 'XDTGraphSidecar') return 'carousel';
  if (typename === 'GraphVideo' || typename === 'XDTGraphVideo' || isVideo) return 'video';
  return 'image';
}

function normalizeProfile(handle: string, json: WebProfileResponse): ScrapedProfile {
  const u = json?.data?.user;
  if (!u) {
    throw new InstagramScraperError('parse_failed', 'web_profile_info missing data.user');
  }
  const edges = u.edge_owner_to_timeline_media?.edges ?? [];
  const posts: ScrapedPost[] = edges.map((e) => {
    const n = e.node;
    const caption = n.edge_media_to_caption?.edges?.[0]?.node?.text ?? '';
    return {
      shortcode: n.shortcode ?? '',
      caption,
      like_count: n.edge_liked_by?.count ?? 0,
      comment_count: n.edge_media_to_comment?.count ?? 0,
      taken_at: n.taken_at_timestamp ?? 0,
      media_type: classifyMediaType(n.__typename, n.is_video),
    };
  });
  return {
    handle,
    follower_count: u.edge_followed_by?.count ?? 0,
    following_count: u.edge_follow?.count ?? 0,
    post_count: u.edge_owner_to_timeline_media?.count ?? posts.length,
    bio: u.biography ?? '',
    is_private: !!u.is_private,
    full_name: u.full_name ?? undefined,
    posts,
  };
}

async function fetchWebProfileInfo(page: Page, handle: string): Promise<WebProfileResponse> {
  const result = await page.evaluate(
    async ({ h, appId }: { h: string; appId: string }) => {
      const r = await fetch(
        `/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`,
        { headers: { 'x-ig-app-id': appId, 'x-asbd-id': '129477' } },
      );
      const text = await r.text();
      return { status: r.status, body: text };
    },
    { h: handle, appId: IG_APP_ID },
  );

  if (result.status === 404) {
    throw new InstagramScraperError('account_not_found', `IG user @${handle} not found`);
  }
  if (result.status === 401 || result.status === 403) {
    throw new InstagramScraperError('login_required', `web_profile_info ${result.status}`);
  }
  if (result.status === 429) {
    throw new InstagramScraperError('rate_limited', 'IG returned 429');
  }
  if (result.status >= 400) {
    throw new InstagramScraperError(
      'unknown',
      `web_profile_info ${result.status}: ${result.body.slice(0, 200)}`,
    );
  }
  try {
    return JSON.parse(result.body) as WebProfileResponse;
  } catch (err) {
    throw new InstagramScraperError(
      'parse_failed',
      `web_profile_info JSON parse failed: ${(err as Error).message}`,
    );
  }
}

export async function scrapeProfile(rawHandle: string): Promise<ScrapedProfile> {
  const handle = rawHandle.replace(/^@/, '').trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) {
    throw new InstagramScraperError('parse_failed', `invalid handle: ${rawHandle}`);
  }

  const ctx = await getContext();

  // First attempt — assume cookies are valid.
  const tryOnce = async (): Promise<ScrapedProfile> => {
    const page = await ctx.newPage();
    try {
      // Visit the profile page so the request is in-origin and behaves like a real user.
      const navResp = await page.goto(`https://www.instagram.com/${handle}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      // If IG redirects to the login wall, we're not logged in.
      if (page.url().includes('/accounts/login')) {
        throw new InstagramScraperError('login_required', 'redirected to login');
      }
      if (navResp && navResp.status() === 404) {
        throw new InstagramScraperError('account_not_found', `IG user @${handle} not found`);
      }
      const json = await fetchWebProfileInfo(page, handle);
      const profile = normalizeProfile(handle, json);
      if (profile.is_private) {
        // Still return data we could read (bio + counts), but flag it.
        // Caller can decide; we don't throw because the basic stats are useful.
      }
      return profile;
    } finally {
      await page.close().catch(() => {});
    }
  };

  try {
    await ensureLoggedIn(ctx);
    return await tryOnce();
  } catch (err) {
    if (err instanceof InstagramScraperError && err.code === 'login_required') {
      // Force a fresh login and retry once.
      await performLogin(ctx);
      return tryOnce();
    }
    throw err;
  }
}

export async function disposeScraper() {
  try {
    if (contextPromise) {
      const ctx = await contextPromise;
      await ctx.close();
    }
  } finally {
    contextPromise = null;
  }
  try {
    if (browserPromise) {
      const browser = await browserPromise;
      await browser.close();
    }
  } finally {
    browserPromise = null;
  }
}
