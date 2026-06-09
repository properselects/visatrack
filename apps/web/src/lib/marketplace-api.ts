// Shared API logic for marketplace routes.
// Route handlers in app/api/* are thin wrappers around these.
import { z } from 'zod';
import {
  store,
  unlockFeeCentsForCase,
  pricingBandForScore,
  type AuditTier,
  type AuditAddonKind,
  type EvidenceData,
} from './store';
import { generateEvidence, scoreEvidence, criteriaCoverage } from './mock-evidence';
import { sendEmail, magicLinkEmail } from './email';
import { makeToken } from './session';
import { auditPriceCents, addonPriceCents } from './pricing';

const baseUrl = () =>
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';

const fmt$ = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;

export async function issueMagicLink(opts: {
  email: string;
  role: 'artist' | 'firm' | 'admin';
  caseId?: string;
  heading?: string;
  body?: string;
}) {
  const token = makeToken();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await store.createMagicLink({
    email: opts.email,
    role: opts.role,
    token,
    expiresAt,
    caseId: opts.caseId,
  });
  const url = `${baseUrl()}/api/auth/consume?token=${token}`;
  const { subject, html, text } = magicLinkEmail({
    url,
    heading:
      opts.heading ||
      (opts.role === 'firm'
        ? 'Open your VisaTrack firm console'
        : 'Sign in to your VisaTrack portal'),
    body: opts.body,
    cta: opts.role === 'firm' ? 'Open firm console' : 'Open my portal',
  });
  await sendEmail({ to: opts.email, subject, html, text });
  return url;
}

export const intakeStartSchema = z.object({
  email: z.string().email(),
  legal_name: z.string().optional(),
  stage_name: z.string().optional(),
  phone: z.string().optional(),
  citizenship: z.string().optional(),
  based: z.string().optional(),
});

export async function intakeStart(input: z.infer<typeof intakeStartSchema>) {
  const a = await store.upsertArtistByEmail(input.email, {
    email: input.email,
    legalName: input.legal_name,
    stageName: input.stage_name,
    phone: input.phone,
    citizenship: input.citizenship,
    basedIn: input.based,
  });
  const magicLink = await issueMagicLink({
    email: a.email,
    role: 'artist',
    heading: 'Your VisaTrack dossier is being built',
    body: 'Use this link to come back to your dossier and see which firm claimed your case.',
  });
  return { artistId: a.id, magicLink };
}

export const intakeSubmitSchema = z.object({
  intake: z.record(z.string(), z.string()),
});

export async function intakeSubmit(input: z.infer<typeof intakeSubmitSchema>) {
  const intake = input.intake;
  if (!intake.email) throw new Error('email is required');
  const a = await store.upsertArtistByEmail(intake.email, {
    email: intake.email,
    legalName: intake.legal_name,
    stageName: intake.stage_name,
    phone: intake.phone,
    citizenship: intake.citizenship,
    basedIn: intake.based,
  });
  const created = await store.createCase({
    artistId: a.id,
    visaType: 'O-1B',
    intakeData: intake,
    status: 'processing',
  });
  return { caseId: created.id };
}

// v3 audit funnel: post-evidence default is `dossier_preview`. Listing is
// blocked until the artist purchases an audit (see /api/cases/:id/audit).
export async function finalizeCase(id: string) {
  const existing = await store.getCase(id);
  if (!existing) return null;
  if (existing.status !== 'processing' && existing.status !== 'intake') {
    return existing; // already finalized
  }
  const stage = existing.intakeData?.stage_name || existing.intakeData?.legal_name || 'Artist';
  const genre = existing.intakeData?.genre || 'House';
  const platform = existing.intakeData?.primary_platform || 'DJ / Electronic';
  let evidence: EvidenceData;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { generateEvidenceFromIntake } = await import('./ai-evidence');
      evidence = await generateEvidenceFromIntake(id, existing.intakeData ?? {});
    } catch (err) {
      console.warn('[finalizeCase] AI evidence failed, falling back to mock:', err);
      evidence = generateEvidence(id, stage, genre, platform);
    }
  } else {
    evidence = generateEvidence(id, stage, genre, platform);
  }
  return store.updateCase(id, {
    evidenceData: evidence,
    evidenceScore: scoreEvidence(id),
    criteriaCoverage: criteriaCoverage(id),
    status: 'dossier_preview',
  });
}

// v3 audit funnel — buying an audit flips dossier_preview → audited and
// records the purchase. Stripe wiring is Track B; demo records priceCents
// only. expiresAt = paidAt + 90d.
export const purchaseAuditSchema = z.object({
  tier: z.enum(['standard', 'concierge']),
});

