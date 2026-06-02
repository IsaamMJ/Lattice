import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "60 s"),
});

// Public route WITH a distributed rate limiter — must NOT flag.
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const { success } = await ratelimit.limit(ip);
  if (!success) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  return NextResponse.json({ ok: true });
}
