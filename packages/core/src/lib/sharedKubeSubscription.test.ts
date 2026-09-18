import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WatchHandle } from "./watch";
import {
  SHARED_KUBE_SNAPSHOT_ROW_CAP,
  __resetSharedKubeSubscriptionsForTests,
  __setSharedKubeWatchStarterForTests,
  __sharedKubeLiveWatchCountForTests,
  kubeSubscriptionKey,
  subscribeSharedKube,
} from "./sharedKubeSubscription";

beforeEach(() => {
  __resetSharedKubeSubscriptionsForTests();
});

afterEach(() => {
  __resetSharedKubeSubscriptionsForTests();
});

function mockWatch() {
  const stops: Array<ReturnType<typeof vi.fn>> = [];
  let onRows: ((rows: Array<{ name: string }>) => void) | undefined;
  let onStatus: ((status: "live" | "reconnecting") => void) | undefined;
  let onError: ((error: string) => void) | undefined;
  const starter = vi.fn(
    async (
      _c: string,
      _n: string,
      _k: string,
      rows: (r: Array<{ name: string }>) => void,
      status?: (s: "live" | "reconnecting") => void,
      error?: (e: string) => void,
    ): Promise<WatchHandle> => {
      onRows = rows;
      onStatus = status;
      onError = error;
      const stop = vi.fn();
      stops.push(stop);
      return { stop };
    },
  );
  __setSharedKubeWatchStarterForTests(starter);
  return {
    starter,
    stops,
    pushRows: (rows: Array<{ name: string }>) => onRows?.(rows),
    pushStatus: (s: "live" | "reconnecting") => onStatus?.(s),
    pushError: (e: string) => onError?.(e),
  };
}

describe("kubeSubscriptionKey", () => {
  it("joins context, namespace, kind, and selector digest", () => {
    expect(kubeSubscriptionKey("c", "ns", "pods", "app=web")).toBe("c|ns|pods|app=web");
    expect(kubeSubscriptionKey("c", "", "nodes")).toBe("c||nodes|");
  });
});

describe("subscribeSharedKube", () => {
  it("starts one backend watch for two visible subscribers on the same key", async () => {
    const w = mockWatch();
    const a = vi.fn();
    const b = vi.fn();
    const ha = subscribeSharedKube({
      context: "kind-dev",
      namespace: "default",
      kind: "pods",
      listener: { onRows: a },
    });
    const hb = subscribeSharedKube({
      context: "kind-dev",
      namespace: "default",
      kind: "pods",
      listener: { onRows: b },
    });

    await vi.waitFor(() => expect(w.starter).toHaveBeenCalledTimes(1));
    expect(__sharedKubeLiveWatchCountForTests()).toBe(1);

    w.pushRows([{ name: "web-0" }]);
    expect(a).toHaveBeenCalledWith([{ name: "web-0" }]);
    expect(b).toHaveBeenCalledWith([{ name: "web-0" }]);

    ha.unsubscribe();
    expect(w.stops[0]).not.toHaveBeenCalled();
    hb.unsubscribe();
    expect(w.stops[0]).toHaveBeenCalled();
    expect(__sharedKubeLiveWatchCountForTests()).toBe(0);
  });

  it("lets a Classic-style hidden peer leave the watch with an Explorer peer", async () => {
    const w = mockWatch();
    const classic = subscribeSharedKube({
      context: "kind-dev",
      namespace: "",
      kind: "pods",
      listener: { onRows: vi.fn() },
    });
    const explorer = subscribeSharedKube({
      context: "kind-dev",
      namespace: "",
      kind: "pods",
      listener: { onRows: vi.fn() },
    });
    await vi.waitFor(() => expect(w.starter).toHaveBeenCalledTimes(1));

    classic.setVisible(false);
    expect(w.stops[0]).not.toHaveBeenCalled();
    expect(__sharedKubeLiveWatchCountForTests()).toBe(1);

    explorer.unsubscribe();
    expect(w.stops[0]).toHaveBeenCalled();
    classic.unsubscribe();
  });

  it("does not start a watch when the only subscriber is hidden", async () => {
    const w = mockWatch();
    const onRows = vi.fn();
    const handle = subscribeSharedKube({
      context: "c",
      namespace: "",
      kind: "pods",
      visible: false,
      listener: { onRows },
    });
    await Promise.resolve();
    expect(w.starter).not.toHaveBeenCalled();
    handle.unsubscribe();
  });

  it("stops the backend when the last visible subscriber hides", async () => {
    const w = mockWatch();
    const handle = subscribeSharedKube({
      context: "c",
      namespace: "ns",
      kind: "deployments",
      listener: { onRows: vi.fn() },
    });
    await vi.waitFor(() => expect(w.starter).toHaveBeenCalledTimes(1));
    handle.setVisible(false);
    expect(w.stops[0]).toHaveBeenCalled();
    expect(__sharedKubeLiveWatchCountForTests()).toBe(0);

    handle.setVisible(true);
    await vi.waitFor(() => expect(w.starter).toHaveBeenCalledTimes(2));
    handle.unsubscribe();
  });

  it("delivers the last snapshot when a subscriber becomes visible again", async () => {
    const w = mockWatch();
    const onRows = vi.fn();
    const handle = subscribeSharedKube({
      context: "c",
      namespace: "",
      kind: "pods",
      listener: { onRows },
    });
    await vi.waitFor(() => expect(w.starter).toHaveBeenCalled());
    w.pushRows([{ name: "a" }, { name: "b" }]);
    handle.setVisible(false);
    onRows.mockClear();

    handle.setVisible(true);
    expect(onRows).toHaveBeenCalledWith([{ name: "a" }, { name: "b" }]);
    handle.unsubscribe();
  });

  it("caps retained snapshot rows", async () => {
    const w = mockWatch();
    const onRows = vi.fn();
    const handle = subscribeSharedKube({
      context: "c",
      namespace: "",
      kind: "pods",
      listener: { onRows },
    });
    await vi.waitFor(() => expect(w.starter).toHaveBeenCalled());
    const huge = Array.from({ length: SHARED_KUBE_SNAPSHOT_ROW_CAP + 50 }, (_, i) => ({
      name: `p-${i}`,
    }));
    w.pushRows(huge);
    expect(onRows.mock.calls[0][0]).toHaveLength(SHARED_KUBE_SNAPSHOT_ROW_CAP);
    handle.unsubscribe();
  });

  it("keeps distinct keys on separate watches", async () => {
    const w = mockWatch();
    const a = subscribeSharedKube({
      context: "c",
      namespace: "a",
      kind: "pods",
      listener: { onRows: vi.fn() },
    });
    const b = subscribeSharedKube({
      context: "c",
      namespace: "b",
      kind: "pods",
      listener: { onRows: vi.fn() },
    });
    await vi.waitFor(() => expect(w.starter).toHaveBeenCalledTimes(2));
    a.unsubscribe();
    b.unsubscribe();
  });
});
