import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JobSummary, K8sObject, PodMetric, PodSummary, ReplicaSetSummary } from "@srelens/core";
import { defaultState } from "../../lib/tabs";
import * as store from "../../lib/tabsStore";

const { listReplicaSets, podsForSelector, podMetrics, listJobs } = vi.hoisted(() => ({
  listReplicaSets: vi.fn(async (): Promise<{ replicasets?: ReplicaSetSummary[]; error?: string }> => ({
    replicasets: [],
  })),
  podsForSelector: vi.fn(async (): Promise<{ pods?: PodSummary[]; error?: string }> => ({ pods: [] })),
  podMetrics: vi.fn(async (): Promise<{ metrics?: PodMetric[]; error?: string }> => ({ metrics: [] })),
  listJobs: vi.fn(async (): Promise<{ jobs?: JobSummary[]; error?: string }> => ({ jobs: [] })),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  listReplicaSets,
  podsForSelector,
  podMetrics,
  listJobs,
}));

import { useDeployRevisions } from "./WorkloadBody";
import { kindOffersRelations, RelationsBody } from "./RelationsBody";

const CTX = {
  name: "kind-dev",
  stableId: "kind",
  cluster: "kind",
  server: "https://kind",
  isCurrent: true,
  sourceFile: "/tmp/config",
  authKind: "client certificate" as const,
};

function deployment(selector: Record<string, string> = { app: "web" }): K8sObject {
  return {
    kind: "Deployment",
    apiVersion: "apps/v1",
    metadata: { name: "web", namespace: "default" },
    spec: { selector: { matchLabels: selector }, template: { spec: { containers: [] } } },
    status: {},
  };
}

function cronjob(): K8sObject {
  return {
    kind: "CronJob",
    apiVersion: "batch/v1",
    metadata: { name: "nightly", namespace: "ops" },
    spec: { schedule: "0 2 * * *" },
    status: {},
  };
}

function service(selector: Record<string, string> = { app: "web" }): K8sObject {
  return {
    kind: "Service",
    apiVersion: "v1",
    metadata: { name: "web", namespace: "default" },
    spec: { selector },
  };
}

/** Hand the shared revisions hook into Relations the way detailData will. */
function RelationsWithRevisions({
  kind,
  object,
  context,
}: {
  kind: string;
  object: K8sObject;
  context: string;
}) {
  const ns = String(object.metadata?.namespace ?? "");
  const name = String(object.metadata?.name ?? "");
  const revisions = useDeployRevisions(context, ns, name, kind === "Deployment");
  return <RelationsBody kind={kind} object={object} context={context} revisions={revisions} />;
}

describe("kindOffersRelations", () => {
  it("offers Relations for the kinds classic WorkloadRelations covered", () => {
    expect(kindOffersRelations("Deployment", deployment())).toBe(true);
    expect(kindOffersRelations("CronJob", cronjob())).toBe(true);
    expect(kindOffersRelations("Service", service())).toBe(true);
  });

  it("withholds Relations when there is nothing to relate", () => {
    const cm: K8sObject = {
      kind: "ConfigMap",
      apiVersion: "v1",
      metadata: { name: "cm", namespace: "default" },
      data: {},
    };
    expect(kindOffersRelations("ConfigMap", cm)).toBe(false);
    expect(kindOffersRelations("Pod", {
      kind: "Pod",
      apiVersion: "v1",
      metadata: { name: "p", namespace: "default" },
      spec: {},
    })).toBe(false);
    expect(kindOffersRelations("Service", service({}))).toBe(false);
  });
});

