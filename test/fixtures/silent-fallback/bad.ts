// Fixture: silent-fallback BAD cases. Every flagged line below must produce a hit.

export async function loadConfig(): Promise<unknown> {
  try {
    return JSON.parse(readFileSync("config.json", "utf8"));
  } catch (e) {}                       // empty-catch
}

export async function getUser(id: string): Promise<unknown> {
  try {
    return await db.users.find(id);
  } catch (err) {
    return null;                       // catch-returns-benign
  }
}

export async function flushCache(): Promise<void> {
  try {
    await cache.clear();
  } catch {}                           // empty-catch
}

export function attachHandler(): void {
  doWork().catch(() => {});            // empty-catch (.catch handler)
}
