import { NextResponse } from 'next/server';
import { db, schema, uploadCaseDocument } from '@visa-track/db';
import { getSession } from '@/lib/session';
import { store } from '@/lib/store';

export const runtime = 'nodejs';

const DEV_TENANT_ID = process.env.DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';

// Document kinds known to the schema enum; anything else maps to 'other'.
const DOC_KINDS = new Set([
  'petition_letter',
  'expert_letter',
  'form_i129',
  'exhibit',
  'cover',
  'other',
]);
type DocKind =
  | 'petition_letter'
  | 'expert_letter'
  | 'form_i129'
  | 'exhibit'
  | 'cover'
  | 'other';

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Auth gate: a valid session cookie, or a non-expired magic-link token.
async function isAuthorized(req: Request, token: string | null): Promise<boolean> {
  const session = await getSession();
  if (session) return true;
  if (!token) return false;
  const t = await store.findToken(token);
  if (!t) return false;
  return new Date(t.expiresAt).getTime() > Date.now();
}

// POST multipart/form-data: { file, caseId, docType }. Uploads to the
// `case-documents` bucket and records a documents row. Returns the storage path
// and a signed URL.
export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 });
  }

  const token =
    (form.get('token') as string | null) ??
    req.headers.get('x-vt-token') ??
    new URL(req.url).searchParams.get('token');

  if (!(await isAuthorized(req, token))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const file = form.get('file');
  const caseId = form.get('caseId');
  const docType = (form.get('docType') as string | null) ?? 'other';

  if (!(file instanceof File) || typeof caseId !== 'string' || caseId.length === 0) {
    return NextResponse.json({ error: 'file and caseId are required' }, { status: 400 });
  }

  const tenantId = DEV_TENANT_ID;
  const bytes = await file.arrayBuffer();

  try {
    const { key, url } = await uploadCaseDocument(
      tenantId,
      caseId,
      bytes,
      file.name,
      file.type || undefined,
      docType,
    );

    const kind: DocKind = DOC_KINDS.has(docType) ? (docType as DocKind) : 'other';

    // Record metadata (best-effort — demo cases may not exist in the DB tables).
    try {
      await db.insert(schema.documents).values({
        tenantId,
        caseId,
        kind,
        title: file.name,
        storageKey: key,
        mimeType: file.type || null,
        sizeBytes: file.size,
        metadata: { docType },
      });
    } catch (err) {
      console.warn('[documents/upload] metadata insert skipped:', (err as Error).message);
    }

    return NextResponse.json({ ok: true, storageKey: key, url, docType });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