export class AuditRequiredError extends Error {
  constructor(message = 'audit required') {
    super(message);
    this.name = 'AuditRequiredError';
  }
}

export async function purchaseAudit(
  caseId: string,
  input: z.infer<typeof purchaseAuditSchema>,
) {
  const c = await store.getCase(caseId);
  if (!c) throw new Error('case not found');
  if (
    c.status !== 'dossier_preview' &&
    c.status !== 'audit_expired' &&
    // tolerant: legacy dossier_ready cases can also buy an audit to enter the
    // funnel without re-running intake
    c.status !== 'dossier_ready'
  ) {
    throw new Error(`case is not eligible for audit (status: ${c.status})`);
  }
  const tier = input.tier as AuditTier;
  const priceCents = auditPriceCents(tier);
  const audit = await store.createAudit({
    caseId,
    tier,
    priceCents,
    stripeChargeId: null,
  });
  await store.updateCase(caseId, { status: 'audited' });
  const artist = await store.getArtistById(c.artistId);
  const stage = c.intakeData?.stage_name || c.intakeData?.legal_name || 'Artist';
  if (artist) {
    await sendEmail({
      to: artist.email,
      subject: `Audit unlocked — ${stage}'s dossier`,
      html: `<p>Your ${tier === 'concierge' ? 'Audit + Concierge' : 'Standard Audit'} is unlocked.</p>
<p>Score, criterion breakdown, and 3 specific actions are now visible. Listing eligibility is open for the next 90 days.</p>
<p><a href="${baseUrl()}/dossier/${caseId}">Open your full dossier →</a></p>`,
    });
  }
  return { audit, priceCents, tier };
}

export const purchaseAddonSchema = z.object({
  kind: z.enum(['manager_kit', 'express_evidence', 'relist_boost', 're_audit']),
});

export async function purchaseAddon(
  caseId: string,
  input: z.infer<typeof purchaseAddonSchema>,
) {
  const c = await store.getCase(caseId);
  if (!c) throw new Error('case not found');
  const kind = input.kind as AuditAddonKind;
  const priceCents = addonPriceCents(kind);

  if (kind === 're_audit') {
    // Re-audit: regenerate evidence + new audit window. Allowed from any
    // post-preview state (audit_expired is the typical entry point).
    const stage = c.intakeData?.stage_name || c.intakeData?.legal_name || 'Artist';
    const genre = c.intakeData?.genre || 'House';
    const platform = c.intakeData?.primary_platform || 'DJ / Electronic';
    const evidence = generateEvidence(c.id, stage, genre, platform);
    await store.updateCase(c.id, {
      evidenceData: evidence,
      evidenceScore: scoreEvidence(c.id),
      criteriaCoverage: criteriaCoverage(c.id),
      status: 'audited',
    });
    // Re-audit is also a paid audit purchase: refresh expiry and create a row
    // tagged as a Standard audit so we can read the active-audit timer
    // uniformly from `artist_audits`.
    await store.createAudit({
      caseId: c.id,
      tier: 'standard',
      priceCents,
      stripeChargeId: null,
    });
  }

  const addon = await store.createAddon({ caseId, kind, priceCents });
  return { addon, priceCents, kind };
}

export const listCaseSchema = z.object({
  targetVisaDate: z.string().optional(),
  location: z.string().optional(),
  budgetBand: z.string(),
  briefNote: z.string().optional(),
});

export async function listCase(id: string, input: z.infer<typeof listCaseSchema>) {
  const c0 = await store.getCase(id);
  if (!c0) throw new Error('case not found');
  // v3 gate: listing requires an audit. Block unless status is `audited`
  // and there's an unexpired audit row.
  if (c0.status !== 'audited') {
    throw new AuditRequiredError(
      'Listing requires a paid audit. POST /api/cases/:id/audit first.',
    );
  }
  const audit = await store.getActiveAuditForCase(id);
  if (!audit) {
    throw new AuditRequiredError(
      'Audit has expired. Re-audit ($9) before listing.',
    );
  }
  await store.updateCase(id, {
    targetVisaDate: input.targetVisaDate,
    location: input.location,
    budgetBand: input.budgetBand,
    briefNote: input.briefNote,
    status: 'listed',
  });
  const artist = await store.getArtistById(c0.artistId);
  const stageName = artist?.stageName || artist?.legalName || 'an artist';
  const fee = unlockFeeCentsForCase(c0);
  const firms = await store.listApprovedFirms();
  await Promise.all(
    firms.map((f) =>
      sendEmail({
        to: f.contactEmail,
        subject: `New O-1B dossier listed — ${stageName}`,
        html: `<p>A new dossier just hit your VisaTrack inbox.</p>
<p>Stage name: <b>${stageName}</b><br/>Budget: ${input.budgetBand}<br/>Target: ${input.targetVisaDate || '—'}<br/>Unlock fee: <b>${fmt$(fee)}</b></p>
<p>First eligible firm to claim wins exclusive 7-day engagement.</p>
<p><a href="${baseUrl()}/marketplace/${id}">Open in marketplace →</a></p>`,
      }),
    ),
  );
  let magicLink: string | undefined;
  if (artist) {
    magicLink = await issueMagicLink({
      email: artist.email,
      role: 'artist',
      heading: 'Firms are reviewing your case',
      body: 'A vetted firm will claim your case soon. We will email you the moment it happens.',
    });
  }
  return { magicLink };
}

