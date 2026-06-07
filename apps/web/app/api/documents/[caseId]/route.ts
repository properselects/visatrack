import { NextResponse } from 'next/server';
import { db, desc, eq, getDocumentUrl, schema } from '@visa-track/db';

export const runtime = 'nodejs';

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// GET all documents for a case, each with a freshly-signed download URL.
export async function GET(_req: Request, ctx: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await ctx.params;

  if (!supabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' },
      { status: 503 },
    );
  }

  let rows: (typeof schema.documents.$inferSelect)[];
  try {
    rows = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.caseId, caseId))
      .orderBy(desc(schema.documents.createdAt));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const documents = await Promise.all(
    rows.map(async (r) => {
      let url: string | null = null;
      try {
        url = await getDocumentUrl(r.storageKey);
      } catch (err) {
        console.warn('[documents] signed URL failed for', r.storageKey, (err as Error).message);
      }
      return {
        id: r.id,
        title: r.title,
        kind: r.kind,
        storageKey: r.storageKey,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        createdAt: r.createdAt,
        url,
      };
    }),
  );

  return NextResponse.json({ ok: true, documents });
}
