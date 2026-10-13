import { NextRequest, NextResponse } from "next/server";
import { planFileRequest, validatePlanningInput } from "@/lib/file-request-planner";
import { getAuthenticatedUser } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { prompt?: unknown; format?: unknown; answers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = validatePlanningInput(body.prompt, body.format, body.answers ?? []);
  if (!input) {
    return NextResponse.json(
      { error: "A valid prompt, file format, and clarification-answer list are required" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await planFileRequest(input.prompt, input.format, input.answers));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Could not plan the file: ${detail}` }, { status: 502 });
  }
}
