import type { ArtistCase } from '@/lib/store';
import { coverageCount } from '@/lib/mock-evidence';

export function DossierStats({ c }: { c: ArtistCase }) {
  const press = c.evidenceData?.press.length ? `${c.evidenceData.press.length}+` : '—';
  const letters = c.evidenceData?.testimonials.length ?? 0;
  const cov = `${coverageCount(c.criteriaCoverage)}/8`;
  const score = c.evidenceScore ?? '—';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 48 }}>
      {[
        [press, 'Press hits'],
        [String(letters || 8), 'Testimonials'],
        [cov, 'USCIS Criteria'],
        [String(score), 'Evidence Score'],
      ].map(([n, l]) => (
        <div className="vt-stat" key={String(l)}>
          <div className="num">{n}</div>
          <div className="lbl">{l}</div>
        </div>
      ))}
    </div>
  );
}

export function DossierGrid({ c, locked }: { c: ArtistCase; locked: boolean }) {
  const ev = c.evidenceData;
  if (!ev) {
    return (
      <div className="vt-card" style={{ padding: 24 }}>
        <div className="vt-section-eyebrow">Dossier compiling…</div>
        <p style={{ color: 'var(--ink-2)', margin: 0 }}>
          Your dossier is still being assembled. Refresh in a moment.
        </p>
      </div>
    );
  }
  const full = { gridColumn: '1 / -1' } as const;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24 }}>
      {/* § 01 — Biography & Industry Overview (full-width header) */}
      {ev.bio ? (
        <div style={full}>
          <Section title="Biography & Industry Overview" eyebrow="§ 01 — Who they are & why it matters">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 12,
                margin: '4px 0 18px',
              }}
            >
              {ev.bio.stats.map((s, i) => (
                <div className="vt-stat" key={i}>
                  <div className="num">{s.value}</div>
                  <div className="lbl">{s.label}</div>
                </div>
              ))}
            </div>
            <p style={{ color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.7, margin: '0 0 18px' }}>
              {ev.bio.overview}
            </p>
            <div className="vt-section-eyebrow" style={{ marginBottom: 8 }}>Career milestones</div>
            {ev.bio.milestones.map((m, i) => (
              <Row
                key={i}
                left={<strong style={{ color: 'var(--accent)' }}>{m.year}</strong>}
                right={<span style={{ color: 'var(--ink-2)', textAlign: 'right' }}>{m.event}</span>}
              />
            ))}
          </Section>
        </div>
      ) : null}

      {/* § 02 — Booking Agency Representation */}
      {ev.representation?.length ? (
        <Section title="Booking Agency Representation" eyebrow="§ 02 — Representation">
          {ev.representation.map((rep, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <Row
                left={<span>{rep.scope}</span>}
                right={<strong style={{ color: 'var(--accent)' }}>{rep.agency}</strong>}
              />
            </div>
          ))}
        </Section>
      ) : null}

      {/* § 03 — Critical Recognition & Awards */}
      {ev.recognition?.length ? (
        <Section title="Critical Recognition & Awards" eyebrow="§ 03 — Recognition">
          {ev.recognition.map((rec, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--rule)' }}>
              <div className="vt-section-eyebrow accent" style={{ marginBottom: 4 }}>{rec.tag}</div>
              <div style={{ fontSize: 13 }}>{rec.title}</div>
            </div>
          ))}
        </Section>
      ) : null}

      {/* § 04 — Press Coverage & Interviews */}
      <Section
        title="Press Coverage & Interviews"
        eyebrow="§ 04 — Press Archive"
        locked={locked}
        lockText="Unlock all articles"
      >
        {ev.press.map((p, i) => (
          <Row key={i} left={<><strong>{p.outlet}</strong> — {p.title}</>} right={<span style={{ color: 'var(--muted)', fontSize: 12 }}>{p.year}</span>} />
        ))}
      </Section>

      {/* § 05 — Streaming & Digital Presence */}
      <Section title="Streaming & Digital Presence" eyebrow="§ 05 — Platform Reach">
        {ev.social.map((s, i) => (
          <Row key={i} left={<span>{s.platform}</span>} right={<strong style={{ color: 'var(--accent)' }}>{s.value}</strong>} />
        ))}
      </Section>

      {/* § 06 — Profile & Event History */}
      {ev.events?.length ? (
        <div style={full}>
          <Section title="Profile & Event History" eyebrow="§ 06 — Verified performance record">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0 24px' }}>
              {ev.events.map((e, i) => (
                <Row
                  key={i}
                  left={
                    <span>
                      <strong>{e.name}</strong>
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}> — {e.venue}, {e.location}</span>
                    </span>
                  }
                  right={<span style={{ color: 'var(--muted)', fontSize: 12 }}>{e.date}</span>}
                />
              ))}
            </div>
          </Section>
        </div>
      ) : null}

      {/* § 07 — Event Flyers — Confirmed Performances */}
      {ev.eventFlyers?.length ? (
        <Section
          title="Event Flyers — Confirmed Performances"
          eyebrow="§ 07 — Promotional evidence"
          locked={locked}
          lockText="Unlock confirmed-booking flyers"
        >
          {ev.eventFlyers.map((f, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--rule)' }}>
              <div style={{ fontSize: 13 }}><strong>{f.event}</strong> — {f.venue}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>{f.date} · {f.billing}</div>
            </div>
          ))}
        </Section>
      ) : null}

      {/* § 08 — Tour Date Announcements */}
      {ev.tourPosters?.length ? (
        <Section title="Tour Date Announcements" eyebrow="§ 08 — Sustained touring">
          {ev.tourPosters.map((t, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div className="vt-section-eyebrow accent" style={{ marginBottom: 6 }}>{t.title}</div>
              {t.dates.map((d, j) => (
                <div key={j} style={{ fontSize: 12, color: 'var(--ink-2)', padding: '3px 0' }}>{d}</div>
              ))}
            </div>
          ))}
        </Section>
      ) : null}

      {/* § 09 — Chart Performance */}
      <Section title="Chart Performance" eyebrow="§ 09 — Charts & Standing">
        {ev.charts.map((ch, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <Row left={<span>{ch.name}</span>} right={<strong style={{ color: 'var(--accent)' }}>{ch.rank}</strong>} />
            <div style={{ height: 3, background: 'var(--rule)', marginTop: 6 }}>
              <div style={{ width: `${ch.bar}%`, height: '100%', background: 'var(--accent)', boxShadow: '0 0 8px rgba(57,255,138,.4)' }} />
            </div>
          </div>
        ))}
      </Section>

      {/* § 10 — Signed Performance Contracts (High Salary) */}
      <Section title="Signed Performance Contracts" eyebrow="§ 10 — High Salary" locked={locked} lockText="High salary verified">
        {ev.contracts.map((ct, i) => (
          <Row key={i} left={<span>{ct.event}</span>} right={<strong>{ct.amount}</strong>} />
        ))}
      </Section>

      {/* § 11 — Expert Testimonials */}
      <Section title="Letter Excerpt — Festival Booker" eyebrow="§ 11 — Expert Testimonials" locked={locked} lockText={`Unlock ${ev.testimonials.length - 1} more letters`}>
        <div style={{ fontStyle: 'italic', color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.7 }}>
          “{ev.testimonials[0]?.preview}”
          <div style={{ marginTop: 10, fontStyle: 'normal', color: 'var(--muted)', fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
            — {ev.testimonials[0]?.author}, {ev.testimonials[0]?.role}
          </div>
        </div>
      </Section>

      {/* § 12 — Official Press Photos */}
      {ev.pressPhotos?.length ? (
        <div style={full}>
          <Section title="Official Press Photos" eyebrow="§ 12 — Press kit">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {ev.pressPhotos.map((p, i) => (
                <div key={i}>
                  <div
                    style={{
                      aspectRatio: '4 / 3',
                      background: 'linear-gradient(135deg, #1a1a1a, #2a2a2a)',
                      border: '1px solid var(--rule)',
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--muted)',
                      fontSize: 11,
                      letterSpacing: '.18em',
                      textTransform: 'uppercase',
                    }}
                  >
                    📷 Press photo
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>{p.caption}</div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      ) : null}

      {/* § 13 — O-1B Argument Summary */}
      <div style={full}>
        <Section title="O-1B Argument Summary" eyebrow="§ 13 — Brief" locked={locked} lockText="Full 3,427-word brief">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0 24px' }}>
            {ev.briefSummary.map((b, i) => (
              <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--rule)', fontSize: 13 }}>
                {b}
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* § 14 — Creator Reach & Brand Authority */}
      <div style={full}>
        <Section title="Creator Reach & Brand Authority" eyebrow="§ 14 — Digital Footprint">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
            <div>
              <div className="vt-section-eyebrow" style={{ marginBottom: 8 }}>Top posts</div>
              {ev.topPosts.map((p, i) => (
                <Row key={i} left={<span style={{ fontSize: 13 }}>{p.title}</span>} right={<strong style={{ color: 'var(--accent)' }}>{p.views}</strong>} />
              ))}
            </div>
            <div>
              <div className="vt-section-eyebrow" style={{ marginBottom: 8 }}>Brand deals</div>
              <Row left={<span>{ev.brandDeals.count} paid deals (12mo)</span>} right={<strong style={{ color: 'var(--accent)' }}>{ev.brandDeals.total}</strong>} />
              <Row left={<span>Top: {ev.brandDeals.topPartner}</span>} right={<strong>{ev.brandDeals.topAmount}</strong>} />
            </div>
            <div>
              <div className="vt-section-eyebrow" style={{ marginBottom: 8 }}>Monetization</div>
              {ev.monetization.map((m, i) => (
                <Row key={i} left={<span>{m.item}</span>} right={<strong style={{ color: 'var(--accent)' }}>{m.status}</strong>} />
              ))}
            </div>
          </div>
        </Section>
      </div>

      {/* Portfolio Summary table */}
      {ev.portfolioSummary?.length ? (
        <div style={full}>
          <Section title="Portfolio Summary" eyebrow="§ — At a glance">
            {ev.portfolioSummary.map((s, i) => (
              <Row
                key={i}
                left={<span style={{ color: 'var(--muted)' }}>{s.label}</span>}
                right={<strong style={{ textAlign: 'right', maxWidth: '60ch' }}>{s.value}</strong>}
              />
            ))}
          </Section>
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  eyebrow,
  locked,
  lockText,
  children,
}: {
  title: string;
  eyebrow: string;
  locked?: boolean;
  lockText?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="vt-card" style={{ overflow: 'hidden' }}>
      <div className="vt-section-eyebrow">{eyebrow}</div>
      <h3>{title}</h3>
      <div style={{ position: 'relative' }}>
        {children}
        {locked ? (
          <div className="vt-lock">
            <span>🔒 {lockText || 'Unlock'}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Row({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 14 }}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}
