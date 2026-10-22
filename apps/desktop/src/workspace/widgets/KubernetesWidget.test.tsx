import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listContexts = vi.hoisted(() => vi.fn());
const listPods = vi.hoisted(() => vi.fn());
const podStatusCounts = vi.hoisted(() => vi.fn());

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  listContexts,
  listPods,
  podStatusCounts,
}));

import { KubernetesWidget } from "./KubernetesWidget";
import { clearWidgetCache } from "./useWidgetQuery";

const profile = { id: "appfarm", label: "AppFarm", providers: [] };
const healthy = {
  name: "api-7c9f",
  namespace: "prod",
  phase: "Running",
  ready: "1/1",
  restarts: 0,
  node: "node-a",
  age: "3d",
  image: "acme/api:1",
};
const crashLoop = {
  ...healthy,
  name: "worker-5d",
  phase: "Running",
  ready: "0/1",
  restarts: 12,
  waitingReason: "CrashLoopBackOff",
};
const pending = { ...healthy, name: "batch-9z", phase: "Pending", ready: "0/1" };

function renderDetail(onOpenExplorer: (target?: unknown) => void = () => {}) {
  return render(
    <KubernetesWidget
      profile={profile}
      profileId="appfarm"
      selection={null}
      onSelect={() => {}}
      onOpenExplorer={onOpenExplorer}
      variant="detail"
    />,
  );
}

beforeEach(() => {
  clearWidgetCache();
  listContexts.mockReset().mockResolvedValue({
    contexts: [{ name: "kind-dev", cluster: "kind", isCurrent: true }],
  });
  podStatusCounts.mockReset().mockResolvedValue({
    counts: { pending: 1, running: 12, succeeded: 0, failed: 2, unknown: 0, other: 0 },
  });
  listPods.mockReset().mockResolvedValue({ pods: [healthy, crashLoop, pending] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KubernetesWidget depth", () => {
  it("reads pod counts before listing a single pod, and hands the explorer the surface it clicks", async () => {
    const onOpenExplorer = vi.fn();
    renderDetail(onOpenExplorer);

    await waitFor(() => expect(listContexts).toHaveBeenCalled());
    expect(screen.getAllByText("kind-dev").length).toBeGreaterThan(0);
    await waitFor(() => expect(podStatusCounts).toHaveBeenCalledWith("kind-dev"));
    expect(listPods).not.toHaveBeenCalled();
    expect(screen.getByText("Running").parentElement?.textContent).toContain("12");
    expect(screen.getByText("Failed").parentElement?.textContent).toContain("2");

    fireEvent.click(screen.getByRole("button", { name: "Helm" }));
    expect(onOpenExplorer).toHaveBeenCalledWith({
      context: "kind-dev",
      kind: "helmreleases",
      namespace: "",
      name: "",
    });
  });

  it("lists only the pods a reader has to look at, and opens their logs", async () => {
    const onOpenExplorer = vi.fn();
    renderDetail(onOpenExplorer);

    fireEvent.click(await screen.findByRole("button", { name: "Load pods needing attention" }));
    await waitFor(() => expect(listPods).toHaveBeenCalledWith("kind-dev", ""));

    expect(await screen.findByText("worker-5d")).toBeDefined();
    expect(screen.getByText("batch-9z")).toBeDefined();
    expect(screen.queryByText("api-7c9f")).toBeNull();
    expect(screen.getByText("CrashLoopBackOff")).toBeDefined();

    fireEvent.click(screen.getByText("worker-5d"));
    expect(onOpenExplorer).toHaveBeenCalledWith({
      context: "kind-dev",
      kind: "pods",
      namespace: "prod",
      name: "worker-5d",
      pod: "worker-5d",
    });
  });

  it("renders a failed count as a failure, never as zeros", async () => {
    podStatusCounts.mockResolvedValue({ error: "context expired" });
    renderDetail();

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain("context expired");
    expect(screen.queryByText("Running")).toBeNull();
  });

  it("keeps the compact card to contexts — no cluster calls", async () => {
    render(
      <KubernetesWidget
        profile={profile}
        profileId="appfarm"
        selection={null}
        onSelect={() => {}}
        onOpenExplorer={() => {}}
      />,
    );

    await waitFor(() => expect(listContexts).toHaveBeenCalled());
    expect(screen.getAllByText("kind-dev").length).toBeGreaterThan(0);
    expect(podStatusCounts).not.toHaveBeenCalled();
    expect(listPods).not.toHaveBeenCalled();
  });
});
