// Force-login test — skips session cache, always logs in fresh
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

const STATE_DIR = path.join(process.cwd(), '.scraper-state');
const STATE_FILE = path.join(STATE_DIR, 'instagram.json');

const USERNAME = process.env.IG_USERNAME;
const PASSWORD = process.env.IG_PASSWORD;

if (!USERNAME || !PASSWORD) { console.error('Set IG_USERNAME and IG_PASSWORD'); process.exit(1); }

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
});

const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
});

const page = await ctx.newPage();

console.log('→ Opening login page...');
await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);

// Dismiss cookie/consent banner
try {
  for (const text of ['Decline optional cookies', 'Only allow essential cookies', 'Reject all']) {
    const btn = page.getByRole('button', { name: new RegExp(text, 'i') });
    if (await btn.count() > 0) { await btn.first().click(); await page.waitForTimeout(1000); break; }
  }
} catch {}

// Screenshot to see current page state
await page.screenshot({ path: '/tmp/ig-pre-login.png' });
console.log('→ Screenshot saved to /tmp/ig-pre-login.png');

console.log('→ Filling credentials...');
// Instagram now uses generic inputs — target by type and position
await page.waitForSelector('input[type="text"], input[name="username"]', { timeout: 30000 });
// First text input = username/email; first password input = password
await page.locator('input[type="text"]').first().fill(USERNAME);
await page.locator('input[type="password"]').first().fill(PASSWORD);

console.log('→ Submitting...');
// Try submit button variations
const submitBtn = page.getByRole('button', { name: /log in/i }).first();
await submitBtn.click({ timeout: 15000 });
await page.waitForTimeout(6000);

const finalUrl = page.url();
console.log('→ Final URL:', finalUrl);

const errEl = await page.$('[role="alert"], #slfErrorAlert, p[data-testid="login-error-message"]');
if (errEl) {
  console.error('✗ Login error:', (await errEl.textContent())?.trim());
  await browser.close(); process.exit(1);
}
if (finalUrl.includes('/accounts/login') || finalUrl.includes('/challenge/') || finalUrl.includes('/checkpoint/')) {
  await page.screenshot({ path: '/tmp/ig-login-debug.png' });
  console.error('✗ Still on login/challenge page. Screenshot: /tmp/ig-login-debug.png');
  await browser.close(); process.exit(1);
}

// Dismiss "Save info" interstitial
try {
  const notNow = page.getByRole('button', { name: /not now/i });
  if (await notNow.count() > 0) { await notNow.first().click(); await page.waitForTimeout(1500); }
} catch {}

console.log('✓ Login successful! Saving session...');
await fs.mkdir(STATE_DIR, { recursive: true });
await fs.writeFile(STATE_FILE, JSON.stringify(await ctx.storageState()), 'utf8');
console.log('✓ Session saved to', STATE_FILE);

await browser.close();
