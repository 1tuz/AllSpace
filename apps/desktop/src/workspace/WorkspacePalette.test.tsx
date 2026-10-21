import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const devopsSearch = vi.hoisted(() => vi.fn());
const devopsTraceDelivery = vi.hoisted(() => vi.fn());

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  devopsSearch,
  devopsTraceDelivery,
}));

import { WorkspacePalette, type PaletteAction } from "./WorkspacePalette";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  devopsSearch.mockReset();
  devopsSearch.mockResolvedValue({ anchors: [], partial: false, sourceErrors: [] });
  devopsTraceDelivery.mockReset();
  devopsTraceDelivery.mockResolvedValue({
    nodes: [],
    edges: [],
    situations: [],
    partial: false,
    sourceErrors: [],
  });
});

function setup(extra?: Partial<ComponentProps<typeof WorkspacePalette>>) {
  const onAction = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <WorkspacePalette open onClose={onClose} onAction={onAction} {...extra} />,
  );
  return { ...utils, onAction, onClose };
}

describe("WorkspacePalette", () => {
  it("offers Explore for the selected delivery's runtime nodes", async () => {
    devopsTraceDelivery.mockResolvedValue({
      nodes: [
        {
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
        },
      ],
      edges: [],
      situations: [],
      partial: false,
      sourceErrors: [],
    });

    const { onAction } = setup({
      contextAnchor: { kind: "issue", value: "OPS-142" },
      profileId: "appfarm",
    });

    const explore = await screen.findByRole("option", {
      name: "Explore deployments payments/payments-api",
    });
    expect(devopsTraceDelivery).toHaveBeenCalledWith(
      { kind: "issue", value: "OPS-142" },
      undefined,
      { profileId: "appfarm" },
    );
    expect(screen.queryByText(/cluster index/i)).toBeNull();
    expect(screen.getByRole("option", { name: "Go to My Work" })).toBeTruthy();

    fireEvent.click(explore);
    expect(onAction).toHaveBeenCalledWith({
      kind: "explore",
      label: "Explore deployments payments/payments-api",
      target: {
        context: "prod-eu",
        kind: "deployments",
        namespace: "payments",
        name: "payments-api",
        profileId: "appfarm",
      },
    } satisfies PaletteAction);
  });

  it("offers Explore when search finds a delivery with runtime attrs", async () => {
    devopsSearch.mockResolvedValue({
      anchors: [{ kind: "issue", value: "LIVE-RT", source: "jira" }],
      partial: false,
      sourceErrors: [],
    });
    devopsTraceDelivery.mockImplementation(async (anchor: { value: string }) => {
      if (anchor.value === "LIVE-RT") {
        return {
          nodes: [
            {
              id: "wl-1",
              kind: "workload",
              source: "kubernetes",
              title: "checkout-api",
              url: null,
              attributes: {
                cluster: "staging",
                namespace: "checkout",
                name: "checkout-api",
                kind: "Deployment",
              },
            },
          ],
          edges: [],
          situations: [],
          partial: false,
          sourceErrors: [],
        };
      }
      return { nodes: [], edges: [], situations: [], partial: false, sourceErrors: [] };
    });

    const { onAction } = setup({ profileId: "appfarm" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "LIVE" } });

    const explore = await screen.findByRole("option", {
      name: "Explore deployments checkout/checkout-api",
    });
    expect(screen.getByRole("option", { name: /Trace issue LIVE-RT/ })).toBeTruthy();

    fireEvent.click(explore);
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "explore",
        target: expect.objectContaining({
          context: "staging",
          name: "checkout-api",
        }),
      }),
    );
  });

  it("does not surface a global cluster list as primary content", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Go to Deliveries" })).toBeTruthy();
    });
    expect(screen.queryByText(/prod-eu/)).toBeNull();
    expect(screen.queryByText(/All clusters/i)).toBeNull();
    expect(screen.queryByRole("option", { name: /Explore/ })).toBeNull();
  });
});
