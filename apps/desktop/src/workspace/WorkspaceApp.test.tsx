import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_RUN_KEY } from "./nav";

const loadWorkspaceProfiles = vi.hoisted(() =>
  vi.fn(async () => ({
    profiles: [
      { id: "appfarm", label: "AppFarm", providers: [] },
      { id: "komus", label: "Komus", providers: [] },
    ],
    activeProfileId: "komus",
  })),
);

vi.mock("./model/activeProfile", () => ({
  loadWorkspaceProfiles,
  selectWorkspaceProfile: vi.fn(async (id: string) => ({
    profiles: [
      { id: "appfarm", label: "AppFarm", providers: [] },
      { id: "komus", label: "Komus", providers: [] },
    ],
    activeProfileId: id,
  })),
}));

vi.mock("./chrome", () => ({
  applyWorkspaceChrome: vi.fn(async () => "system" as const),
}));

vi.mock("./screens/HomeScreen", () => ({
  HomeScreen: () => <div data-testid="home-screen" />,
}));
vi.mock("./screens/DeliveriesScreen", () => ({
  DeliveriesScreen: () => <div data-testid="deliveries-screen" />,
}));
vi.mock("./screens/DeliveryTraceScreen", () => ({
  DeliveryTraceScreen: () => <div data-testid="delivery-trace-screen" />,
}));
vi.mock("./screens/ConnectionsScreen", () => ({
  ConnectionsScreen: () => <div data-testid="connections-screen" />,
}));
vi.mock("./screens/SettingsScreen", () => ({
  SettingsScreen: () => <div data-testid="settings-screen" />,
}));
vi.mock("./screens/KubernetesExplorerScreen", () => ({
  KubernetesExplorerScreen: () => <div data-testid="kubernetes-screen" />,
}));
vi.mock("./screens/FirstRunScreen", () => ({
  FirstRunScreen: () => <div data-testid="first-run-screen" />,
}));
vi.mock("./WorkspacePalette", () => ({
  WorkspacePalette: ({
    onAction,
  }: {
    onAction: (action: {
      kind: "explore";
      label: string;
      target: {
        context: string;
        kind: string;
        namespace: string;
        name: string;
        profileId?: string;
      };
    }) => void;
  }) => (
    <button
      type="button"
      data-testid="palette-explore-stub"
      onClick={() =>
        onAction({
          kind: "explore",
          label: "Explore deployments payments/payments-api",
          target: {
            context: "prod-eu",
            kind: "deployments",
            namespace: "payments",
            name: "payments-api",
            profileId: "appfarm",
          },
        })
      }
    >
      Explore stub
    </button>
  ),
}));

import { WorkspaceApp } from "./WorkspaceApp";

afterEach(() => {
  cleanup();
  localStorage.removeItem(FIRST_RUN_KEY);
});

beforeEach(() => {
  localStorage.setItem(FIRST_RUN_KEY, "1");
  loadWorkspaceProfiles.mockClear();
});

describe("WorkspaceApp", () => {
  it("shows the active contour label in the contextual top bar", async () => {
    render(<WorkspaceApp initialRoute={{ name: "home" }} />);

    await waitFor(() => {
      expect(screen.getByTestId("top-bar-profile").textContent).toBe("Komus");
    });
  });

  it("on delivery route shows work id and back navigates to Deliveries", async () => {
    render(
      <WorkspaceApp
        initialRoute={{
          name: "delivery",
          id: "paste:jira:OPS-142",
          anchor: { kind: "issue", value: "OPS-142", source: "jira" },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("top-bar-delivery").textContent).toMatch(/OPS-142/);
    });
    expect(screen.getByTestId("delivery-trace-screen")).toBeTruthy();

    fireEvent.click(screen.getByTestId("top-bar-back"));
    expect(await screen.findByTestId("deliveries-screen")).toBeTruthy();
    expect(screen.queryByTestId("top-bar-delivery")).toBeNull();
  });

  it("on kube route does not put cluster identity in the top bar", async () => {
    render(<WorkspaceApp initialRoute={{ name: "kubernetes" }} />);

    await waitFor(() => {
      expect(screen.getByTestId("top-bar-profile").textContent).toBe("Komus");
    });
    const bar = screen.getByTestId("contextual-top-bar");
    expect(bar.textContent).toBe("Komus");
    expect(bar.textContent).not.toMatch(/cluster/i);
    expect(screen.getByTestId("kubernetes-screen")).toBeTruthy();
  });

  it("palette Explore navigates to Kubernetes with the same handoff as inspector", async () => {
    render(<WorkspaceApp initialRoute={{ name: "home" }} />);
    await waitFor(() => {
      expect(screen.getByTestId("home-screen")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("palette-explore-stub"));

    expect(await screen.findByTestId("kubernetes-screen")).toBeTruthy();
  });
});
