// JSON-file-backed datastore for marketplace MVP.
// Mirrors the Drizzle schema in packages/db, but lets the demo run without Postgres.
// On first read it seeds from packages/db/src/seed-marketplace.ts data if the file is empty.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PRICING,
  AUDIT_WINDOW_MS,
  PREVIEW_WINDOW_MS as PREVIEW_WINDOW_MS_FROM_PRICING,
} from './pricing';

export type ArtistAccount = {
  id: string;
  email: string;
  legalName?: string;
  stageName?: string;
  phone?: string;
  citizenship?: string;
  basedIn?: string;
  createdAt: string;
};

export type CriteriaCoverage = {
  awards: boolean;
  press: boolean;
  judging: boolean;
  originalContributions: boolean;
  authorship: boolean;
  leadingRole: boolean;
  highSalary: boolean;
  commercialSuccess: boolean;
};

export type EvidenceData = {
  press: { outlet: string; title: string; year: number; url?: string }[];
  charts: { name: string; rank: string; bar: number }[];
  social: { platform: string; metric: string; value: string }[];
  contracts: { event: string; amount: string }[];
  testimonials: { author: string; role: string; preview: string }[];
  briefSummary: string[];
  topPosts: { title: string; platform: string; views: string }[];
  brandDeals: { count: number; total: string; topPartner: string; topAmount: string };
  monetization: { item: string; status: string }[];
  // Full visa-portfolio sections (modeled on artist evidence portfolios like RUZE).
  // Optional so older persisted cases without them still render.
  bio?: {
    overview: string;
    activeSince: string;
    stats: { value: string; label: string }[];
    milestones: { year: string; event: string }[];
  };
  representation?: { scope: string; agency: string; detail: string }[];
  recognition?: { tag: string; title: string; detail: string }[];
  events?: { date: string; name: string; venue: string; location: string }[];
  eventFlyers?: { event: string; date: string; venue: string; billing: string }[];
  tourPosters?: { title: string; dates: string[] }[];
  pressPhotos?: { caption: string }[];
  portfolioSummary?: { label: string; value: string }[];
};

export type ArtistCaseStatus =
  | 'intake'
  | 'processing'
  | 'dossier_preview'
  | 'audited'
  | 'audit_expired'
  | 'dossier_ready'
  | 'listed'
  | 'matched'
  | 'claimed'
  | 'released_back'
  | 'closed';

