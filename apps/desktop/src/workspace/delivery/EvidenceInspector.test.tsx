import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidenceInspector } from "./EvidenceInspector";
import type { TraceEdge, TraceNode } from "../model/deliveryTypes";
import type { DeliveryViewModel } from "../model/deliveryViewModel";

afterEach(() => {
  cleanup();
});

const workNode: TraceNode = {
  id: "issue-1",
  stage: "work",
  kind: "issue",
  source: "jira",
  title: "Fix payments timeout",
  status: "In Progress",
  timestamp: "",
  url: "https://jira.example/OPS-1",
  attributes: { key: "OPS-1", assignee: "ada" },
};

const runtimeNode: TraceNode = {
  id: "wl-1",
  stage: "runtime",
  kind: "workload",
  source: "kubernetes",
  title: "payments-api",
  status: "Available",
  timestamp: "",
  url: null,
  attributes: {
    cluster: "prod-eu",
    namespace: "payments",
    name: "payments-api",
    kind: "Deployment",
  },
};

const incoming: TraceEdge = {
  from: "build-1",
  to: "wl-1",
  relation: "deploys",
  confidence: "strong",
  evidence: [{ kind: "image", detail: "registry/payments@sha256:abc" }],
};

const view: Pick<
  DeliveryViewModel,
  "workId" | "title" | "contour" | "service" | "stageLabel" | "situations" | "verdict"
> = {
  workId: "OPS-1",
  title: "Fix payments timeout",
  contour: "AppFarm",
  service: "payments-api",
  stageLabel: "Needs review",
  situations: [{ level: "loud", label: "Pipeline failed after merge" }],
  verdict: {
    summary: "MR merged but pipeline failed",
    severity: "loud",
    primaryAction: "Open pipeline",
  },
};

describe("EvidenceInspector", () => {
  it("keeps empty-node copy when nothing is selected", () => {
    render(<EvidenceInspector node={null} incoming={null} />);
    expect(screen.getByText("Select a unit in the delivery chain.")).toBeDefined();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("exposes Overview, Evidence, and Runtime tabs with word labels", () => {
    render(
      <EvidenceInspector node={workNode} incoming={null} view={view} />,
    );
    expect(screen.getByRole("tab", { name: "Overview" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Evidence" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Runtime" })).toBeDefined();
  });

  it("shows verdict, situations, and work meta on Overview", () => {
    render(
      <EvidenceInspector node={workNode} incoming={null} view={view} />,
    );
    expect(screen.getByTestId("inspector-overview")).toBeDefined();
    expect(screen.getByTestId("inspector-verdict").textContent).toMatch(/MR merged but pipeline failed/);
    expect(screen.getByTestId("inspector-verdict").textContent).toMatch(/Loud|Needs attention/);
    expect(screen.getByText(/Pipeline failed after merge/)).toBeDefined();
    expect(screen.getByTestId("inspector-work-meta").textContent).toMatch(/OPS-1/);
    expect(screen.getByTestId("inspector-work-meta").textContent).toMatch(/AppFarm/);
    expect(screen.getByTestId("inspector-work-meta").textContent).toMatch(/payments-api/);
    expect(screen.getByTestId("inspector-overview").textContent).toMatch(/Fix payments timeout/);
    expect(screen.queryByTestId("unit-attributes")).toBeNull();
    expect(screen.queryByRole("button", { name: /Explore in Kubernetes/ })).toBeNull();
  });

  it("puts edges and confidence on Evidence only", () => {
    render(
      <EvidenceInspector node={runtimeNode} incoming={incoming} view={view} />,
    );
    expect(screen.queryByText(/Linked by deploys/)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getByTestId("inspector-evidence").textContent).toMatch(/Linked by deploys/);
    expect(screen.getByLabelText(/confidence strong/i)).toBeDefined();
    expect(screen.getByText(/image: registry\/payments@sha256:abc/)).toBeDefined();
    expect(screen.queryByTestId("unit-attributes")).toBeNull();
    expect(screen.queryByRole("button", { name: /Explore in Kubernetes/ })).toBeNull();
  });

  it("puts attributes and Explore on Runtime only", () => {
    const onExploreRuntime = vi.fn();
    render(
      <EvidenceInspector
        node={runtimeNode}
        incoming={incoming}
        view={view}
        profileId="appfarm"
        onExploreRuntime={onExploreRuntime}
      />,
    );
    expect(screen.queryByRole("button", { name: /Explore in Kubernetes/ })).toBeNull();
    expect(screen.queryByTestId("unit-attributes")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Runtime" }));
    expect(screen.getByTestId("inspector-runtime")).toBeDefined();
    expect(screen.getByTestId("unit-attributes").textContent).toMatch(/payments-api/);
    fireEvent.click(screen.getByRole("button", { name: /Explore in Kubernetes/ }));
    expect(onExploreRuntime).toHaveBeenCalledWith({
      context: "prod-eu",
      kind: "deployments",
      namespace: "payments",
      name: "payments-api",
      profileId: "appfarm",
    });
  });

  it("does not offer Explore on Runtime for non-runtime units", () => {
    render(
      <EvidenceInspector
        node={workNode}
        incoming={null}
        view={view}
        onExploreRuntime={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Runtime" }));
    expect(screen.getByTestId("unit-attributes").textContent).toMatch(/assignee/);
    expect(screen.queryByRole("button", { name: /Explore in Kubernetes/ })).toBeNull();
  });

  it("shows Knowledge linked docs from remoteLinks attrs on Overview", () => {
    const withDocs: TraceNode = {
      ...workNode,
      attributes: {
        ...workNode.attributes,
        remoteLinks: JSON.stringify([
          { title: "Ops runbook", url: "https://confluence.example/pages/ops" },
        ]),
      },
    };
    render(<EvidenceInspector node={withDocs} incoming={null} view={view} />);
    const knowledge = screen.getByTestId("inspector-knowledge");
    expect(knowledge.textContent).toMatch(/Knowledge/);
    expect(screen.getByRole("link", { name: "Ops runbook" }).getAttribute("href")).toBe(
      "https://confluence.example/pages/ops",
    );
  });

  it("says no linked docs when attrs carry none — not that Confluence is empty", () => {
    render(<EvidenceInspector node={workNode} incoming={null} view={view} />);
    expect(screen.getByTestId("inspector-knowledge").textContent).toMatch(
      /No linked docs on this unit/,
    );
    expect(screen.getByTestId("inspector-knowledge").textContent).not.toMatch(/Confluence has/);
  });
});
