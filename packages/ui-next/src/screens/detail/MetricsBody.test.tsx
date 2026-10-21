import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { K8sObject } from "@srelens/core";
import { MetricsBody } from "./MetricsBody";

const EMPTY_REVISIONS = { status: "ready" as const, data: [] };

function pod(name = "web-1", namespace = "default"): K8sObject {
  return {
    kind: "Pod",
    apiVersion: "v1",
    metadata: { name, namespace },
  };
}

function node(name = "node-a"): K8sObject {
  return {
    kind: "Node",
    apiVersion: "v1",
    metadata: { name },
  };
}

function deployment(name = "web", namespace = "default", matchLabels: Record<string, string> = { app: "web" }): K8sObject {
  return {
    kind: "Deployment",
    apiVersion: "apps/v1",
    metadata: { name, namespace },
    spec: { selector: { matchLabels } },
  };
}

describe("MetricsBody", () => {
  it("polls pod metrics and shows the latest CPU and memory", async () => {
    const podMetricsFn = vi.fn().mockResolvedValue({
      metrics: [{ name: "web-1", namespace: "default", cpuMillicores: 250, memoryMiB: 64 }],
    });
    render(
      <MetricsBody
        kind="Pod"
        object={pod()}
        context="kind-dev"
        revisions={EMPTY_REVISIONS}
        intervalMs={100000}
        podMetricsFn={podMetricsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("0.250 cores")).toBeDefined());
    expect(screen.getByText("64 MiB")).toBeDefined();
    expect(podMetricsFn).toHaveBeenCalledWith("kind-dev", "default");
  });

  it("reads node metrics for a Node", async () => {
    const nodeMetricsFn = vi.fn().mockResolvedValue({
      metrics: [{ name: "node-a", cpuMillicores: 1000, memoryMiB: 2048 }],
    });
    render(
      <MetricsBody
        kind="Node"
        object={node()}
        context="kind-dev"
        revisions={EMPTY_REVISIONS}
        intervalMs={100000}
        nodeMetricsFn={nodeMetricsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("1.000 cores")).toBeDefined());
    expect(screen.getByText("2048 MiB")).toBeDefined();
    expect(nodeMetricsFn).toHaveBeenCalledWith("kind-dev");
  });

  it("shows an empty state when the metrics server has no data", async () => {
    const podMetricsFn = vi.fn().mockResolvedValue({ metrics: [] });
    render(
      <MetricsBody
        kind="Pod"
        object={pod()}
        context="kind-dev"
        revisions={EMPTY_REVISIONS}
        intervalMs={100000}
        podMetricsFn={podMetricsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText(/No metrics available/)).toBeDefined());
  });

  it("aggregates a workload's pods by summing their usage", async () => {
    const podsForSelectorFn = vi.fn().mockResolvedValue({
      pods: [{ name: "web-1" }, { name: "web-2" }],
    });
    const podMetricsFn = vi.fn().mockResolvedValue({
      metrics: [
        { name: "web-1", namespace: "default", cpuMillicores: 250, memoryMiB: 64 },
        { name: "web-2", namespace: "default", cpuMillicores: 250, memoryMiB: 64 },
        { name: "other-9", namespace: "default", cpuMillicores: 999, memoryMiB: 999 },
      ],
    });
    render(
      <MetricsBody
        kind="Deployment"
        object={deployment()}
        context="kind-dev"
        revisions={EMPTY_REVISIONS}
        intervalMs={100000}
        podMetricsFn={podMetricsFn}
        podsForSelectorFn={podsForSelectorFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("0.500 cores")).toBeDefined());
    expect(screen.getByText("128 MiB")).toBeDefined();
    expect(podsForSelectorFn).toHaveBeenCalledWith("kind-dev", "default", { app: "web" });
    expect(screen.getByText(/Aggregated across pods/)).toBeDefined();
  });

  it("offers a time-range filter", async () => {
    const nodeMetricsFn = vi.fn().mockResolvedValue({
      metrics: [{ name: "node-a", cpuMillicores: 1000, memoryMiB: 2048 }],
    });
    render(
      <MetricsBody
        kind="Node"
        object={node()}
        context="kind-dev"
        revisions={EMPTY_REVISIONS}
        intervalMs={100000}
        nodeMetricsFn={nodeMetricsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("1.000 cores")).toBeDefined());
    for (const label of ["5m", "10m", "30m", "1h"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
    expect(screen.getByRole("button", { name: "5m" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("switches the active range when a range button is pressed", async () => {
    const nodeMetricsFn = vi.fn().mockResolvedValue({
      metrics: [{ name: "node-a", cpuMillicores: 1000, memoryMiB: 2048 }],
    });
    render(
      <MetricsBody
        kind="Node"
        object={node()}
        context="kind-dev"
        revisions={EMPTY_REVISIONS}
        intervalMs={100000}
        nodeMetricsFn={nodeMetricsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("1.000 cores")).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: "30m" }));
    expect(screen.getByRole("button", { name: "30m" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "5m" }).getAttribute("aria-pressed")).toBe("false");
  });
});
