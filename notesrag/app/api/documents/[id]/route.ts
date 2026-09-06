import { NextRequest, NextResponse } from "next/server";

// Phase 1: DELETE -> remove document + its chunks (cascade handles chunks)

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
