// None of these should be flagged.

import { useState, useRef } from "react";

// Read-only config map — declared module-level but NEVER mutated.
const CONFIG = {
  timeout: 5000,
  retries: 3,
  endpoint: "https://api.example.com",
};

// Read-only frozen lookup — never mutated.
const TIERS = new Map<string, number>([
  ["low", 1],
  ["high", 3],
]);

// Map declared INSIDE a function — request-scoped, dies with the call. Fine.
export function tally(items: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const it of items) {
    counts.set(it, (counts.get(it) ?? 0) + 1);
  }
  return counts;
}

// A local counter inside a function — not module state.
export function sum(nums: number[]): number {
  let total = 0;
  for (const n of nums) total += n;
  return total;
}

// React component — useState/useRef are component-local, not server state.
export function Counter() {
  const [n, setN] = useState(0);
  const ref = useRef(0);
  ref.current += 1;
  return n;
}

// setTimeout INSIDE a function (indented) — not module-scope cron.
export function delayed(cb: () => void): void {
  setTimeout(cb, 100);
}

// Reading CONFIG / TIERS is fine; they're consumed, never written.
export function cfg(): number {
  return CONFIG.timeout + (TIERS.get("low") ?? 0);
}

// const cache = new Map(); cache.set(...)  <- commented out, must not flag
// let count = 0; count++                   <- commented out, must not flag
// setInterval(() => {}, 1000)              <- commented out, must not flag
