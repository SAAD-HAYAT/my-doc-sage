import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { chunkText, countTokens, splitToTokenLimit, MAX_EMBED_TOKENS } from "@/lib/chunking";
import { embedMany } from "@/lib/openrouter";
import { extractPdfText } from "@/lib/pdf-text";
import {
  FILE_SIZE_TOO_LARGE_MESSAGE,
  isUploadTooLarge,
  type TrimmedRange,
  type TrimmedUnit,
} from "@/lib/document-upload";

// unpdf bundles pdf.js, which needs the Node.js runtime (not Edge).
export const runtime = "nodejs";

const CHUNK_INSERT_BATCH_SIZE = 50;

// Phase 7: both handlers below require an authenticated session and
// scope every query/insert to that user's id explicitly.

type DocumentRow = {
  id: string;
  name: string;
  status: "processing" | "ready" | "failed";
  created_at: string;
  trimmed_unit: TrimmedUnit | null;
  included_count: number | null;
  source_count: number | null;
};

function shape(row: DocumentRow) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    trimmed:
      row.trimmed_unit && row.included_count !== null && row.source_count !== null
        ? {
            unit: row.trimmed_unit,
            included: row.included_count,
            total: row.source_count,
          }
        : null,
  };
}

function parseTrimmedRange(form: FormData): TrimmedRange | null | "invalid" {
  const unit = form.get("trimmedUnit");
  const includedRaw = form.get("includedCount");
  const totalRaw = form.get("sourceCount");

  if (unit === null && includedRaw === null && totalRaw === null) return null;
  if (
    (unit !== "pages" && unit !== "lines") ||
    typeof includedRaw !== "string" ||
    typeof totalRaw !== "string"
  ) {
    return "invalid";
  }

  const included = Number(includedRaw);
  const total = Number(totalRaw);
  if (
    !Number.isSafeInteger(included) ||
    !Number.isSafeInteger(total) ||
    included < 1 ||
    total < 1 ||
    included >= total
  ) {
    return "invalid";
  }

  return { unit, included, total };
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function extractRawText(file: File): Promise<string> {
  if (isPdf(file)) {
    const buf = new Uint8Array(await file.arrayBuffer());
    return extractPdfText(buf);
  }
  // Markdown / plain text: read as UTF-8.
  return file.text();
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file provided under the 'file' field" }, { status: 400 });
  }

  if (isUploadTooLarge(file.size)) {
    return NextResponse.json({ error: FILE_SIZE_TOO_LARGE_MESSAGE }, { status: 413 });
  }

  const trimmed = parseTrimmedRange(form);
  if (
    trimmed === "invalid" ||
    (trimmed !== null &&
      ((isPdf(file) && trimmed.unit !== "pages") || (!isPdf(file) && trimmed.unit !== "lines")))
  ) {
    return NextResponse.json({ error: "Invalid trim metadata" }, { status: 400 });
  }

  const name = file.name || "untitled";

  // 1. Create the document row up front so the UI can show "processing".
  const { data: created, error: insertError } = await supabaseAdmin
    .from("documents")
    .insert({
      name,
      status: "processing",
      user_id: user.id,
      trimmed_unit: trimmed?.unit ?? null,
      included_count: trimmed?.included ?? null,
      source_count: trimmed?.total ?? null,
    })
    .select()
    .single();

  if (insertError || !created) {
    return NextResponse.json(
      { error: `Could not create document: ${insertError?.message ?? "unknown error"}` },
      { status: 500 },
    );
  }

  const doc = created as DocumentRow;

  // 2. Extract -> chunk -> embed -> store. On any failure, mark "failed".
  let ingestionStage = "extracting text";
  try {
    const text = await extractRawText(file);
    ingestionStage = "chunking text";
    const baseChunks = chunkText(text);

    if (baseChunks.length === 0) {
      throw new Error("No extractable text found in the file");
    }

    // Safety net: token-count each chunk again right before embedding and
    // recursively halve anything still over the limit, so we never hand
    // OpenRouter an input it will reject. Should be rare after chunkText().
    const chunks: string[] = [];
    for (const chunk of baseChunks) {
      const safe = splitToTokenLimit(chunk);
      if (safe.length > 1) {
        console.warn(
          `[ingestion] chunk of ${countTokens(chunk)} tokens exceeded ${MAX_EMBED_TOKENS}; split into ${safe.length} pieces`,
        );
      }
      chunks.push(...safe);
    }

    // OpenRouter accepts an array of inputs in one embeddings request. A large
    // trimmed PDF can still contain hundreds of chunks, so batching here avoids
    // one network request per chunk (and the corresponding serverless timeout /
    // free-tier request-quota failure mode).
    ingestionStage = "embedding chunks";
    const embeddings = await embedMany(chunks);
    const rows = chunks.map((content, index) => ({
      document_id: doc.id,
      user_id: user.id,
      content,
      embedding: embeddings[index],
    }));

    // Keep each PostgREST request bounded: hundreds of 1024-dimensional
    // vectors can otherwise produce a multi-megabyte JSON request body.
    ingestionStage = "storing chunks";
    for (let start = 0; start < rows.length; start += CHUNK_INSERT_BATCH_SIZE) {
      const { error: chunkError } = await supabaseAdmin
        .from("chunks")
        .insert(rows.slice(start, start + CHUNK_INSERT_BATCH_SIZE));
      if (chunkError) throw new Error(chunkError.message);
    }

    ingestionStage = "finalizing the document";
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("documents")
      .update({ status: "ready" })
      .eq("id", doc.id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (updateError || !updated) throw new Error(updateError?.message ?? "status update failed");

    return NextResponse.json(shape(updated as DocumentRow));
  } catch (err) {
    // Leave a clean state: drop any chunks already inserted for this
    // document before flipping to "failed", so a retry starts from zero.
    await supabaseAdmin.from("chunks").delete().eq("document_id", doc.id).eq("user_id", user.id);
    await supabaseAdmin
      .from("documents")
      .update({ status: "failed" })
      .eq("id", doc.id)
      .eq("user_id", user.id);
    const detail = err instanceof Error ? err.message : String(err);
    const errorMessage = `Document ingestion failed while ${ingestionStage}: ${detail}`;
    console.error(`${errorMessage} (document ${doc.id})`, err);
    return NextResponse.json(
      { error: errorMessage, document: shape({ ...doc, status: "failed" }) },
      { status: 500 },
    );
  }
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("documents")
    .select("id, name, status, created_at, trimmed_unit, included_count, source_count")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data as DocumentRow[]).map(shape));
}
