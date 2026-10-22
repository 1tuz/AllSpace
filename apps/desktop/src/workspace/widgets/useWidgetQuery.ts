import { useEffect, useRef, useState } from "react";

const TTL_MS = 30_000;

type CacheEntry = { at: number; value: Promise<unknown> };

/** Board reads are cached per profile and per query — never across profiles. */
const cache = new Map<string, CacheEntry>();

/** Drop board query cache (profile switch / explicit refresh). */
export function clearWidgetCache(): void {
  cache.clear();
}

export type WidgetQueryState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

/**
 * Read one widget source through a capability wrapper.
 *
 * `key` must name the source plus its arguments; `profileId` partitions the
 * cache. A profile switch changes the key, so a late answer from the previous
 * profile is discarded instead of rendered.
 */
export function useWidgetQuery<T>({
  key,
  profileId,
  enabled = true,
  load,
  ttlMs = TTL_MS,
}: {
  key: string;
  profileId: string;
  enabled?: boolean;
  load: () => Promise<T>;
  ttlMs?: number;
}): WidgetQueryState<T> {
  const cacheKey = `${profileId || "default"}\u0000${key}`;
  const loadRef = useRef(load);
  loadRef.current = load;
  const [state, setState] = useState<WidgetQueryState<T>>({
    data: null,
    loading: enabled,
    error: null,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < ttlMs) {
      setState((previous) => ({ ...previous, loading: previous.data === null, error: null }));
      void cached.value.then(
        (value) => {
          if (!cancelled) setState({ data: value as T, loading: false, error: null });
        },
        (reason: unknown) => {
          cache.delete(cacheKey);
          if (!cancelled) {
            setState({
              data: null,
              loading: false,
              error: reason instanceof Error ? reason.message : String(reason),
            });
          }
        },
      );
      return () => {
        cancelled = true;
      };
    }

    setState((previous) => ({ ...previous, loading: true, error: null }));
    const value = loadRef.current();
    cache.set(cacheKey, { at: Date.now(), value });
    void value.then(
      (next) => {
        if (!cancelled) setState({ data: next, loading: false, error: null });
      },
      (reason: unknown) => {
        cache.delete(cacheKey);
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: reason instanceof Error ? reason.message : String(reason),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, ttlMs]);

  return state;
}
