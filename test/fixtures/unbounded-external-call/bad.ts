// bad.ts — every executable line below must be flagged.

async function a() {
  const r = await fetch("https://api.example.com/data"); // SHOULD flag
  return r.json();
}

async function b() {
  return fetch(`https://api.example.com/${id}`, { method: "POST", body }); // SHOULD flag
}

async function c() {
  const res = await axios("https://api.example.com/x"); // SHOULD flag
  return res.data;
}

async function d() {
  return axios.get("https://api.example.com/users"); // SHOULD flag
}

async function e() {
  return axios.post("https://api.example.com/users", payload); // SHOULD flag
}

function f() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // SHOULD flag
  return client;
}
