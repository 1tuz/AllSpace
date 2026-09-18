import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const devopsMyWork = vi.hoisted(() => vi.fn());

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  devopsMyWork,
}));

import { HomeScreen } from "./HomeScreen";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  devopsMyWork.mockReset();
  devopsMyWork.mockResolvedValue({ deliveries: [], partial: false, sourceErrors: [] });
});

const appFarm = { id: "appfarm", label: "AppFarm", providers: [] };

describe("HomeScreen", () => {
  it("shows one calm screen-level empty state — never empty headings", async () => {
    render(<HomeScreen profile={appFarm} onOpenDelivery={() => {}} />);

    expect(await screen.findByTestId("home-live-empty")).toBeDefined();
    expect(screen.getByRole("status").textContent).toMatch(/Nothing needs attention/);
    expect(screen.queryByRole("heading", { name: "Needs attention" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "In progress" })).toBeNull();
    expect(screen.queryByText(/sample data/i)).toBeNull();
    expect(screen.queryByText(/Dockview/i)).toBeNull();
    expect(screen.queryByText(/OPS-142/)).toBeNull();
    expect(devopsMyWork).toHaveBeenCalled();
  });

  it("renders rows from devops.myWork without synthetic overlay", async () => {
    devopsMyWork.mockResolvedValue({
      deliveries: [
        {
          id: "live-mr-1",
          anchor: { kind: "pullRequest", value: "!9", source: "gitlab" },
          title: "Live change",
          workId: "LIVE-1",
          stage: "attention",
          stageLabel: "Build failed",
          situations: [{ level: "loud", label: "Pipeline failed" }],
          partial: false,
          sourceErrors: [],
        },
      ],
      partial: false,
      sourceErrors: [],
    });

    render(<HomeScreen profile={appFarm} onOpenDelivery={() => {}} />);

    expect(await screen.findByText(/LIVE-1/)).toBeDefined();
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeDefined();
    expect(screen.queryByText(/OPS-142/)).toBeNull();
  });

  it("does not treat a load failure as an empty inbox", async () => {
    devopsMyWork.mockRejectedValue(new Error("profile unreachable"));

    render(<HomeScreen profile={appFarm} onOpenDelivery={() => {}} />);

    expect(await screen.findByTestId("home-live-error")).toBeDefined();
    expect(screen.getByTestId("home-live-source-errors").textContent).toMatch(/profile unreachable/);
    expect(screen.queryByTestId("home-live-empty")).toBeNull();
    expect(screen.queryByText(/OPS-142/)).toBeNull();
  });

  it("does not claim empty inbox when sources failed and returned no rows", async () => {
    devopsMyWork.mockResolvedValue({
      deliveries: [],
      partial: true,
      sourceErrors: [
        { source: "gitlab", message: "no credential is stored for appfarm/gitlab" },
        {
          source: "workspace",
          message: "delivery list is bounded to recent changes/builds; full search fan-out not implemented",
        },
      ],
    });

    render(<HomeScreen profile={appFarm} onOpenDelivery={() => {}} />);

    expect(await screen.findByTestId("home-live-source-errors")).toBeDefined();
    expect(screen.getByText(/no credential is stored/)).toBeDefined();
    expect(screen.queryByTestId("home-live-empty")).toBeNull();
    expect(screen.queryByText(/Nothing needs attention right now/)).toBeNull();
    expect(screen.getByTestId("home-live-error")).toBeDefined();
  });

  it("has no developer-facing Home copy", () => {
    render(<HomeScreen profile={appFarm} onOpenDelivery={() => {}} />);
    expect(screen.queryByText(/Workspace is main/i)).toBeNull();
    expect(screen.queryByText(/sample data/i)).toBeNull();
    expect(screen.queryByText(/Dockview/i)).toBeNull();
    expect(screen.getByText("My Work")).toBeDefined();
  });

  it("opens a live delivery with its anchor", async () => {
    const onOpen = vi.fn();
    devopsMyWork.mockResolvedValue({
      deliveries: [
        {
          id: "live-mr-1",
          anchor: { kind: "pullRequest", value: "!9", source: "gitlab" },
          title: "Live change",
          workId: "LIVE-1",
          stage: "in_review",
          stageLabel: "In review",
          situations: [],
          partial: false,
          sourceErrors: [],
        },
      ],
      partial: false,
      sourceErrors: [],
    });

    render(<HomeScreen profile={appFarm} onOpenDelivery={onOpen} />);
    await waitFor(() => expect(screen.getByText(/LIVE-1/)).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /Open delivery LIVE-1/ }));
    expect(onOpen).toHaveBeenCalledWith("live-mr-1", {
      kind: "pullRequest",
      value: "!9",
      source: "gitlab",
    });
  });
});