export type ArtistCase = {
  id: string;
  artistId: string;
  visaType: string;
  intakeData: Record<string, string>;
  evidenceData?: EvidenceData;
  evidenceScore?: number;
  criteriaCoverage?: CriteriaCoverage;
  status: ArtistCaseStatus;
  targetVisaDate?: string;
  location?: string;
  budgetBand?: string;
  briefNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type FirmStatus = 'pending' | 'approved' | 'suspended';

export type FirmProfile = {
  id: string;
  displayName: string;
  slug: string;
  logoUrl?: string;
  bio?: string;
  specialties: string[];
  languages: string[];
  feePhilosophy?: string;
  casesHandled: number;
  status: FirmStatus;
  ailaMember: boolean;
  contactEmail: string;
  contactName?: string;
  appliedAt: string;
  approvedAt?: string;
};

// DEPRECATED — v2 claim model. Kept for one release behind a feature flag so
// historical bid rows in marketplace.json continue to deserialize. Read-only.
export type BidStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';
export type FirmBid = {
  id: string;
  caseId: string;
  firmId: string;
  priceCents: number;
  timelineWeeks: number;
  pitch: string;
  sampleUrl?: string;
  status: BidStatus;
  submittedAt: string;
  decidedAt?: string;
};

export type ClaimStatus = 'active' | 'engaged' | 'released' | 'closed';

// Stripe charge wiring is Track B. For the demo we just record the unlock fee
// captured from CASE_PRICING at claim time.
export type FirmClaim = {
  id: string;
  caseId: string;
  firmId: string;
  unlockFeeCents: number;
  status: ClaimStatus;
  claimedAt: string;
  engagedAt?: string;
  releasedAt?: string;
  releaseReason?: string;
};

export type FirmScore = {
  firmId: string;
  claimsTotal: number;
  engagedWithinWindow: number;
  // 0–100, weighted toward engagement-within-window ratio.
  score: number;
  updatedAt: string;
};

// Evidence-quality bands → flat unlock fee (cents). v2 claim model.
// Sourced from PRICING.case_unlock_by_band so prices have a single source of
// truth across artist audit funnel and firm marketplace.
export const CASE_PRICING = {
  low: PRICING.case_unlock_by_band.low,
  medium: PRICING.case_unlock_by_band.medium,
  high: PRICING.case_unlock_by_band.high,
} as const;

export type PricingBand = keyof typeof CASE_PRICING;

export type AuditTier = 'standard' | 'concierge';
export type AuditAddonKind =
  | 'manager_kit'
  | 'express_evidence'
  | 'relist_boost'
  | 're_audit';

// Audit purchases. Stripe wiring is Track B — `stripeChargeId` stays null in
// the demo. `expiresAt = paidAt + 90d`. If `refundedAt` is set the audit no
// longer counts as valid.
export type ArtistAudit = {
  id: string;
  caseId: string;
  tier: AuditTier;
  priceCents: number;
  paidAt: string;
  expiresAt: string;
  refundedAt?: string;
  stripeChargeId?: string | null;
};

export type AuditAddon = {
  id: string;
  caseId: string;
  kind: AuditAddonKind;
  priceCents: number;
  purchasedAt: string;
};

export const ENGAGEMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function pricingBandForScore(score: number | undefined | null): PricingBand {
  const s = score ?? 0;
  if (s >= 90) return 'high';
  if (s >= 80) return 'medium';
  return 'low';
}

export function unlockFeeCentsForCase(c: Pick<ArtistCase, 'evidenceScore'>): number {
  return CASE_PRICING[pricingBandForScore(c.evidenceScore)];
}

export type MagicLinkToken = {
  id: string;
  email: string;
  role: 'artist' | 'firm' | 'admin';
  token: string;
  expiresAt: string;
  usedAt?: string;
  // for artist links, optionally remember the case id we created at intake
  caseId?: string;
};

// Handoff is now created on claim. acceptedBidId is optional (legacy) — claims
// reference is on `claimId` for v2 rows.
export type Handoff = {
  id: string;
  caseId: string;
  firmId: string;
  claimId?: string;
  acceptedBidId?: string; // DEPRECATED — v2 claim model
  introSentAt?: string;
  retainerUrl?: string;
  notes?: string;
  createdAt: string;
};

export type FirmWaitlistEntry = {
  id: string;
  firmName: string;
  contactName?: string;
  contactEmail: string;
  website?: string;
  ailaMember: boolean;
  casesLast12Mo?: number;
  appliedAt: string;
  status: FirmStatus;
};

export type StoreShape = {
  artists: ArtistAccount[];
  cases: ArtistCase[];
  firms: FirmProfile[];
  bids: FirmBid[]; // DEPRECATED — v2 claim model. Retained for one release behind flag.
  claims: FirmClaim[];
  firmScores: FirmScore[];
  tokens: MagicLinkToken[];
  handoffs: Handoff[];
  waitlist: FirmWaitlistEntry[];
  audits: ArtistAudit[];
  auditAddons: AuditAddon[];
};

const DATA_DIR = path.join(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'marketplace.json');

const empty = (): StoreShape => ({
  artists: [],
  cases: [],
  firms: [],
  bids: [],
  claims: [],
  firmScores: [],
  tokens: [],
  handoffs: [],
  waitlist: [],
  audits: [],
  auditAddons: [],
});

let seeded = false;
let lastTickAt = 0;
const TICK_THROTTLE_MS = 60_000;

// Serialize every read-modify-write cycle. The JSON store has no transactions,
// so concurrent mutations would otherwise read the same baseline and the last
// writer would clobber the others (lost writes) — and check-then-act guards
// (e.g. "is this case already claimed?") would not be atomic. This promise
// chain forces mutations to run one at a time. In-process only: correct for the
// single-instance demo; Track B moves to Postgres with real row locks.
let writeLock: Promise<unknown> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeLock.then(fn, fn);
  // Keep the chain alive whether fn resolves or rejects; swallow to avoid
  // unhandled-rejection noise on the chain itself (callers still see errors).
  writeLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<StoreShape> {
  try {
    const txt = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(txt) as Partial<StoreShape>;
    return { ...empty(), ...parsed };
  } catch {
    return empty();
  }
}

async function writeStore(s: StoreShape) {
  await ensureDir();
  await fs.writeFile(STORE_PATH, JSON.stringify(s, null, 2), 'utf8');
}

async function maybeAutoSeed(s: StoreShape): Promise<StoreShape> {
  if (s.firms.length > 0) {
    seeded = true;
    return s;
  }
  // Store is empty (fresh, deleted, or truncated). Always (re)seed — the old
  // `seeded` early-return pinned an empty store in memory until process restart
  // if the file was removed at runtime, silently losing all data.
  const { buildSeed } = await import('./seed-data');
  const seedData = buildSeed();
  await writeStore(seedData);
  seeded = true;
  return seedData;
}

// Auto-release tick — runs at most once per minute on store reads. Demo-grade;
// real implementation moves to Trigger.dev (Track B).
function recomputeFirmScore(s: StoreShape, firmId: string) {
  const claims = s.claims.filter((cl) => cl.firmId === firmId);
  const total = claims.length;
  const engaged = claims.filter((cl) => cl.engagedAt).length;
  const ratio = total === 0 ? 0 : engaged / total;
  const next: FirmScore = {
    firmId,
    claimsTotal: total,
    engagedWithinWindow: engaged,
    score: Math.round(ratio * 100),
    updatedAt: new Date().toISOString(),
  };
  const idx = s.firmScores.findIndex((fs) => fs.firmId === firmId);
  if (idx >= 0) s.firmScores[idx] = next;
  else s.firmScores.push(next);
}

function tickAutoRelease(s: StoreShape): boolean {
  const now = Date.now();
  let mutated = false;
  const touchedFirms = new Set<string>();
  for (const claim of s.claims) {
    if (claim.status !== 'active') continue;
    if (claim.engagedAt) continue;
    const elapsed = now - Date.parse(claim.claimedAt);
    if (elapsed < ENGAGEMENT_WINDOW_MS) continue;
    claim.status = 'released';
    claim.releasedAt = new Date(now).toISOString();
    claim.releaseReason = 'auto-released: 7-day window elapsed without engagement';
    const c = s.cases.find((x) => x.id === claim.caseId);
    if (c) {
      c.status = 'released_back';
      c.updatedAt = claim.releasedAt;
    }
    touchedFirms.add(claim.firmId);
    mutated = true;
  }
  for (const firmId of touchedFirms) recomputeFirmScore(s, firmId);
  return mutated;
}

// Preview/audit expiry: dossier_preview → audit_expired after 48h; audited →
// audit_expired after 90d if not listed/matched/claimed/closed. Demo-grade —
// Track B replaces with Trigger.dev.
function tickAuditLifecycle(s: StoreShape): boolean {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let mutated = false;

  for (const c of s.cases) {
    if (c.status === 'dossier_preview') {
      const elapsed = now - Date.parse(c.createdAt);
      if (elapsed >= PREVIEW_WINDOW_MS_FROM_PRICING) {
        c.status = 'audit_expired';
        c.updatedAt = nowIso;
        mutated = true;
      }
      continue;
    }
    if (c.status === 'audited') {
      const audit = s.audits
        .filter((a) => a.caseId === c.id && !a.refundedAt)
        .sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt))[0];
      if (!audit) continue;
      if (Date.parse(audit.expiresAt) <= now) {
        c.status = 'audit_expired';
        c.updatedAt = nowIso;
        mutated = true;
      }
    }
  }
  return mutated;
}

