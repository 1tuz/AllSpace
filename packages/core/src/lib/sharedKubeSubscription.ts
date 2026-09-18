import { watchResource, type WatchHandle, type WatchStatus } from "./watch";

/**
 * Shared kube watch owner (below React).
 *
 * One backend `watchResource` per subscription key while any subscriber is
 * visible. Hidden subscribers do not keep the stream alive. Classic and
 * Explorer ResourceBrowsers default to this owner; pass `sharedWatch={false}`
 * for the direct `watchResource` fallback.
 */

export type SharedKubeRow = { name: string };

/** Cap retained snapshot rows for late subscribers (replace-in-place, not history). */
export const SHARED_KUBE_SNAPSHOT_ROW_CAP = 2000;

export type SharedKubeListener = {
  onRows: (rows: SharedKubeRow[]) => void;
  onStatus?: (status: WatchStatus) => void;
  onError?: (error: string) => void;
};

export type SharedKubeHandle = {
  /** Host visibility — false stops the backend watch when no visible peers remain. */
  setVisible: (visible: boolean) => void;
  unsubscribe: () => void;
};

export type SharedKubeSubscribeOpts = {
  context: string;
  namespace: string;
  kind: string;
  /** Sorted/normalized selectors; empty when none. */
  selectorDigest?: string;
  kubeconfigFiles?: string[];
  /** Initial visibility. Default true. */
  visible?: boolean;
  listener: SharedKubeListener;
};

type WatchStarter = (
  context: string,
  namespace: string,
  kind: string,
  onRows: (rows: Array<{ name: string }>) => void,
  onStatus?: (status: WatchStatus) => void,
  onError?: (error: string) => void,
  kubeconfigFiles?: string[],
) => Promise<WatchHandle>;

type Subscriber = {
  id: number;
  visible: boolean;
  listener: SharedKubeListener;
};

type Entry = {
  key: string;
  context: string;
  namespace: string;
  kind: string;
  kubeconfigFiles: string[];
  subscribers: Map<number, Subscriber>;
  handle: WatchHandle | null;
  starting: boolean;
  lastSnapshot: SharedKubeRow[] | null;
  lastStatus: WatchStatus;
};

const entries = new Map<string, Entry>();
let nextSubId = 1;
let startWatch: WatchStarter = watchResource;

/** Canonical key: `context | namespace | kind | selectorDigest`. */
export function kubeSubscriptionKey(
  context: string,
  namespace: string,
  kind: string,
  selectorDigest = "",
): string {
  return `${context}|${namespace}|${kind}|${selectorDigest}`;
}

function boundSnapshot(rows: SharedKubeRow[]): SharedKubeRow[] {
  if (rows.length <= SHARED_KUBE_SNAPSHOT_ROW_CAP) return rows;
  return rows.slice(0, SHARED_KUBE_SNAPSHOT_ROW_CAP);
}

function visibleCount(entry: Entry): number {
  let n = 0;
  for (const sub of entry.subscribers.values()) {
    if (sub.visible) n++;
  }
  return n;
}

function fanOutRows(entry: Entry, rows: SharedKubeRow[]) {
  const bounded = boundSnapshot(rows);
  entry.lastSnapshot = bounded;
  for (const sub of entry.subscribers.values()) {
    if (!sub.visible) continue;
    sub.listener.onRows(bounded);
  }
}

function fanOutStatus(entry: Entry, status: WatchStatus) {
  entry.lastStatus = status;
  for (const sub of entry.subscribers.values()) {
    if (!sub.visible) continue;
    sub.listener.onStatus?.(status);
  }
}

function fanOutError(entry: Entry, error: string) {
  for (const sub of entry.subscribers.values()) {
    if (!sub.visible) continue;
    sub.listener.onError?.(error);
  }
}

function stopBackend(entry: Entry) {
  entry.handle?.stop();
  entry.handle = null;
  entry.starting = false;
}

