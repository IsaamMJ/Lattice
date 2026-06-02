import OpenAI from "openai";
import { redis } from "./redis";

const client = new OpenAI();

// Per-user budget counter guards the LLM call — must NOT flag.
async function checkBudget(userId: string) {
  const used = await redis.incr(`llm:budget:${userId}`);
  if (used > 100) throw new Error("quota exceeded");
}

export async function summarize(userId: string, text: string) {
  await checkBudget(userId);
  const res = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: text }],
  });
  return res.choices[0].message.content;
}
