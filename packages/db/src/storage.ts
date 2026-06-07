import { createServerSupabaseClient } from './supabase';

export const CASE_DOCUMENTS_BUCKET = 'case-documents';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function buildKey(
  tenantId: string,
  caseId: string,
  fileName: string,
  docType?: string,
): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const segment = docType ? `${docType.replace(/[^a-zA-Z0-9._-]/g, '_')}/` : '';
  return `tenants/${tenantId}/cases/${caseId}/${segment}${Date.now()}-${safeName}`;
}

export interface UploadCaseDocumentResult {
  key: string;
  url: string;
}

export async function uploadCaseDocument(
  tenantId: string,
  caseId: string,
  file: ArrayBuffer | Blob | Uint8Array,
  fileName: string,
  contentType?: string,
  docType?: string,
): Promise<UploadCaseDocumentResult> {
  const supabase = createServerSupabaseClient();
  const key = buildKey(tenantId, caseId, fileName, docType);
  const { error } = await supabase.storage
    .from(CASE_DOCUMENTS_BUCKET)
    .upload(key, file, {
      contentType,
      upsert: false,
    });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  const url = await getDocumentUrl(key);
  return { key, url };
}

export async function getDocumentUrl(key: string): Promise<string> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.storage
    .from(CASE_DOCUMENTS_BUCKET)
    .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new Error(`Signed URL failed: ${error?.message ?? 'unknown'}`);
  return data.signedUrl;
}

export async function deleteDocument(key: string): Promise<void> {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase.storage.from(CASE_DOCUMENTS_BUCKET).remove([key]);
  if (error) throw new Error(`Supabase delete failed: ${error.message}`);
}

export interface SignedUploadUrl {
  uploadUrl: string;
  token: string;
  key: string;
}

export async function createSignedUploadUrl(
  tenantId: string,
  caseId: string,
  fileName: string,
): Promise<SignedUploadUrl> {
  const supabase = createServerSupabaseClient();
  const key = buildKey(tenantId, caseId, fileName);
  const { data, error } = await supabase.storage
    .from(CASE_DOCUMENTS_BUCKET)
    .createSignedUploadUrl(key);
  if (error || !data) {
    throw new Error(`Signed upload URL failed: ${error?.message ?? 'unknown'}`);
  }
  return { uploadUrl: data.signedUrl, token: data.token, key };
}
