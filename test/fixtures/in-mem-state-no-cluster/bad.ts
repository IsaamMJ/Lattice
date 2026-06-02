// Every declaration here is module-level mutable state that breaks under
// horizontal scaling. Each should flag.

import { LRUCache } from "lru-cache";

// module-level Map used as a cache, then mutated
const cache = new Map<string, string>();

// module-level Set, mutated
const seen = new Set<string>();

// module-level object literal used as a store, then index-assigned
const store: Record<string, number> = {};

// module-level array, pushed to
export const queue: string[] = [];

// module-level numeric counter, incremented
let count = 0;

// in-process LRU cache lib
const lru = new LRUCache({ max: 500 });

// module-scope cron — double-fires on N instances
setInterval(() => {
  count++;
}, 60_000);

export function record(id: string, value: string): void {
  cache.set(id, value);
  seen.add(id);
  store[id] = value;
  queue.push(id);
  count++;
  lru.set(id, value);
}
