// Voyage AI embeddings + pgvector retrieval.
//
// Embeddings use Voyage's REST API (model `voyage-3-large`, 1024 dims to match
// the `rag_chunks.embedding` vector column / HNSW cosine index). Retrieval runs
// a pgvector cosine-similarity search scoped by tenant (and optionally case).
//
// Both entry points are guarded by VOYAGE_API_KEY: without it, `embedTexts`
// returns [] and `retrieve` returns [] so callers degrade gracefully in dev.
import { and, db, eq, schema, sql } from '@visa-track/db';

const { ragChunks, ragDocuments } = schema;

export const VOYAGE_MODEL = 'voyage-3-large';
export const EMBED_DIMS = 1024;

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const MAX_BATCH = 128;

export interface EmbedOptions {
  inputType?: 'document' | 'query';
}

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
}

/**
 * Embed texts via the Voyage AI API. Batches up to 128 inputs per request and
 * returns one 1024-dim vector per input, in the same order. Returns [] when
 * VOYAGE_API_KEY is unset (dev fallback).
 */
export async function embedTexts(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.warn('[rag] VOYAGE_API_KEY not set — returning empty embeddings');
    return [];
  }
  if (texts.length === 0) return [];

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: batch,
        input_type: opts.inputType ?? 'document',
        output_dimension: EMBED_DIMS,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Voyage API error ${res.status}: ${text}`);
    }
    const json = (await res.json()) as VoyageResponse;
    // The API may return out of order; sort by index to align with input.
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) out.push(item.embedding);
  }
  return out;
}

export interface RetrieveOptions {
  tenantId: string;
  caseId?: string;
  query: string;
  topK?: number;
}

export interface RetrievedChunk {
  documentId: string;
  chunkId: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Embed the query and run a pgvector cosine-similarity search against
 * `rag_chunks`, scoped by tenant (and optionally by case via the parent
 * document). Returns the top `topK` (default 5) chunks ordered by similarity.
 */
export async function retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  if (!process.env.VOYAGE_API_KEY) {
    console.warn('[rag] VOYAGE_API_KEY not set — returning no results');
    return [];
  }

  const topK = opts.topK ?? 5;
  const [queryEmbedding] = await embedTexts([opts.query], { inputType: 'query' });
  if (!queryEmbedding) return [];

  // pgvector literal, e.g. "[0.1,0.2,...]"; `<=>` is cosine distance under the
  // vector_cosine_ops index, so similarity = 1 - distance.
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;
  const distance = sql<number>`${ragChunks.embedding} <=> ${vectorLiteral}::vector`;
  const score = sql<number>`1 - (${ragChunks.embedding} <=> ${vectorLiteral}::vector)`;

  const columns = {
    documentId: ragChunks.documentId,
    chunkId: ragChunks.id,
    content: ragChunks.content,
    metadata: ragChunks.metadata,
    score,
  };

  const rows = opts.caseId
    ? await db
        .select(columns)
        .from(ragChunks)
        .innerJoin(ragDocuments, eq(ragChunks.documentId, ragDocuments.id))
        .where(
          and(eq(ragChunks.tenantId, opts.tenantId), eq(ragDocuments.caseId, opts.caseId)),
        )
        .orderBy(distance)
        .limit(topK)
    : await db
        .select(columns)
        .from(ragChunks)
        .where(eq(ragChunks.tenantId, opts.tenantId))
        .orderBy(distance)
        .limit(topK);

  return rows.map((r) => ({
    documentId: r.documentId,
    chunkId: r.chunkId,
    content: r.content,
    score: Number(r.score),
    metadata: (r.metadata as Record<string, unknown> | null) ?? undefined,
  }));
}
