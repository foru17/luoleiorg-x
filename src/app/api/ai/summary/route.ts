import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      message:
        "AI summary endpoint reserved. Implement provider integration later.",
    },
    { status: 501 },
  );
}
