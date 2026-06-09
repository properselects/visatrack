// Deterministic mock evidence generator. Seeded by case id so re-renders are stable.
// Returns the evidence_data shape the dossier UI consumes (mirrors visatrack-ai/results.html).

import type { CriteriaCoverage, EvidenceData } from './store';

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const PRESS_OUTLETS = [
  'Mixmag',
  'Resident Advisor',
  'DJ Mag',
  'Pitchfork',
  'Tubefilter',
  'Hypebeast',
  'Insider',
  'Fader',
  'Complex',
  'Billboard',
  'Stereogum',
  'Variety',
];

const CHART_NAMES_BY_PLATFORM: Record<string, string[]> = {
  'DJ / Electronic': ['Beatport Global Rank', 'RA DJ Rank (Tech House)', '1001 Tracklists'],
  'Music / Recording Artist': [
    'Spotify Editorial Placements',
    'Apple Music Country Charts',
    'Shazam Top Discoveries',
  ],
  YouTube: ['Tubefilter Global Rank', 'Social Blade Rank', 'YouTube Trending'],
  TikTok: ['TikTok Creator Index', 'Tubular Labs Rank', 'Trending Sounds Lead'],
  Instagram: ['HypeAuditor Authority', 'CreatorIQ Rank', 'Vogue 100'],
  Twitch: ['Twitch Tracker Rank', 'Sully Gnome Top', 'StreamCharts Rank'],
};

const SOCIALS = [
  { platform: 'Spotify Monthly Listeners', unit: 'K' },
  { platform: 'Instagram Followers', unit: 'K' },
  { platform: 'TikTok Followers', unit: 'K' },
  { platform: 'YouTube Subscribers', unit: 'K' },
  { platform: 'SoundCloud Followers', unit: 'K' },
];

const TESTIMONIAL_VOICES = [
  { author: 'Dixon', role: 'Founder, Innervisions' },
  { author: 'Anna Lunoe', role: 'Festival Booker, HARD Events' },
  { author: 'Sasha Frere-Jones', role: 'Music Critic, formerly The New Yorker' },
  { author: 'Marie Claude', role: 'A&R Director, Ninja Tune' },
  { author: 'Hito Kanazawa', role: 'CEO, Tomorrowland Asia' },
  { author: 'Alia Schwartz', role: 'Head of Talent, Boiler Room' },
  { author: 'Kris Wright', role: 'Creator Partnerships, YouTube' },
  { author: 'Jamie Cole', role: 'EVP, WME Music' },
];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

const BOOKING_AGENCIES = [
  { scope: 'Global Booking', names: ['Earth Agency', 'Wasserman Music', 'Paradigm', 'WME'] },
  { scope: 'US Booking', names: ['United Talent Agency (UTA)', 'CAA', 'AM Only / Paradigm'] },
  { scope: 'UK / EU Booking', names: ['Frame Artists', 'Polytone', 'X-Ray Touring'] },
];

const RECOGNITION_TAGS = [
  { tag: 'EDITORIAL FEATURE', titleFn: (n: string) => `"Ones to Watch" — ${n} named breakout act` },
  { tag: 'RADIO SUPPORT', titleFn: () => `National radio airplay & support` },
  { tag: 'INVITED SHOWCASE', titleFn: () => `Invitation-only showcase / lab session` },
  { tag: 'PEER RECOGNITION', titleFn: (n: string) => `${n} cited by established artists in the scene` },
];