describe("RelationsBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listReplicaSets.mockResolvedValue({ replicasets: [] });
    podsForSelector.mockResolvedValue({ pods: [] });
    podMetrics.mockResolvedValue({ metrics: [] });
    listJobs.mockResolvedValue({ jobs: [] });
    store.setState(defaultState([CTX]));
  });

  it("lists a Deployment's revisions and opens a ReplicaSet on row click", async () => {
    listReplicaSets.mockResolvedValue({
      replicasets: [
        { name: "web-5", revision: "5", desired: 1, ready: 1, current: 1, age: "56d" },
        { name: "web-4", revision: "4", desired: 0, ready: 0, current: 0, age: "66d" },
      ],
    });
    const open = vi.spyOn(store, "openTab");
    render(<RelationsWithRevisions kind="Deployment" object={deployment()} context="kind-dev" />);

    await waitFor(() => expect(screen.getByText("web-5")).toBeDefined());
    expect(screen.getByRole("heading", { level: 3, name: "Deploy Revisions" })).toBeDefined();
    expect(listReplicaSets).toHaveBeenCalledWith("kind-dev", "default", "web");
    fireEvent.click(screen.getByText("web-5"));
    expect(open).toHaveBeenCalledWith("/k/ReplicaSet/default/web-5", { clusterName: "kind-dev" });
  });

  it("lists managed pods and opens Pod / Node", async () => {
    podsForSelector.mockResolvedValue({
      pods: [
        {
          name: "web-1",
          namespace: "default",
          phase: "Running",
          image: "nginx:1.27",
          ready: "1/1",
          restarts: 0,
          node: "node-a",
          age: "2d",
        },
      ],
    });
    podMetrics.mockResolvedValue({
      metrics: [{ name: "web-1", namespace: "default", cpuMillicores: 12, memoryMiB: 28 }],
    });
    const open = vi.spyOn(store, "openTab");
    render(<RelationsWithRevisions kind="Deployment" object={deployment()} context="kind-dev" />);

    await waitFor(() => expect(screen.getByText("web-1")).toBeDefined());
    expect(screen.getByRole("heading", { level: 3, name: "Pods" })).toBeDefined();
    expect(podsForSelector).toHaveBeenCalledWith("kind-dev", "default", { app: "web" }, []);
    fireEvent.click(screen.getByRole("button", { name: "Open Pod web-1" }));
    expect(open).toHaveBeenCalledWith("/k/Pod/default/web-1", { clusterName: "kind-dev" });
    fireEvent.click(screen.getByRole("button", { name: "Open Node node-a" }));
    expect(open).toHaveBeenLastCalledWith("/k/Node/-/node-a", { clusterName: "kind-dev" });
  });

  it("still lists pods when metrics are unavailable", async () => {
    podsForSelector.mockResolvedValue({
      pods: [
        {
          name: "web-1",
          namespace: "default",
          phase: "Running",
          image: "nginx:1.27",
          ready: "1/1",
          restarts: 0,
          node: "node-a",
          age: "2d",
        },
      ],
    });
    podMetrics.mockResolvedValue({ error: "metrics-server not found" });
    render(<RelationsWithRevisions kind="Deployment" object={deployment()} context="kind-dev" />);
    await waitFor(() => expect(screen.getByText("web-1")).toBeDefined());
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("keeps a refused pods list on screen with the reason, never as an absence", async () => {
    podsForSelector.mockResolvedValue({
      error: "pods is forbidden: User cannot list resource pods",
    });
    render(<RelationsWithRevisions kind="Deployment" object={deployment()} context="kind-dev" />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "Pods" })).toBeDefined());
    // Humanized copy + "Original error" details both mention permission/forbidden.
    expect(screen.getAllByText(/forbidden|permission/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("No pods")).toBeNull();
  });

  it("lists a CronJob's owned jobs and opens one", async () => {
    listJobs.mockResolvedValue({
      jobs: [
        {
          name: "nightly-2",
          namespace: "ops",
          completions: "1/1",
          active: 0,
          failed: 0,
          duration: "2m",
          owner: "nightly",
          age: "1h",
        },
        {
          name: "other",
          namespace: "ops",
          completions: "1/1",
          active: 0,
          failed: 0,
          duration: "1m",
          owner: "different",
          age: "2h",
        },
      ],
    });
    const open = vi.spyOn(store, "openTab");
    render(<RelationsWithRevisions kind="CronJob" object={cronjob()} context="kind-dev" />);

    await waitFor(() => expect(screen.getByText("nightly-2")).toBeDefined());
    expect(screen.queryByText("other")).toBeNull();
    expect(listJobs).toHaveBeenCalledWith("kind-dev", "ops");
    fireEvent.click(screen.getByText("nightly-2"));
    expect(open).toHaveBeenCalledWith("/k/Job/ops/nightly-2", { clusterName: "kind-dev" });
  });

  it("lists a Service's selected pods via relatedPodSelector", async () => {
    podsForSelector.mockResolvedValue({
      pods: [
        {
          name: "web-1",
          namespace: "default",
          phase: "Running",
          image: "nginx:1.27",
          ready: "1/1",
          restarts: 0,
          node: "n1",
          age: "1d",
        },
      ],
    });
    render(<RelationsWithRevisions kind="Service" object={service()} context="kind-dev" />);
    await waitFor(() => expect(screen.getByText("web-1")).toBeDefined());
    expect(podsForSelector).toHaveBeenCalledWith("kind-dev", "default", { app: "web" }, []);
  });
});
