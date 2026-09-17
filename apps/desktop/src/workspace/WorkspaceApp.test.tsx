import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listContexts = vi.hoisted(() => vi.fn());
const devopsTraceDelivery = vi.hoisted(() => vi.fn());

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  listContexts,
  devopsTraceDelivery,
}));

vi.mock("../components/ResourceBrowser", () => ({
  ResourceBrowser: ({ context, kind, focus, onOpenWorkloadLogs, onOpenTerminal }: {
    context: string;
    kind: string;
    focus?: { name: string; namespace: string | null };
    onOpenWorkloadLogs?: (value: { context: string; namespace: string; kind: string; name: string }) => void;
    onOpenTerminal?: (value: { context: string; namespace: string; pod: string }) => void;
  }) => (
    <div data-testid="resource-browser">
      {context}/{kind}/{focus?.namespace ?? ""}/{focus?.name ?? ""}
      <button onClick={() => onOpenWorkloadLogs?.({ context, namespace: "payments", kind: "Deployment", name: "payments-api" })}>Open workload logs</button>
      <button onClick={() => onOpenTerminal?.({ context, namespace: "payments", pod: "payments-api-1" })}>Open pod shell</button>
    </div>
  ),
}));

vi.mock("../components/Dock", () => ({
  Dock: ({ sessions }: { sessions: Array<{ kind: string; pod?: string; workload?: { kind: string; name: string } }> }) => (
    <div data-testid="workspace-dock">
      {sessions.map((session, index) => <span key={index}>{session.pod ?? `${session.workload?.kind}/${session.workload?.name}`}</span>)}
    </div>
  ),
}));

import { WorkspaceApp } from "./WorkspaceApp";
import { FIRST_RUN_KEY } from "./nav";
import { APPFARM_DELIVERY, KOMUS_DELIVERY, homeSections } from "./fixtures";

beforeEach(() => {
  localStorage.setItem(FIRST_RUN_KEY, "1");
  listContexts.mockReset();
  listContexts.mockResolvedValue({ contexts: [{ name: "prod-eu", cluster: "prod" }], error: undefined });
  devopsTraceDelivery.mockReset();
  // Empty live answer keeps fixture nodes on screen (Stage 1 shell still works offline).
  devopsTraceDelivery.mockResolvedValue({
    nodes: [],
    edges: [],
    situations: [],
    partial: false,
    sourceErrors: [],
  });
});

describe("fixtures", () => {
  it("keeps Komus delivery free of Jira nodes", () => {
    expect(KOMUS_DELIVERY.nodes.some((n) => n.source === "jira")).toBe(false);
    expect(KOMUS_DELIVERY.edges.some((e) => e.confidence === "heuristic")).toBe(false);
  });

  it("keeps AppFarm heuristic runtime join labeled heuristic", () => {
    const edge = APPFARM_DELIVERY.edges.find((e) => e.to.startsWith("runtime:"));
    expect(edge?.confidence).toBe("heuristic");
  });

  it("groups Home without requiring a cluster", () => {
    const sections = homeSections();
    expect(sections.needsAttention.some((d) => d.id === APPFARM_DELIVERY.id)).toBe(true);
    expect(sections.building.some((d) => d.id === KOMUS_DELIVERY.id)).toBe(true);
  });
});

describe("WorkspaceApp", () => {
  it("renders Home without selecting a Kubernetes context", () => {
    render(<WorkspaceApp initialRoute={{ name: "home" }} />);
    expect(screen.getByTestId("home-screen")).toBeDefined();
    expect(screen.getByText("What needs attention")).toBeDefined();
    expect(screen.getByText(/No Kubernetes context required/)).toBeDefined();
    expect(screen.getByText(/OPS-142/)).toBeDefined();
  });

  it("opens fixture Delivery Trace with exact and heuristic confidence words", () => {
    render(<WorkspaceApp initialRoute={{ name: "delivery", id: APPFARM_DELIVERY.id }} />);
    const detail = screen.getByTestId("delivery-detail");
    expect(within(detail).getByText(/Delivery trace/)).toBeDefined();
    expect(within(detail).getAllByLabelText("confidence exact").length).toBeGreaterThan(0);
    expect(within(detail).getAllByLabelText("confidence heuristic").length).toBeGreaterThan(0);
    expect(within(detail).getByText(/MR !721 merged/)).toBeDefined();
  });

  it("shows Komus partial source errors instead of empty success", () => {
    render(<WorkspaceApp initialRoute={{ name: "delivery", id: KOMUS_DELIVERY.id }} />);
    expect(screen.getByText(/Partial trace/)).toBeDefined();
    expect(screen.getByTestId("source-errors")).toBeDefined();
    expect(screen.getByText(/folder listing timed out/)).toBeDefined();
  });

  it("lists Connections without a cluster", () => {
    render(<WorkspaceApp initialRoute={{ name: "connections" }} />);
    expect(screen.getByTestId("connections-screen")).toBeDefined();
    expect(screen.getByText("https://sdlc.go.rshbank.ru/jira")).toBeDefined();
    expect(screen.getByText("https://bitbucket-app.komus.net")).toBeDefined();
  });

  it("reaches Kubernetes contexts through the explorer, not global hotbar", async () => {
    render(<WorkspaceApp initialRoute={{ name: "kubernetes" }} />);
    expect(screen.getByTestId("kubernetes-explorer")).toBeDefined();
    expect(listContexts).toHaveBeenCalled();
    expect(await screen.findByRole("combobox", { name: "Cluster context" })).toBeDefined();
    expect(screen.queryByText(/Selected context/)).toBeNull();
  });

  it("navigates Home row into Delivery Trace", () => {
    render(<WorkspaceApp initialRoute={{ name: "home" }} />);
    fireEvent.click(screen.getByRole("button", { name: /OPS-142/ }));
    expect(screen.getByTestId("delivery-detail")).toBeDefined();
  });

  it("opens the delivery command palette with ⌘K", () => {
    render(<WorkspaceApp initialRoute={{ name: "home" }} />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByTestId("workspace-palette")).toBeDefined();
    expect(screen.getByText(/OPS-142 Retry worker/)).toBeDefined();
  });

  it("offers Explore in Kubernetes on a runtime node", () => {
    render(<WorkspaceApp initialRoute={{ name: "delivery", id: APPFARM_DELIVERY.id }} />);
    expect(screen.getByRole("button", { name: /Explore in Kubernetes/ })).toBeDefined();
  });

  it("keeps Explore inside the workspace and focuses the runtime workload", async () => {
    render(<WorkspaceApp initialRoute={{ name: "delivery", id: APPFARM_DELIVERY.id }} />);
    fireEvent.click(screen.getByRole("button", { name: /Explore in Kubernetes/ }));
    expect(await screen.findByTestId("kubernetes-explorer")).toBeDefined();
    expect((await screen.findByTestId("resource-browser")).textContent).toContain("prod-eu/deployments/payments/payments-api");
    fireEvent.click(screen.getByRole("button", { name: "Open workload logs" }));
    expect((await screen.findByTestId("workspace-dock")).textContent).toContain("Deployment/payments-api");
    fireEvent.click(screen.getByRole("button", { name: "Open pod shell" }));
    expect(screen.getByTestId("workspace-dock").textContent).toContain("payments-api-1");
  });
});
