import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Phase 1: DELETE -> remove document + its chunks (cascade handles chunks)

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { error } = await supabase.from("documents").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
