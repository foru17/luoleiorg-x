import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      message:
        "AI search endpoint reserved. Implement vector/search backend later.",
    },
    { status: 501 },
  );
}
