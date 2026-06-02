import { NextRequest, NextResponse } from "next/server";

// Public contact form endpoint. No rate-limit token of any kind.
export async function POST(req: NextRequest) {
  const body = await req.json();
  await sendEmail(body);
  return NextResponse.json({ ok: true });
}

async function sendEmail(_body: unknown) {
  return true;
}
