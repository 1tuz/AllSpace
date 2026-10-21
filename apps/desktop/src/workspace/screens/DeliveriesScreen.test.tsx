import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const devopsListDeliveries = vi.hoisted(() => vi.fn());
const devopsTraceDelivery = vi.hoisted(() => vi.fn());

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  devopsListDeliveries,
  devopsTraceDelivery,
}));

import { DeliveriesScreen } from "./DeliveriesScreen";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  devopsListDeliveries.mockReset();
  devopsListDeliveries.mockResolvedValue({ deliveries: [], partial: false, sourceErrors: [] });
  devopsTraceDelivery.mockReset();
  devopsTraceDelivery.mockResolvedValue({ nodes: [], edges: [], situations: [], partial: false, sourceErrors: [] });
});

const appFarm = { id: "appfarm", label: "AppFarm", providers: [] };
const noopExplore = () => {};

describe("DeliveriesScreen", () => {
  it("shows a truthful empty without synthetic overlay", async () => {
    render(
      <DeliveriesScreen
        profile={appFarm}
        filter=""
        onFilter={() => {}}
        onExploreRuntime={noopExplore}
      />,
    );

    expect(await screen.findByTestId("deliveries-live-empty")).toBeDefined();
    expect(screen.getByRole("status").textContent).toMatch(/No deliveries to show yet/);
    expect(screen.queryByText(/OPS-142/)).toBeNull();
    expect(screen.queryByText(/sample data/i)).toBeNull();
    expect(screen.queryByText(/not wired/i)).toBeNull();
    expect(devopsListDeliveries).toHaveBeenCalled();
  });

  it("keeps source failure distinct from empty", async () => {
    devopsListDeliveries.mockRejectedValue(new Error("tls handshake failed"));

    render(
      <DeliveriesScreen
        profile={appFarm}
        filter=""
        onFilter={() => {}}
        onExploreRuntime={noopExplore}
      />,
    );

    expect(await screen.findByTestId("deliveries-live-error")).toBeDefined();
    expect(screen.getByTestId("deliveries-live-source-errors").textContent).toMatch(/tls handshake/);
    expect(screen.queryByTestId("deliveries-live-empty")).toBeNull();
  });

  it("does not claim empty list when providers returned only sourceErrors", async () => {
    devopsListDeliveries.mockResolvedValue({
      deliveries: [],
      partial: true,
      sourceErrors: [{ source: "gitlab", message: "no credential is stored for appfarm/gitlab" }],
    });

    render(
      <DeliveriesScreen
        profile={appFarm}
        filter=""
        onFilter={() => {}}
        onExploreRuntime={noopExplore}
      />,
    );

    expect(await screen.findByTestId("deliveries-live-source-errors")).toBeDefined();
    expect(screen.queryByTestId("deliveries-live-empty")).toBeNull();
    expect(screen.getByTestId("deliveries-live-error")).toBeDefined();
    expect(screen.queryByText(/Partial results/)).toBeNull();
  });

  it("sends a live filter change to its owner", async () => {
    const onFilter = vi.fn();
    render(
      <DeliveriesScreen
        profile={appFarm}
        filter=""
        onFilter={onFilter}
        onExploreRuntime={noopExplore}
      />,
    );

    expect(await screen.findByTestId("deliveries-live-empty")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Filter deliveries"), {
      target: { value: "OPS" },
    });
    expect(onFilter).toHaveBeenCalled();
  });

  it("keeps the provider-backed list visible while previewing a selected delivery", async () => {
    devopsListDeliveries.mockResolvedValue({
      deliveries: [{
        id: "live-42",
        anchor: { kind: "issue", value: "LIVE-42" },
        workId: "LIVE-42",
        title: "Real delivery",
        stage: "attention",
        stageLabel: "Needs review",
        situations: [],
        partial: false,
        sourceErrors: [],
      }],
      partial: false,
      sourceErrors: [],
    });

    render(<DeliveriesScreen profile={appFarm} filter="" onFilter={() => {}} onExploreRuntime={noopExplore} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open delivery LIVE-42/ }));

    expect(screen.getByTestId("deliveries-master-detail")).toBeDefined();
    expect(screen.getByRole("list", { name: "Deliveries" })).toBeDefined();
    expect(await screen.findByTestId("delivery-detail")).toBeDefined();
    expect(devopsTraceDelivery).toHaveBeenCalledWith({ kind: "issue", value: "LIVE-42" }, undefined, { profileId: "appfarm" });
  });

  it("labels an incomplete trace as partial instead of an empty success", async () => {
    devopsListDeliveries.mockResolvedValue({
      deliveries: [{
        id: "live-partial",
        anchor: { kind: "issue", value: "LIVE-PARTIAL" },
        workId: "LIVE-PARTIAL",
        title: "Partially available delivery",
        stage: "attention",
        stageLabel: "Needs review",
        situations: [],
        partial: true,
        sourceErrors: [],
      }],
      partial: false,
      sourceErrors: [],
    });
    devopsTraceDelivery.mockResolvedValue({
      nodes: [],
      edges: [],
      situations: [],
      partial: true,
      sourceErrors: [{ source: "jenkins", message: "credential is not configured" }],
    });

    render(<DeliveriesScreen profile={appFarm} filter="" onFilter={() => {}} onExploreRuntime={noopExplore} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open delivery LIVE-PARTIAL/ }));

    expect(await screen.findByText(/Partial delivery/)).toBeDefined();
    expect(screen.getByTestId("source-errors").textContent).toMatch(/credential is not configured/);
    expect(screen.getByTestId("empty-live-trace").textContent).toMatch(/not an empty success/);
  });

  it("hands a runtime node Explore click to onExploreRuntime", async () => {
    const onExploreRuntime = vi.fn();
    devopsListDeliveries.mockResolvedValue({
      deliveries: [{
        id: "live-rt",
        anchor: { kind: "issue", value: "LIVE-RT" },
        workId: "LIVE-RT",
        title: "Runtime delivery",
        stage: "attention",
        stageLabel: "Needs review",
        situations: [],
        partial: false,
        sourceErrors: [],
      }],
      partial: false,
      sourceErrors: [],
    });
    devopsTraceDelivery.mockResolvedValue({
      nodes: [{
        id: "wl-1",
        kind: "workload",
        source: "kubernetes",
        title: "payments-api",
        url: null,
        attributes: {
          cluster: "prod-eu",
          namespace: "payments",
          name: "payments-api",
          kind: "Deployment",
        },
      }],
      edges: [],
      situations: [],
      partial: false,
      sourceErrors: [],
    });

    render(
      <DeliveriesScreen
        profile={appFarm}
        filter=""
        onFilter={() => {}}
        onExploreRuntime={onExploreRuntime}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Open delivery LIVE-RT/ }));
    fireEvent.click(await screen.findByRole("tab", { name: "Runtime" }));
    fireEvent.click(await screen.findByRole("button", { name: /Explore in Kubernetes/ }));

    expect(onExploreRuntime).toHaveBeenCalledWith({
      context: "prod-eu",
      kind: "deployments",
      namespace: "payments",
      name: "payments-api",
      profileId: "appfarm",
    });
  });
});