function ensureBackend(entry: Entry) {
  if (entry.handle || entry.starting) return;
  if (visibleCount(entry) === 0) return;

  entry.starting = true;
  const key = entry.key;
  void startWatch(
    entry.context,
    entry.namespace,
    entry.kind,
    (rows) => {
      const current = entries.get(key);
      if (!current || current !== entry) return;
      fanOutRows(current, rows as SharedKubeRow[]);
    },
    (status) => {
      const current = entries.get(key);
      if (!current || current !== entry) return;
      fanOutStatus(current, status);
    },
    (error) => {
      const current = entries.get(key);
      if (!current || current !== entry) return;
      fanOutError(current, error);
    },
    entry.kubeconfigFiles,
  ).then(
    (h) => {
      const current = entries.get(key);
      if (!current || current !== entry || visibleCount(current) === 0) {
        h.stop();
        if (current === entry) {
          entry.handle = null;
          entry.starting = false;
        }
        return;
      }
      entry.handle = h;
      entry.starting = false;
    },
    (e: unknown) => {
      const current = entries.get(key);
      if (!current || current !== entry) return;
      entry.starting = false;
      const message = e instanceof Error ? e.message : String(e);
      fanOutError(current, message);
    },
  );
}

function reconcile(entry: Entry) {
  if (entry.subscribers.size === 0) {
    stopBackend(entry);
    entries.delete(entry.key);
    return;
  }
  if (visibleCount(entry) === 0) {
    stopBackend(entry);
    return;
  }
  ensureBackend(entry);
}

/**
 * Register interest in a kube list watch. Starts the backend only while at
 * least one subscriber for the key is visible.
 */
export function subscribeSharedKube(opts: SharedKubeSubscribeOpts): SharedKubeHandle {
  const selectorDigest = opts.selectorDigest ?? "";
  const key = kubeSubscriptionKey(opts.context, opts.namespace, opts.kind, selectorDigest);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      key,
      context: opts.context,
      namespace: opts.namespace,
      kind: opts.kind,
      kubeconfigFiles: opts.kubeconfigFiles ?? [],
      subscribers: new Map(),
      handle: null,
      starting: false,
      lastSnapshot: null,
      lastStatus: "live",
    };
    entries.set(key, entry);
  }

  const id = nextSubId++;
  const visible = opts.visible ?? true;
  entry.subscribers.set(id, { id, visible, listener: opts.listener });

  if (visible && entry.lastSnapshot) {
    opts.listener.onRows(entry.lastSnapshot);
    opts.listener.onStatus?.(entry.lastStatus);
  }

  reconcile(entry);

  return {
    setVisible(next: boolean) {
      const current = entries.get(key);
      if (!current) return;
      const sub = current.subscribers.get(id);
      if (!sub) return;
      if (sub.visible === next) return;
      sub.visible = next;
      if (next && current.lastSnapshot) {
        sub.listener.onRows(current.lastSnapshot);
        sub.listener.onStatus?.(current.lastStatus);
      }
      reconcile(current);
    },
    unsubscribe() {
      const current = entries.get(key);
      if (!current) return;
      current.subscribers.delete(id);
      reconcile(current);
    },
  };
}

/** Test-only: how many keys currently hold a live backend handle. */
export function __sharedKubeLiveWatchCountForTests(): number {
  let n = 0;
  for (const entry of entries.values()) {
    if (entry.handle) n++;
  }
  return n;
}

/** Test-only: replace the watch starter (pass `null` to restore). */
export function __setSharedKubeWatchStarterForTests(fn: WatchStarter | null): void {
  startWatch = fn ?? watchResource;
}

/** Test-only: drop all entries and stop handles. */
export function __resetSharedKubeSubscriptionsForTests(): void {
  for (const entry of entries.values()) {
    stopBackend(entry);
  }
  entries.clear();
  nextSubId = 1;
  startWatch = watchResource;
}
