import Anthropic from '@anthropic-ai/sdk';
import type { EvidenceData } from './store';

const SYSTEM_PROMPT = `You are generating a visa petition dossier evidence summary for an artist applying for a U.S. O-1B visa. Given the artist's intake data, produce a realistic, personalized evidence record.

Output ONLY strictly valid JSON matching this exact shape — no markdown fences, no commentary:
{
  "press": [
    { "outlet": "string", "title": "string", "year": 2024, "url": "optional string" }
  ],
  "charts": [
    { "name": "string", "rank": "string e.g. #12", "bar": 88 }
  ],
  "social": [
    { "platform": "string", "metric": "followers", "value": "string e.g. 1.2M" }
  ],
  "contracts": [
    { "event": "string", "amount": "string e.g. $18,000" }
  ],
  "testimonials": [
    { "author": "string", "role": "string", "preview": "string (2-3 sentences in the voice of the reference)" }
  ],
  "briefSummary": ["string (8 entries, one per O-1B criterion)"],
  "topPosts": [
    { "title": "string", "platform": "string", "views": "string e.g. 14.2M views" }
  ],
  "brandDeals": { "count": 12, "total": "$480,000", "topPartner": "string", "topAmount": "$65,000" },
  "monetization": [
    { "item": "string", "status": "string" }
  ],
  "bio": {
    "overview": "string (3-4 sentences: who the artist is, their scene, why they meet the O-1B extraordinary-ability bar)",
    "activeSince": "string year e.g. 2014",
    "stats": [ { "value": "string", "label": "string" } ],
    "milestones": [ { "year": "string", "event": "string" } ]
  },
  "representation": [ { "scope": "string", "agency": "string", "detail": "string" } ],
  "recognition": [ { "tag": "string UPPERCASE", "title": "string", "detail": "string" } ],
  "events": [ { "date": "string e.g. 12 OCT 2025", "name": "string", "venue": "string", "location": "string e.g. London, UK" } ],
  "eventFlyers": [ { "event": "string", "date": "string", "venue": "string", "billing": "string" } ],
  "tourPosters": [ { "title": "string e.g. Spring 2026 Dates", "dates": ["string e.g. 12 OCT — Fabric, London, UK"] } ],
  "pressPhotos": [ { "caption": "string" } ],
  "portfolioSummary": [ { "label": "string", "value": "string" } ]
}

Rules:
- press: exactly 3 items. Choose outlets that match the genre/platform (e.g. DJ Mag for electronic, Billboard for pop, Variety for film/TV, Pitchfork for indie). Titles should be specific feature headlines about the artist by name.
- charts: exactly 3 items. Choose chart names that fit the platform. bar = 100 minus the numeric rank.
- social: exactly 5 items across different platforms. Distribute total_followers plausibly.
- contracts: exactly 4 items using the big_gigs field plus avg_fee/top_fee for amounts.
- testimonials: exactly 3 items. Pick author names and roles from the references field or invent credible industry voices that match the scene.
- briefSummary: exactly 8 strings, one per criterion: Lead/Starring Role, National/Intl Recognition, Critical Reviews, Commercial Success, Recognition by Experts, High Salary, Original Contributions, Display at Major Venues.
- topPosts: exactly 3 items.
- brandDeals: derive from brand_deals_count, brand_partners, biggest_brand_deal.
- monetization: exactly 3 items: platform revenue verification, average booking fee, annual revenue.
- bio: stats = exactly 4 tiles (e.g. Active Since, Top Platform Reach, Peak Chart Rank, Festival Appearances). milestones = 4-6 chronological career highlights, derived from years_active and big_gigs.
- representation: exactly 3 items — Global Booking, US Booking, UK/EU Booking. Use credible agency names for the scene (e.g. Earth Agency, UTA, Wasserman, Paradigm, WME, Frame Artists). detail = one sentence on what it proves.
- recognition: 3-4 items. tag is a short UPPERCASE label (e.g. EDITORIAL FEATURE, RADIO SUPPORT, INVITED SHOWCASE, PEER RECOGNITION). Ground in genre/scene.
- events: 6 items — verified performance history at named venues, derived from big_gigs where possible.
- eventFlyers: 4 items — confirmed bookings with billing position. These are strong O-1B evidence (named venue + artist billing).
- tourPosters: 2 items — multi-date tour announcements spanning multiple countries, built from the events list.
- pressPhotos: exactly 3 caption strings (primary press photo, editorial photo, live performance still). No image URLs.
- portfolioSummary: 6-8 label/value rows summarizing the whole portfolio at a glance.`;