// v2 claim model — replaces submitBid.
export const claimCaseSchema = z.object({
  firmId: z.string(),
});

export async function claimCase(caseId: string, input: z.infer<typeof claimCaseSchema>) {
  const ac = await store.getCase(caseId);
  if (!ac) throw new Error('case not found');
  const firm = await store.getFirm(input.firmId);
  if (!firm) throw new Error('firm not found');
  if (firm.status !== 'approved') throw new Error('firm not approved');
  const unlockFeeCents = unlockFeeCentsForCase(ac);
  // Atomic claim — the availability check + claim + status flip + handoff happen
  // in a single serialized mutation so two firms can't both win the same case.
  // Stripe charge wiring is Track B; the demo records the unlock fee only.
  const res = await store.claimCaseAtomic({
    caseId,
    firmId: firm.id,
    unlockFeeCents,
    notes: 'Auto-created on claim. Firm has 7 days to log first engagement with the artist.',
  });
  if (!res.ok) throw new Error(res.reason);
  const { claim, handoff } = res;
  const artist = await store.getArtistById(ac.artistId);
  const stage = artist?.stageName || artist?.legalName || 'Artist';
  await Promise.all([
    artist
      ? sendEmail({
          to: artist.email,
          subject: `${firm.displayName} just claimed your O-1B case`,
          html: `<p>Your case has been claimed by <b>${firm.displayName}</b>.</p>
<p>${firm.contactName ? `${firm.contactName} ` : ''}will reach out within 7 days from <a href="mailto:${firm.contactEmail}">${firm.contactEmail}</a>.</p>
<p><a href="${baseUrl()}/portal/firm">View your firm in the portal →</a></p>`,
        })
      : Promise.resolve(),
    sendEmail({
      to: firm.contactEmail,
      subject: `You claimed an O-1B case — ${stage}`,
      html: `<p>You claimed <b>${stage}</b>'s case for ${fmt$(unlockFeeCents)}.</p>
<p>Artist contact: ${artist?.legalName || stage} &lt;${artist?.email || ''}&gt; · ${artist?.phone || 'phone n/a'}</p>
<p>You have a <b>7-day exclusive engagement window</b>. Log first contact in the case console — otherwise the case auto-releases back to the pool.</p>
<p><a href="${baseUrl()}/cases/${ac.id}">Open in your case console →</a></p>`,
    }),
  ]);
  return { claimId: claim.id, handoffId: handoff.id, unlockFeeCents };
}

export async function logEngagement(claimId: string) {
  const claim = await store.getClaim(claimId);
  if (!claim) throw new Error('claim not found');
  if (claim.status === 'released' || claim.status === 'closed') {
    throw new Error('claim is no longer active');
  }
  const updated = await store.updateClaim(claimId, {
    status: 'engaged',
    engagedAt: claim.engagedAt ?? new Date().toISOString(),
  });
  // Advance the case out of the dead-end `claimed` state into `matched` so the
  // lifecycle reflects an engaged firm. (Previously `matched` was read by the UI
  // but never written, so an engaged case stayed `claimed` forever.)
  if (updated) {
    const c = await store.getCase(claim.caseId);
    if (c && c.status === 'claimed') {
      await store.updateCase(claim.caseId, { status: 'matched' });
    }
  }
  return { claim: updated };
}

