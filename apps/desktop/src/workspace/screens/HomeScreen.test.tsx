import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const devopsMyWork = vi.hoisted(() => vi.fn());
const devopsTraceDelivery = vi.hoisted(() => vi.fn());
const listContexts = vi.hoisted(() => vi.fn());
const podStatusCounts = vi.hoisted(() => vi.fn());

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  devopsMyWork,
  devopsTraceDelivery,
  listContexts,
  podStatusCounts,
}));

import { HomeScreen } from "./HomeScreen";
import { clearWidgetCache } from "../widgets/useWidgetQuery";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  clearWidgetCache();
  devopsMyWork.mockReset();
  devopsMyWork.mockResolvedValue({ deliveries: [], partial: false, sourceErrors: [] });
  devopsTraceDelivery.mockReset();
  devopsTraceDelivery.mockResolvedValue({
    nodes: [],
    edges: [],
    situations: [],
    partial: false,
    sourceErrors: [],
  });
  listContexts.mockReset();
  listContexts.mockResolvedValue({ contexts: [] });
  podStatusCounts.mockReset();
  podStatusCounts.mockResolvedValue({
    counts: { pending: 0, running: 4, succeeded: 0, failed: 0, unknown: 0, other: 0 },
  });
});

const appFarm = { id: "appfarm", label: "AppFarm", providers: [] };
const noopExplore = () => {};

const liveDelivery = {
  id: "live-mr-1",
  anchor: { kind: "pullRequest", value: "9", source: "gitlab" },
  title: "Live change",
  workId: "LIVE-1",
  stage: "attention",
  stageLabel: "Build failed",
  situations: [{ level: "loud", label: "Pipeline failed" }],
  partial: false,
  sourceErrors: [],
};

