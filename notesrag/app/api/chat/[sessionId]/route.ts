import { NextRequest, NextResponse } from "next/server";

// Phase 1: GET -> return message history for a session

export async function GET(
  req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
