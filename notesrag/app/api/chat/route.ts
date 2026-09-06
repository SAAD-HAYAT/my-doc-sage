import { NextRequest, NextResponse } from "next/server";

// Phase 1: POST -> retrieve top-k chunks, build prompt, call chat(),
//          save exchange to `messages`, return { answer, sources }
// Phase 3: handle tool_calls in the model response
// Phase 4: turn this into a bounded agentic loop

export async function POST(req: NextRequest) {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
