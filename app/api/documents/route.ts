import { NextRequest, NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { supabaseAdmin } from "@/lib/supabase";
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { chunkText, countTokens, splitToTokenLimit, MAX_EMBED_TOKENS } from "@/lib/chunking";
import { embed } from "@/lib/openrouter";

// unpdf bundles pdf.js, which needs the Node.js runtime (not Edge).
export const runtime = "nodejs";

// Phase 7: both handlers below require an authenticated session and
// scope every query/insert to that user's id explicitly.

type DocumentRow = {
  id: string;
  name: string;
  status: "processing" | "ready" | "failed";
  created_at: string;
};

function shape(row: DocumentRow) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
  };
}

function isPdf(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

async function extractRawText(file: File): Promise<string> {
  if (isPdf(file)) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
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
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "No file provided under the 'file' field" },
      { status: 400 },
    );
  }

  const name = file.name || "untitled";

  // 1. Create the document row up front so the UI can show "processing".
  const { data: created, error: insertError } = await supabaseAdmin
    .from("documents")
    .insert({ name, status: "processing", user_id: user.id })
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
  try {
    const text = await extractRawText(file);
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

    const rows = [];
    for (const content of chunks) {
      const embedding = await embed(content);
      rows.push({ document_id: doc.id, user_id: user.id, content, embedding });
    }

    const { error: chunkError } = await supabaseAdmin.from("chunks").insert(rows);
    if (chunkError) throw new Error(chunkError.message);

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
    console.error(`Document ingestion failed for ${doc.id}:`, err);
    return NextResponse.json(shape({ ...doc, status: "failed" }));
  }
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("documents")
    .select("id, name, status, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data as DocumentRow[]).map(shape));
}
