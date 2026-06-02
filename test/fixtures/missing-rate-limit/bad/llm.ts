import OpenAI from "openai";

const client = new OpenAI();

// No per-user budget, quota, or counter anywhere — unbounded cost path.
export async function summarize(text: string) {
  const res = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: text }],
  });
  return res.choices[0].message.content;
}
