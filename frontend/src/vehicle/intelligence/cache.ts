// Offline-first cache for the Vehicle Intelligence layer. Values are JSON-encoded
// into the primitive storage layer so arbitrary objects round-trip. Each fetcher
// returns the network result and caches it; on failure it falls back to cache.
// Cloud-sync ready: a future sync worker can read/replace these keyed entries.
import { storage } from "@/src/utils/storage";

const PREFIX = "veh_intel:";

export async function cacheSet(key: string, value: unknown): Promise<void> {
  await storage.setItem(PREFIX + key, JSON.stringify(value));
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await storage.getItem<string>(PREFIX + key, "");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Fetch with offline fallback: try network, cache success, else return last cache.
export async function fetchCached<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T | null; fromCache: boolean }> {
  try {
    const data = await fetcher();
    await cacheSet(key, data);
    return { data, fromCache: false };
  } catch {
    const cached = await cacheGet<T>(key);
    return { data: cached, fromCache: true };
  }
}
