// Fixture: silent-fallback GOOD cases. NONE of these must produce a hit.

export async function loadConfig(): Promise<unknown> {
  try {
    return JSON.parse(readFileSync("config.json", "utf8"));
  } catch (e) {
    // catch logs + rethrows — error surfaces, not swallowed
    console.error("config load failed", e);
    throw e;
  }
}

export async function getUser(id: string): Promise<unknown> {
  try {
    return await db.users.find(id);
  } catch (err) {
    logger.warn("user lookup failed", err);
    return null;                       // returns null BUT logs first — fine
  }
}

export async function pollOptional(): Promise<void> {
  try {
    await fetchOptionalFeatureFlag();
  } catch {}                           // intentional: feature flag is best-effort
}

export async function flushCache(): Promise<void> {
  try {
    await cache.clear();
    // intentional: cache clear failure is non-fatal
  } catch {}
}

export async function onSignup(user: User): Promise<void> {
  await db.users.insert(user);
  await notifyUser(user);              // awaited — not fire-and-forget
}

export async function persist(user: User): Promise<void> {
  const ok = saveUser(user);           // assigned — not a bare statement
  return ok;
}

export function attachHandler(): void {
  doWork().catch((e) => console.error(e)); // handler logs — not empty
}

// A commented empty catch should never be flagged:
// } catch {}
//
// notifyUser(user);