async function maybeTick(s: StoreShape): Promise<StoreShape> {
  const now = Date.now();
  if (now - lastTickAt < TICK_THROTTLE_MS) return s;
  lastTickAt = now;
  // Run the tick mutation under the write lock on a FRESH snapshot so it can't
  // clobber a concurrent update(). (update() also runs tickAutoRelease on every
  // write, so this read-path tick is a secondary safety net.)
  await withWriteLock(async () => {
    const fresh = await readStore();
    const a = tickAutoRelease(fresh);
    const b = tickAuditLifecycle(fresh);
    if (a || b) await writeStore(fresh);
  });
  return s;
}

// Re-export from pricing.ts so external callers can import from store.
export const PREVIEW_WINDOW_MS = PREVIEW_WINDOW_MS_FROM_PRICING;
export { AUDIT_WINDOW_MS };

export const store = {
  async all(): Promise<StoreShape> {
    const s = await readStore();
    const seededS = await maybeAutoSeed(s);
    return maybeTick(seededS);
  },

  async update(mut: (s: StoreShape) => void): Promise<StoreShape> {
    return withWriteLock(async () => {
      const s = await readStore();
      const seededS = await maybeAutoSeed(s);
      tickAutoRelease(seededS);
      mut(seededS);
      await writeStore(seededS);
      return seededS;
    });
  },

  // Artists
  async upsertArtistByEmail(email: string, patch: Partial<ArtistAccount>): Promise<ArtistAccount> {
    return withWriteLock(async () => {
      const s = await readStore();
      await maybeAutoSeed(s);
      let a = s.artists.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (!a) {
        a = {
          id: randomUUID(),
          email,
          createdAt: new Date().toISOString(),
          ...patch,
        };
        s.artists.push(a);
      } else {
        Object.assign(a, patch);
      }
      await writeStore(s);
      return a;
    });
  },

  async getArtistByEmail(email: string): Promise<ArtistAccount | undefined> {
    const s = await this.all();
    return s.artists.find((x) => x.email.toLowerCase() === email.toLowerCase());
  },

  async getArtistById(id: string): Promise<ArtistAccount | undefined> {
    const s = await this.all();
    return s.artists.find((x) => x.id === id);
  },

  // Cases
  async createCase(c: Omit<ArtistCase, 'id' | 'createdAt' | 'updatedAt'>): Promise<ArtistCase> {
    const now = new Date().toISOString();
    const created: ArtistCase = { ...c, id: randomUUID(), createdAt: now, updatedAt: now };
    await this.update((s) => {
      s.cases.push(created);
    });
    return created;
  },

  async getCase(id: string): Promise<ArtistCase | undefined> {
    const s = await this.all();
    return s.cases.find((c) => c.id === id);
  },

  async updateCase(id: string, patch: Partial<ArtistCase>): Promise<ArtistCase | undefined> {
    let updated: ArtistCase | undefined;
    await this.update((s) => {
      const c = s.cases.find((x) => x.id === id);
      if (!c) return;
      Object.assign(c, patch, { updatedAt: new Date().toISOString() });
      updated = c;
    });
    return updated;
  },

  async listCasesByArtist(artistId: string): Promise<ArtistCase[]> {
    const s = await this.all();
    return s.cases.filter((c) => c.artistId === artistId);
  },

  async listOpenCases(): Promise<ArtistCase[]> {
    const s = await this.all();
    return s.cases.filter((c) => c.status === 'listed');
  },

  // Firms
  async createFirm(f: Omit<FirmProfile, 'id' | 'appliedAt'>): Promise<FirmProfile> {
    const created: FirmProfile = {
      ...f,
      id: randomUUID(),
      appliedAt: new Date().toISOString(),
    };
    await this.update((s) => {
      s.firms.push(created);
    });
    return created;
  },

  async getFirm(id: string): Promise<FirmProfile | undefined> {
    const s = await this.all();
    return s.firms.find((f) => f.id === id);
  },

  async getFirmByEmail(email: string): Promise<FirmProfile | undefined> {
    const s = await this.all();
    return s.firms.find((f) => f.contactEmail.toLowerCase() === email.toLowerCase());
  },

  async updateFirm(id: string, patch: Partial<FirmProfile>): Promise<FirmProfile | undefined> {
    let out: FirmProfile | undefined;
    await this.update((s) => {
      const f = s.firms.find((x) => x.id === id);
      if (!f) return;
      Object.assign(f, patch);
      out = f;
    });
    return out;
  },

  async listApprovedFirms(): Promise<FirmProfile[]> {
    const s = await this.all();
    return s.firms.filter((f) => f.status === 'approved');
  },

  async listPendingFirms(): Promise<FirmProfile[]> {
    const s = await this.all();
    return s.firms.filter((f) => f.status === 'pending');
  },

  // DEPRECATED — v2 claim model. Bid helpers retained read-only behind feature
  // flag. New code should use the claim helpers below.
  async createBid(b: Omit<FirmBid, 'id' | 'submittedAt'>): Promise<FirmBid> {
    const created: FirmBid = {
      ...b,
      id: randomUUID(),
      submittedAt: new Date().toISOString(),
    };
    await this.update((s) => {
      s.bids.push(created);
    });
    return created;
  },

  async getBid(id: string): Promise<FirmBid | undefined> {
    const s = await this.all();
    return s.bids.find((b) => b.id === id);
  },

  async listBidsForCase(caseId: string): Promise<FirmBid[]> {
    const s = await this.all();
    return s.bids.filter((b) => b.caseId === caseId);
  },

  async listBidsByFirm(firmId: string): Promise<FirmBid[]> {
    const s = await this.all();
    return s.bids.filter((b) => b.firmId === firmId);
  },

  async updateBid(id: string, patch: Partial<FirmBid>): Promise<FirmBid | undefined> {
    let out: FirmBid | undefined;
    await this.update((s) => {
      const b = s.bids.find((x) => x.id === id);
      if (!b) return;
      Object.assign(b, patch);
      out = b;
    });
    return out;
  },

  // Claims (v2)
  async createClaim(
    c: Omit<FirmClaim, 'id' | 'claimedAt' | 'status'> & { status?: ClaimStatus },
  ): Promise<FirmClaim> {
    const created: FirmClaim = {
      ...c,
      id: randomUUID(),
      claimedAt: new Date().toISOString(),
      status: c.status ?? 'active',
    };
    await this.update((s) => {
      s.claims.push(created);
      recomputeFirmScore(s, created.firmId);
    });
    return created;
  },

  // Atomic claim: the case-availability check, the claim insert, the case
  // status flip, and the handoff creation all happen inside a SINGLE serialized
  // mutation. This enforces the core invariant — exactly one firm can claim a
  // listed case — even under concurrent requests. (Previously these were
  // separate read-then-write calls, so two firms could both pass the guard and
  // both be charged.)
  async claimCaseAtomic(input: {
    caseId: string;
    firmId: string;
    unlockFeeCents: number;
    notes: string;
  }): Promise<
    | { ok: true; claim: FirmClaim; handoff: Handoff }
    | { ok: false; reason: string }
  > {
    let result: { ok: true; claim: FirmClaim; handoff: Handoff } | { ok: false; reason: string } = {
      ok: false,
      reason: 'unknown',
    };
    await this.update((s) => {
      const c = s.cases.find((x) => x.id === input.caseId);
      if (!c) {
        result = { ok: false, reason: 'case not found' };
        return;
      }
      if (c.status !== 'listed') {
        result = { ok: false, reason: 'case is not available to claim' };
        return;
      }
      const existing = s.claims.find(
        (cl) =>
          cl.caseId === input.caseId && (cl.status === 'active' || cl.status === 'engaged'),
      );
      if (existing) {
        result = { ok: false, reason: 'case already claimed' };
        return;
      }
      const nowIso = new Date().toISOString();
      const claim: FirmClaim = {
        id: randomUUID(),
        caseId: input.caseId,
        firmId: input.firmId,
        unlockFeeCents: input.unlockFeeCents,
        claimedAt: nowIso,
        status: 'active',
      };
      s.claims.push(claim);
      c.status = 'claimed';
      c.updatedAt = nowIso;
      const handoff: Handoff = {
        id: randomUUID(),
        caseId: input.caseId,
        firmId: input.firmId,
        claimId: claim.id,
        introSentAt: nowIso,
        notes: input.notes,
        createdAt: nowIso,
      };
      s.handoffs.push(handoff);
      recomputeFirmScore(s, input.firmId);
      result = { ok: true, claim, handoff };
    });
    return result;
  },

  async getClaim(id: string): Promise<FirmClaim | undefined> {
    const s = await this.all();
    return s.claims.find((c) => c.id === id);
  },

  async getActiveClaimForCase(caseId: string): Promise<FirmClaim | undefined> {
    const s = await this.all();
    return s.claims.find(
      (c) => c.caseId === caseId && (c.status === 'active' || c.status === 'engaged'),
    );
  },

  async listClaimsForCase(caseId: string): Promise<FirmClaim[]> {
    const s = await this.all();
    return s.claims.filter((c) => c.caseId === caseId);
  },

  async listClaimsByFirm(firmId: string): Promise<FirmClaim[]> {
    const s = await this.all();
    return s.claims.filter((c) => c.firmId === firmId);
  },

  async updateClaim(id: string, patch: Partial<FirmClaim>): Promise<FirmClaim | undefined> {
    let out: FirmClaim | undefined;
    await this.update((s) => {
      const c = s.claims.find((x) => x.id === id);
      if (!c) return;
      Object.assign(c, patch);
      recomputeFirmScore(s, c.firmId);
      out = c;
    });
    return out;
  },

  // Firm scores
  async getFirmScore(firmId: string): Promise<FirmScore | undefined> {
    const s = await this.all();
    return s.firmScores.find((x) => x.firmId === firmId);
  },

  async listFirmScores(): Promise<FirmScore[]> {
    const s = await this.all();
    return s.firmScores;
  },

  // Magic link tokens
  async createMagicLink(t: Omit<MagicLinkToken, 'id'>): Promise<MagicLinkToken> {
    const created: MagicLinkToken = { ...t, id: randomUUID() };
    await this.update((s) => {
      s.tokens.push(created);
    });
    return created;
  },

  async findToken(token: string): Promise<MagicLinkToken | undefined> {
    const s = await this.all();
    return s.tokens.find((t) => t.token === token);
  },

  async markTokenUsed(token: string) {
    await this.update((s) => {
      const t = s.tokens.find((x) => x.token === token);
      if (t) t.usedAt = new Date().toISOString();
    });
  },

  // Handoffs
  async createHandoff(h: Omit<Handoff, 'id' | 'createdAt'>): Promise<Handoff> {
    const created: Handoff = { ...h, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.update((s) => {
      s.handoffs.push(created);
    });
    return created;
  },

  async getHandoffForCase(caseId: string): Promise<Handoff | undefined> {
    const s = await this.all();
    return s.handoffs.find((h) => h.caseId === caseId);
  },

  // Waitlist
  async createWaitlist(
    e: Omit<FirmWaitlistEntry, 'id' | 'appliedAt' | 'status'>,
  ): Promise<FirmWaitlistEntry> {
    const created: FirmWaitlistEntry = {
      ...e,
      id: randomUUID(),
      appliedAt: new Date().toISOString(),
      status: 'pending',
    };
    await this.update((s) => {
      s.waitlist.push(created);
    });
    return created;
  },

  // Audits (v3 audit funnel)
  async createAudit(
    a: Omit<ArtistAudit, 'id' | 'paidAt' | 'expiresAt'> & {
      paidAt?: string;
      expiresAt?: string;
    },
  ): Promise<ArtistAudit> {
    const paidAt = a.paidAt ?? new Date().toISOString();
    const expiresAt =
      a.expiresAt ?? new Date(Date.parse(paidAt) + AUDIT_WINDOW_MS).toISOString();
    const created: ArtistAudit = {
      ...a,
      paidAt,
      expiresAt,
      id: randomUUID(),
    };
    await this.update((s) => {
      s.audits.push(created);
    });
    return created;
  },

  async listAuditsForCase(caseId: string): Promise<ArtistAudit[]> {
    const s = await this.all();
    return s.audits.filter((a) => a.caseId === caseId);
  },

  async getActiveAuditForCase(caseId: string): Promise<ArtistAudit | undefined> {
    const s = await this.all();
    const now = Date.now();
    return s.audits
      .filter(
        (a) =>
          a.caseId === caseId &&
          !a.refundedAt &&
          Date.parse(a.expiresAt) > now,
      )
      .sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt))[0];
  },

  async getLatestAuditForCase(caseId: string): Promise<ArtistAudit | undefined> {
    const s = await this.all();
    return s.audits
      .filter((a) => a.caseId === caseId)
      .sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt))[0];
  },

  // Audit add-ons
  async createAddon(
    a: Omit<AuditAddon, 'id' | 'purchasedAt'> & { purchasedAt?: string },
  ): Promise<AuditAddon> {
    const created: AuditAddon = {
      ...a,
      purchasedAt: a.purchasedAt ?? new Date().toISOString(),
      id: randomUUID(),
    };
    await this.update((s) => {
      s.auditAddons.push(created);
    });
    return created;
  },

  async listAddonsForCase(caseId: string): Promise<AuditAddon[]> {
    const s = await this.all();
    return s.auditAddons.filter((a) => a.caseId === caseId);
  },
};
