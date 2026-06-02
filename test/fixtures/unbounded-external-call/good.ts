// good.ts — none of these may be flagged.

// Calls WITH a bound:
async function withSignal() {
  return fetch("https://api.example.com/data", { signal: AbortSignal.timeout(5000) });
}

async function withSignalMultiline() {
  return fetch("https://api.example.com/data", {
    method: "POST",
    signal: controller.signal,
  });
}

async function axiosWithTimeout() {
  return axios.get("https://api.example.com/x", { timeout: 5000 });
}

async function axiosWithTimeoutMultiline() {
  return axios("https://api.example.com/x", {
    method: "GET",
    timeout: 3000,
  });
}

function openaiWithTimeout() {
  return new OpenAI({ apiKey: key, timeout: 20000 });
}

// Commented-out network calls must NOT flag:
// const r = await fetch("https://api.example.com/data");
//   return axios.get("https://api.example.com/x");

// Non-network code that merely mentions the words:
function notNetwork() {
  const fetchSize = 10;          // identifier contains "fetch" but no call
  const prefetched = cache.fetchedAt;
  const obj = { axios: false };  // property, not a call
  return fetchSize;
}

// String / comment containing the call name, not an actual call:
const doc = "use fetch() with a signal";

// Method named fetch on a non-network object (still spared via no-bound? — it
// has no bound, but it's a real local method call we don't want to flag).
// We accept this is out of scope; it reads from a queue, not the network.
class Queue {
  fetchNext() { return this.items.shift(); }
}