export async function releaseClaim(
  claimId: string,
  reason = 'manually released',
): Promise<{ claimId: string }> {
  const claim = await store.getClaim(claimId);
  if (!claim) throw new Error('claim not found');
  if (claim.status === 'released' || claim.status === 'closed') {
    return { claimId };
  }
  const releasedAt = new Date().toISOString();
  await store.updateClaim(claimId, {
    status: 'released',
    releasedAt,
    releaseReason: reason,
  });
  await store.updateCase(claim.caseId, { status: 'listed' });
  const ac = await store.getCase(claim.caseId);
  const artist = ac ? await store.getArtistById(ac.artistId) : undefined;
  const firm = await store.getFirm(claim.firmId);
  if (artist && firm) {
    await Promise.all([
      sendEmail({
        to: artist.email,
        subject: 'Your case is back in the marketplace',
        html: `<p>${firm.displayName} did not engage within their 7-day window. Your case has been returned to the pool — another firm should claim it shortly.</p>`,
      }),
      sendEmail({
        to: firm.contactEmail,
        subject: 'Claim released — engagement window expired',
        html: `<p>The 7-day window on this claim elapsed without an engagement log, so the case has been released back to the pool. This affects your firm score.</p>`,
      }),
    ]);
  }
  return { claimId };
}

// DEPRECATED — v2 claim model. Bid endpoints return 410 Gone with a pointer
// to the claim equivalents. The functions below remain only so existing
// imports compile during the deprecation window; routes call them no longer.
export async function submitBid(): Promise<never> {
  throw new Error(
    'POST /api/cases/:caseId/bids is deprecated — use POST /api/cases/:caseId/claim',
  );
}

export async function acceptBid(): Promise<never> {
  throw new Error('POST /api/bids/:bidId/accept is deprecated in the v2 claim model');
}

export async function declineBid(): Promise<never> {
  throw new Error('POST /api/bids/:bidId/decline is deprecated in the v2 claim model');
}

export const firmApplySchema = z.object({
  firmName: z.string().min(2),
  contactName: z.string().min(2),
  contactEmail: z.string().email(),
  website: z.string().optional(),
  ailaMember: z.boolean().optional(),
  casesLast12Mo: z.number().int().nonnegative().optional(),
});

export async function firmApply(input: z.infer<typeof firmApplySchema>) {
  await store.createWaitlist({
    firmName: input.firmName,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    website: input.website,
    ailaMember: !!input.ailaMember,
    casesLast12Mo: input.casesLast12Mo,
  });
  const slug = input.firmName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 48);
  const firm = await store.createFirm({
    displayName: input.firmName,
    slug: `${slug}-${Math.floor(Math.random() * 9999)}`,
    bio: undefined,
    specialties: [],
    languages: [],
    casesHandled: input.casesLast12Mo || 0,
    status: 'pending',
    ailaMember: !!input.ailaMember,
    contactEmail: input.contactEmail,
    contactName: input.contactName,
  });
  await sendEmail({
    to: input.contactEmail,
    subject: 'Application received — VisaTrack',
    html: `<p>Thanks ${input.contactName}. We received your application for <b>${input.firmName}</b> and will review it within 24 hours.</p>`,
  });
  return { firmId: firm.id };
}

export async function approveFirm(id: string) {
  const firm = await store.getFirm(id);
  if (!firm) throw new Error('not found');
  await store.updateFirm(id, { status: 'approved', approvedAt: new Date().toISOString() });
  const magicLink = await issueMagicLink({
    email: firm.contactEmail,
    role: 'firm',
    heading: `${firm.displayName} is approved on VisaTrack`,
    body: 'You can now claim cases. Click below to open your firm console.',
  });
  return { magicLink };
}

export async function consumeMagicLink(token: string): Promise<
  | { kind: 'artist'; artistId: string; email: string; redirect: string }
  | { kind: 'firm'; firmId: string; email: string; redirect: string }
  | { error: string }
> {
  const t = await store.findToken(token);
  if (!t) return { error: 'invalid token' };
  if (t.usedAt) return { error: 'token already used' };
  if (Date.parse(t.expiresAt) < Date.now()) return { error: 'token expired' };
  await store.markTokenUsed(token);

  if (t.role === 'artist') {
    const a =
      (await store.getArtistByEmail(t.email)) ||
      (await store.upsertArtistByEmail(t.email, { email: t.email }));
    return { kind: 'artist', artistId: a.id, email: t.email, redirect: '/portal' };
  }
  if (t.role === 'firm') {
    const f = await store.getFirmByEmail(t.email);
    if (!f) return { error: 'firm not found for email' };
    if (f.status !== 'approved') return { error: 'firm not approved yet' };
    return { kind: 'firm', firmId: f.id, email: t.email, redirect: '/marketplace' };
  }
  return { error: 'unsupported role' };
}

export { unlockFeeCentsForCase, pricingBandForScore };