const VENUES = [
  ['Fabric', 'London, UK'],
  ['Studio 338', 'London, UK'],
  ['Thuishaven', 'Amsterdam, NL'],
  ['Factory Town', 'Miami, US'],
  ['Printworks', 'London, UK'],
  ['Ministry of Sound', 'London, UK'],
  ['WOMB', 'Tokyo, JP'],
  ['Pacha', 'Ibiza, ES'],
  ['Output', 'Brooklyn, US'],
  ['Hï Ibiza', 'Ibiza, ES'],
] as const;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function generateEvidence(
  caseId: string,
  stageName: string,
  genre: string,
  platform: string,
): EvidenceData {
  const r = rand(hashSeed(caseId));
  const chartNames =
    CHART_NAMES_BY_PLATFORM[platform] ?? CHART_NAMES_BY_PLATFORM['DJ / Electronic'] ?? [];
  const charts = chartNames.slice(0, 3).map((name) => {
    const rank = Math.floor(r() * 90) + 5;
    return { name, rank: `#${rank}`, bar: 100 - rank };
  });

  const pressCount = 8 + Math.floor(r() * 14);
  const press = Array.from({ length: 3 }).map((_, i) => {
    const outlet = PRESS_OUTLETS[Math.floor(r() * PRESS_OUTLETS.length)] ?? 'Mixmag';
    const titles = [
      `"${stageName} is the ${genre.toLowerCase()} act everyone's talking about"`,
      `"Inside the rise of ${stageName}"`,
      `"Why ${stageName} is rewriting the ${genre.toLowerCase()} playbook"`,
      `"${stageName} — Artist of the Week"`,
      `"${stageName} headlines our ${genre} spotlight"`,
    ];
    const idx = (Math.floor(r() * titles.length) + i) % titles.length;
    return {
      outlet,
      title: titles[idx] ?? `"Profile of ${stageName}"`,
      year: 2024 + Math.floor(r() * 2),
    };
  });

  const social = SOCIALS.map((s) => {
    const value = Math.floor(r() * 4_500_000) + 80_000;
    return { platform: s.platform, metric: 'followers', value: fmtNum(value) };
  });

  const events = [
    'Tomorrowland Main Stage 2025',
    'Ultra Miami 2025',
    'Boiler Room São Paulo',
    'Awakenings Festival (3 dates)',
    'Coachella Mojave Stage',
    'Primavera Sound Barcelona',
    'Glastonbury Park Stage',
  ];
  const contracts = events.slice(0, 4).map((event) => ({
    event,
    amount: `$${(Math.floor(r() * 70) + 18) * 1000}`,
  }));

  const testimonials = TESTIMONIAL_VOICES.slice(0, 3).map((v) => ({
    author: v.author,
    role: v.role,
    preview: `In my time working with ${stageName}, I have rarely encountered a ${genre.toLowerCase()} act with such a combination of technical mastery, international recognition, and consistent demand. They command premium fees across every market…`,
  }));

  const briefSummary = [
    'Criterion 1 — Lead/starring role: documented across festival lineups and headline tours.',
    'Criterion 2 — National/intl recognition: chart placements + 9 international press features.',
    'Criterion 3 — Critical reviews: 4 long-form features in tier-1 publications.',
    'Criterion 4 — Commercial success: chart positions, streaming volume, ticket revenue.',
    'Criterion 5 — Recognition by experts: 8 testimonial letters (3 in voice).',
    'Criterion 6 — High salary: contracts averaging well above genre median.',
    'Criterion 7 — Original contributions: production credits + label catalog.',
    'Criterion 8 — Display at major venues: festival main stages 2024–25.',
  ];

  const topPosts = [
    {
      title: `"GRWM — ${genre} stage" (TikTok)`,
      platform: 'TikTok',
      views: `${(Math.floor(r() * 60) + 24).toFixed(1)}M views`,
    },
    {
      title: `"Behind the booth — ${stageName} live"`,
      platform: 'YouTube',
      views: `${(Math.floor(r() * 18) + 6).toFixed(1)}M views`,
    },
    {
      title: `"Studio session — ${genre}"`,
      platform: 'Instagram',
      views: `${(Math.floor(r() * 12) + 3).toFixed(1)}M views`,
    },
  ];

  const dealTotal = (Math.floor(r() * 600) + 120) * 1000;
  const partners = ['Nike', 'Spotify', 'Apple', 'YouTube', 'Adidas'] as const;
  const brandDeals = {
    count: Math.floor(r() * 12) + 6,
    total: `$${dealTotal.toLocaleString('en-US')}`,
    topPartner: partners[Math.floor(r() * partners.length)] ?? 'Nike',
    topAmount: `$${(Math.floor(r() * 60) + 35) * 1000}`,
  };

  const monetization = [
    { item: 'YouTube Partner Program', status: 'Verified' },
    { item: 'TikTok Creator Fund + Creativity Program', status: 'Verified' },
    { item: 'Avg monthly platform revenue', status: `$${(Math.floor(r() * 30) + 8) * 1000}` },
  ];

  // augment last press item to reflect the count visible elsewhere
  const last = press[2];
  if (last) {
    press[2] = { ...last, title: `${last.title} (+ ${pressCount - 3} more hits)` };
  }

  // ── Full visa-portfolio sections (modeled on artist evidence portfolios) ──

  const activeYear = 2026 - (Math.floor(r() * 12) + 4); // active 4–15 years
  const topSocial = social[0]?.value ?? '—';
  const topChartRank = charts[0]?.rank ?? '—';
  const festCount = Math.floor(r() * 40) + 18;

  const bio = {
    overview: `${stageName} is a ${genre.toLowerCase()} artist with sustained international recognition across the ${platform} ecosystem. Represented by major booking agencies and supported by tier-1 press, they have built a documented record of headline performances, charting releases, and consistent commercial demand — hallmarks of an artist of extraordinary ability under the O-1B standard.`,
    activeSince: String(activeYear),
    stats: [
      { value: String(activeYear), label: 'Active Since' },
      { value: topSocial, label: 'Top Platform Reach' },
      { value: topChartRank, label: 'Peak Chart Rank' },
      { value: String(festCount), label: 'Festival Appearances' },
    ],
    milestones: [
      { year: String(activeYear), event: `${stageName} begins performing professionally` },
      { year: String(activeYear + 2), event: 'First international bookings + agency representation' },
      { year: String(activeYear + 4), event: `Debut release charts; tier-1 press coverage begins` },
      { year: '2025', event: `Headline festival main-stage appearances across UK, EU, and US` },
      { year: '2026', event: 'Sustained multi-country touring; expanded press & chart record' },
    ],
  };

  const representation = BOOKING_AGENCIES.map((a) => ({
    scope: a.scope,
    agency: a.names[Math.floor(r() * a.names.length)] ?? a.names[0]!,
    detail: `Officially represented for ${a.scope.toLowerCase()}. Confirms sustained professional career and demand across the territory.`,
  }));

  const recognition = RECOGNITION_TAGS.map((rt) => ({
    tag: rt.tag,
    title: rt.titleFn(stageName),
    detail:
      'Documented industry recognition — a marker of national/international acclaim relevant to the O-1B "recognition" criteria.',
  }));

  const pickVenue = () => VENUES[Math.floor(r() * VENUES.length)] ?? VENUES[0];
  const eventHistory = Array.from({ length: 6 }).map(() => {
    const [venue, location] = pickVenue();
    const day = Math.floor(r() * 27) + 1;
    const month = MONTHS[Math.floor(r() * MONTHS.length)] ?? 'OCT';
    return {
      date: `${day} ${month} ${2025 + Math.floor(r() * 2)}`,
      name: `${stageName} ${r() > 0.5 ? 'headline set' : 'b2b showcase'}`,
      venue,
      location,
    };
  });

  const eventFlyers = Array.from({ length: 4 }).map((_, i) => {
    const [venue, location] = pickVenue();
    const day = Math.floor(r() * 27) + 1;
    const month = MONTHS[Math.floor(r() * MONTHS.length)] ?? 'MAR';
    return {
      event: i === 0 ? `${stageName} presents` : `${venue} pres. ${stageName}`,
      date: `${day} ${month} 2026`,
      venue: `${venue}, ${location}`,
      billing: i < 2 ? 'Headline / top billing' : 'Featured artist',
    };
  });

  const tourPosters = [
    {
      title: 'Spring 2026 Dates',
      dates: eventHistory.slice(0, 3).map((e) => `${e.date} — ${e.venue}, ${e.location}`),
    },
    {
      title: 'Winter 2025 Dates',
      dates: eventHistory.slice(3, 6).map((e) => `${e.date} — ${e.venue}, ${e.location}`),
    },
  ];

  const pressPhotos = [
    { caption: 'Official press photo — primary (used in agency listings & media)' },
    { caption: 'Official press photo — editorial / feature use' },
    { caption: 'Live performance still — festival main stage' },
  ];

  const portfolioSummary = [
    { label: 'Booking Agencies', value: representation.map((rrep) => rrep.agency).join(', ') },
    { label: 'Industry Recognition', value: recognition.map((rr) => rr.tag).slice(0, 2).join(', ') },
    {
      label: 'Chart Achievements',
      value: charts.map((ch) => `${ch.name} ${ch.rank}`).slice(0, 2).join('; '),
    },
    { label: 'Top Platform Reach', value: topSocial },
    {
      label: 'Major Venues Performed',
      value: eventHistory.slice(0, 4).map((e) => e.venue).join(', '),
    },
    { label: 'Event Flyers (confirmed bookings)', value: `${eventFlyers.length} included` },
    { label: 'Tour Announcements', value: `${tourPosters.length} multi-country schedules` },
    { label: 'Festival Appearances', value: `${festCount}+ on record since ${activeYear}` },
  ];

  return {
    press,
    charts,
    social,
    contracts,
    testimonials,
    briefSummary,
    topPosts,
    brandDeals,
    monetization,
    bio,
    representation,
    recognition,
    events: eventHistory,
    eventFlyers,
    tourPosters,
    pressPhotos,
    portfolioSummary,
  };
}

export function scoreEvidence(caseId: string): number {
  const r = rand(hashSeed(caseId + ':score'));
  return Math.floor(r() * 18) + 78; // 78–95
}

export function criteriaCoverage(caseId: string): CriteriaCoverage {
  const r = rand(hashSeed(caseId + ':criteria'));
  return {
    awards: r() > 0.4,
    press: true,
    judging: r() > 0.7,
    originalContributions: r() > 0.3,
    authorship: r() > 0.55,
    leadingRole: true,
    highSalary: r() > 0.25,
    commercialSuccess: r() > 0.2,
  };
}

export function coverageCount(c: CriteriaCoverage | undefined): number {
  if (!c) return 0;
  return Object.values(c).filter(Boolean).length;
}
