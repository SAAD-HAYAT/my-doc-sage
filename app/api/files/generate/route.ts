import { NextRequest, NextResponse } from "next/server";
import { generateFilePayload } from "@/lib/file-generation-server";
import type { GeneratedFileFormat } from "@/lib/generated-files";
import { getAuthenticatedUser } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { prompt?: unknown; specification?: unknown; format?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const specification = typeof body.specification === "string" ? body.specification.trim() : "";
  const format = body.format as GeneratedFileFormat;
  if (
    !prompt ||
    prompt.length > 4_000 ||
    !specification ||
    specification.length > 1_000 ||
    (format !== "xlsx" && format !== "pdf" && format !== "md")
  ) {
    return NextResponse.json(
      { error: "A valid prompt, specification, and file format are required" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await generateFilePayload(prompt, specification, format, user.id));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Could not generate the file: ${detail}` }, { status: 502 });
  }
}
