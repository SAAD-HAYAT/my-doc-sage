import { NextRequest, NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { supabase } from "@/lib/supabase";
import { chunkText } from "@/lib/chunking";
import { embed } from "@/lib/openrouter";

// unpdf bundles pdf.js, which needs the Node.js runtime (not Edge).
export const runtime = "nodejs";

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
  const { data: created, error: insertError } = await supabase
    .from("documents")
    .insert({ name, status: "processing" })
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
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      throw new Error("No extractable text found in the file");
    }

    const rows = [];
    for (const content of chunks) {
      const embedding = await embed(content);
      rows.push({ document_id: doc.id, content, embedding });
    }

    const { error: chunkError } = await supabase.from("chunks").insert(rows);
    if (chunkError) throw new Error(chunkError.message);

    const { data: updated, error: updateError } = await supabase
      .from("documents")
      .update({ status: "ready" })
      .eq("id", doc.id)
      .select()
      .single();

    if (updateError || !updated) throw new Error(updateError?.message ?? "status update failed");

    return NextResponse.json(shape(updated as DocumentRow));
  } catch (err) {
    await supabase.from("documents").update({ status: "failed" }).eq("id", doc.id);
    console.error(`Document ingestion failed for ${doc.id}:`, err);
    return NextResponse.json(shape({ ...doc, status: "failed" }));
  }
}

export async function GET() {
  const { data, error } = await supabase
    .from("documents")
    .select("id, name, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data as DocumentRow[]).map(shape));
}
