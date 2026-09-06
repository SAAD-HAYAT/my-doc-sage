import { NextRequest, NextResponse } from "next/server";

// Phase 1:
// POST -> parse multipart file (PDF/Markdown), chunk + embed + store,
//         return { id, name, status, createdAt }
// GET  -> list documents

export async function POST(req: NextRequest) {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}

export async function GET() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
