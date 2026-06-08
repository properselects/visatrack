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
  ]
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
- monetization: exactly 3 items: platform revenue verification, average booking fee, annual revenue.`;

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

export async function generateEvidenceFromIntake(
  _caseId: string,
  intake: Record<string, string>,
): Promise<EvidenceData> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });

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

  return parsed;
}
