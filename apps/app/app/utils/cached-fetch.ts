interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function cachedFetch<T>(url: string, options?: { ttl?: number; init?: RequestInit }): Promise<T> {
  const ttl = options?.ttl ?? DEFAULT_TTL_MS;

  // SAFETY: entries are only written by the `cache.set` below, keyed by the same
  // `url` whose caller supplied `T`, so a hit for this url carries a `CacheEntry<T>`.
  const cached = cache.get(url) as CacheEntry<T> | undefined;
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  // SAFETY: in-flight promises are only registered by the `inflight.set` below,
  // keyed by the same `url` whose caller supplied `T`, so a hit resolves to `T`.
  const pending = inflight.get(url) as Promise<T> | undefined;
  if (pending) {
    return pending;
  }

  const fetchPromise = fetch(url, options?.init)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`cachedFetch failed: ${response.status} ${response.statusText}`);
      }
      // SAFETY: `T` is the response contract the caller declares for `url`; this is
      // the JSON parse boundary and `response.ok` was checked immediately above.
      const data = (await response.json()) as T;
      cache.set(url, { data, expiry: Date.now() + ttl });
      return data;
    })
    .finally(() => {
      inflight.delete(url);
    });

  inflight.set(url, fetchPromise);

  return fetchPromise;
}

export function invalidateCache(url?: string): void {
  if (url) {
    cache.delete(url);
  } else {
    cache.clear();
  }
}