function tryParseJson<T>(text: string): T | null {
  const candidate = text.trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

interface FlyerBooking {
  postUrl: string;
  eventName?: string;
  eventDate?: string;
  venue?: string;
  billingPosition?: string;
  otherActs?: string[];
}

async function tryScrapeFlyerBookings(
  igHandle: string,
  stageName: string,
): Promise<FlyerBooking[]> {
  // FLYER_SCRAPER_URL points to the Railway worker service where Playwright runs.
  // Not set on Vercel — returns empty and Claude falls back to intake data.
  const scraperUrl = process.env.FLYER_SCRAPER_URL;
  if (!scraperUrl) return [];
  try {
    const res = await fetch(`${scraperUrl}/scrape/flyers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: igHandle, artistName: stageName }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { bookings?: FlyerBooking[] };
    return data.bookings ?? [];
  } catch {
    return [];
  }
}

export async function generateEvidenceFromIntake(
  _caseId: string,
  intake: Record<string, string>,
): Promise<EvidenceData> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });

  const igRaw = intake.instagram ?? '';
  const igHandle = igRaw.replace(/^@/, '').replace(/.*instagram\.com\//, '').replace(/\/$/, '').trim();
  const stageName = intake.stage_name || intake.legal_name || '';

  // Best-effort flyer scrape — runs only when IG creds are configured
  const flyerBookings = igHandle
    ? await tryScrapeFlyerBookings(igHandle, stageName)
    : [];

  const flyerSection =
    flyerBookings.length > 0
      ? `\nVerified Instagram flyer bookings (scraped from tagged posts — use these for contracts):\n${flyerBookings
          .map(
            (b) =>
              `- ${b.eventName ?? 'Event'}${b.eventDate ? ` (${b.eventDate})` : ''}${b.venue ? ` @ ${b.venue}` : ''}${b.billingPosition ? ` — billing: ${b.billingPosition}` : ''}${b.postUrl ? ` — ${b.postUrl}` : ''}`,
          )
          .join('\n')}`
      : '';

  const userPrompt = `Generate a dossier evidence summary for this artist:

Name: ${intake.stage_name || intake.legal_name || 'Unknown'}
Genre / niche: ${intake.genre || 'Unknown'}
Primary platform: ${intake.primary_platform || 'Unknown'}
Total followers: ${intake.total_followers || 'Unknown'}
Monthly reach: ${intake.monthly_reach || 'Unknown'}
Years active: ${intake.years_active || 'Unknown'}

Biggest moments (last 3 years):
${intake.big_gigs || 'Not provided'}

Brand partners:
${intake.brand_partners || 'Not provided'}
Biggest brand deal: ${intake.biggest_brand_deal || 'Not provided'}
Brand deals (last 12 mo): ${intake.brand_deals_count || 'Unknown'}

Average gig fee: ${intake.avg_fee || 'Unknown'}
Highest single payday: ${intake.top_fee || 'Unknown'}
Annual revenue: ${intake.annual_revenue || 'Unknown'}

Press URLs (provided by artist):
${intake.press || 'None provided'}

Industry references:
${intake.references || 'Not provided'}

Notes:
${intake.notes || 'None'}
${flyerSection}
Output the JSON evidence record now.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    // Static system prompt — cache it so repeat intakes only pay for the
    // (small, per-artist) user prompt. Mirrors apps/web/app/api/intake-hint.
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const parsed = tryParseJson<EvidenceData>(text);
  if (!parsed) throw new Error('AI returned unparseable evidence JSON');
  // The dossier renderer accesses the legacy fields below without guards, so a
  // truncated/partial AI response (e.g. hitting max_tokens) would crash the
  // page. Validate the required shape here; on failure the caller falls back to
  // the deterministic mock generator.
  if (!isValidEvidence(parsed)) {
    throw new Error('AI returned incomplete evidence JSON (missing required fields)');
  }

  return parsed;
}

function isValidEvidence(e: unknown): e is EvidenceData {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  const requiredArrays = [
    'press',
    'charts',
    'social',
    'contracts',
    'testimonials',
    'briefSummary',
    'topPosts',
    'monetization',
  ] as const;
  for (const k of requiredArrays) {
    if (!Array.isArray(o[k])) return false;
  }
  if (!o.brandDeals || typeof o.brandDeals !== 'object') return false;
  return true;
}