describe("HomeScreen", () => {
  it("shows one calm screen-level empty state — never empty headings", async () => {
    render(<HomeScreen profile={appFarm} onExploreRuntime={noopExplore} />);

    expect(await screen.findByTestId("home-live-empty")).toBeDefined();
    expect(screen.getByTestId("home-live-empty").textContent).toMatch(/Nothing needs attention/);
    expect(screen.queryByRole("heading", { name: "Needs attention" })).toBeNull();
    expect(screen.queryByText(/sample data/i)).toBeNull();
    expect(screen.queryByText(/Dockview/i)).toBeNull();
    expect(screen.queryByText(/OPS-142/)).toBeNull();
    expect(devopsMyWork).toHaveBeenCalled();
  });

  it("renders rows from devops.myWork inside the My Work widget", async () => {
    devopsMyWork.mockResolvedValue({
      deliveries: [liveDelivery],
      partial: false,
      sourceErrors: [],
    });

    render(<HomeScreen profile={appFarm} onExploreRuntime={noopExplore} />);

    fireEvent.click(screen.getByRole("button", { name: "Pin My Work" }));
    await waitFor(() => expect(screen.getByText(/LIVE-1/)).toBeDefined());
    expect(screen.getByTestId("widget-summary")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeDefined();
    expect(screen.queryByText(/OPS-142/)).toBeNull();
  });

  it("does not treat a load failure as an empty inbox", async () => {
    devopsMyWork.mockRejectedValue(new Error("profile unreachable"));

    render(<HomeScreen profile={appFarm} onExploreRuntime={noopExplore} />);

    // The detail body is mounted on first open, so open the My Work widget.
    fireEvent.click(screen.getByRole("button", { name: "Pin My Work" }));
    expect(await screen.findByTestId("home-live-source-errors")).toBeDefined();
    expect(screen.getByTestId("home-live-source-errors").textContent).toMatch(/profile unreachable/);
    expect(screen.getByTestId("home-live-error")).toBeDefined();
    expect(screen.queryByTestId("home-live-empty")).toBeNull();
    expect(screen.queryByText(/OPS-142/)).toBeNull();
  });

  it("does not claim an empty inbox when sources failed and returned no rows", async () => {
    devopsMyWork.mockResolvedValue({
      deliveries: [],
      partial: true,
      sourceErrors: [
        { source: "gitlab", message: "no credential is stored for appfarm/gitlab" },
      ],
    });

    render(<HomeScreen profile={appFarm} onExploreRuntime={noopExplore} />);

    fireEvent.click(screen.getByRole("button", { name: "Pin My Work" }));
    expect(await screen.findByTestId("home-live-source-errors")).toBeDefined();
    expect(screen.getByText(/no credential is stored/)).toBeDefined();
    expect(screen.queryByTestId("home-live-empty")).toBeNull();
    expect(screen.getByTestId("home-live-error")).toBeDefined();
    expect(screen.queryByText(/Partial results/)).toBeNull();
  });

  it("has no developer-facing Home copy", () => {
    render(<HomeScreen profile={appFarm} onExploreRuntime={noopExplore} />);
    expect(screen.queryByText(/Workspace is main/i)).toBeNull();
    expect(screen.queryByText(/sample data/i)).toBeNull();
    expect(screen.queryByText(/Dockview/i)).toBeNull();
    expect(screen.getByText("My Work")).toBeDefined();
  });

  it("selects a live row inline and links it to the Trace widget", async () => {
    devopsMyWork.mockResolvedValue({
      deliveries: [liveDelivery],
      partial: false,
      sourceErrors: [],
    });

    render(<HomeScreen profile={appFarm} onExploreRuntime={noopExplore} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin My Work" }));
    await waitFor(() => expect(screen.getByText(/LIVE-1/)).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /Open delivery LIVE-1/ }));

    const summary = screen.getByTestId("home-trace-summary");
    expect(summary.textContent).toMatch(/Live change/);
    // Pinning another widget supersedes the previous one: open the Trace to
    // inspect the chain it resolved.
    fireEvent.click(screen.getByRole("button", { name: "Pin Delivery Trace" }));
    expect(await screen.findByTestId("delivery-detail")).toBeDefined();
  });

  it("expands a widget to the whole board and restores it", async () => {
    render(<HomeScreen profile={appFarm} onExploreRuntime={noopExplore} />);

    fireEvent.click(screen.getByRole("button", { name: "Expand My Work" }));
    expect(screen.getByTestId("widget-board").getAttribute("data-board-mode")).toBe("expanded");
    expect(screen.getByTestId("widget-summary").getAttribute("data-widget-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Restore My Work" }));
    expect(screen.getByTestId("widget-board").getAttribute("data-board-mode")).toBe("grid");
  });

  it("hands the explorer a cluster surface from the Kubernetes widget", async () => {
    const onExploreRuntime = vi.fn();
    listContexts.mockResolvedValue({
      contexts: [{ name: "kind-dev", cluster: "kind", isCurrent: true }],
    });
    render(<HomeScreen profile={appFarm} onExploreRuntime={onExploreRuntime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Pin Kubernetes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Port forwards" }));

    expect(onExploreRuntime).toHaveBeenCalledWith({
      context: "kind-dev",
      kind: "portforwards",
      namespace: "",
      name: "",
    });
  });

  it("opens a widget on hover without pinning it", async () => {    const user = userEvent.setup();
    render(<HomeScreen profile={appFarm} onExploreRuntime={noopExplore} />);

    await user.hover(screen.getByTestId("widget-kubernetes"));
    await waitFor(() =>
      expect(screen.getByTestId("widget-kubernetes").getAttribute("data-widget-state")).toBe(
        "hover",
      ),
    );
    expect(
      screen.getByTestId("widget-kubernetes").getAttribute("data-widget-expanded"),
    ).toBe("false");
  });

  it("switching profile drops the selection and reads that profile's layout", async () => {
    devopsMyWork.mockResolvedValue({
      deliveries: [liveDelivery],
      partial: false,
      sourceErrors: [],
    });
    const { rerender } = render(
      <HomeScreen profile={appFarm} onExploreRuntime={noopExplore} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pin My Work" }));
    await waitFor(() => expect(screen.getByText(/LIVE-1/)).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /Open delivery LIVE-1/ }));
    expect(screen.getByTestId("home-trace-summary").textContent).toMatch(/Live change/);

    rerender(
      <HomeScreen
        profile={{ id: "komus", label: "Komus", providers: [] }}
        onExploreRuntime={noopExplore}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("home-trace-summary").textContent).toMatch(/Select an issue/),
    );
  });

  it("reorders widgets and saves the layout per profile", async () => {
    render(<HomeScreen profile={appFarm} onExploreRuntime={noopExplore} />);
    const board = screen.getByTestId("widget-board");
    const idsBefore = Array.from(board.querySelectorAll("[data-widget-id]")).map((node) =>
      node.getAttribute("data-widget-id"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Move CI/CD earlier" }));

    const idsAfter = Array.from(board.querySelectorAll("[data-widget-id]")).map((node) =>
      node.getAttribute("data-widget-id"),
    );
    expect(idsAfter).not.toEqual(idsBefore);
    expect(localStorage.getItem("srelens.workspace.board.appfarm")).toContain('"ci"');
  });
});
