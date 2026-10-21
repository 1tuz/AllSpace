import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./chrome", () => ({
  applyWorkspaceChrome: vi.fn(async () => "system" as const),
}));

import { WorkspaceShell } from "./WorkspaceShell";
import { RAIL_COLLAPSED_KEY, type WorkspaceRoute } from "./nav";

afterEach(() => {
  cleanup();
  localStorage.removeItem(RAIL_COLLAPSED_KEY);
});

function renderShell(
  overrides: {
    route?: WorkspaceRoute;
    profileLabel?: string;
    delivery?: { workId: string; title: string } | null;
    onBack?: () => void;
  } = {},
) {
  return render(
    <WorkspaceShell
      route={overrides.route ?? { name: "home" }}
      onNavigate={vi.fn()}
      profiles={[
        { id: "appfarm", label: "AppFarm", providers: [] },
        { id: "komus", label: "Komus", providers: [] },
      ]}
      activeProfileId="komus"
      onSelectProfile={vi.fn()}
      profileLabel={overrides.profileLabel ?? "Komus"}
      delivery={overrides.delivery ?? null}
      onBack={overrides.onBack}
    >
      <div data-testid="shell-child">child</div>
    </WorkspaceShell>,
  );
}

describe("WorkspaceShell", () => {
  it("renders a contextual top bar with profile label above the main column", () => {
    renderShell({ profileLabel: "Komus" });

    expect(screen.getByTestId("contextual-top-bar")).toBeTruthy();
    expect(screen.getByTestId("top-bar-profile").textContent).toBe("Komus");
    expect(screen.getByTestId("shell-child")).toBeTruthy();
    expect(screen.getByTestId("workspace-main-drag")).toBeTruthy();
  });

  it("shows delivery context and back when a Delivery is selected", () => {
    const onBack = vi.fn();
    renderShell({
      delivery: { workId: "OPS-9", title: "Rollout" },
      onBack,
    });

    expect(screen.getByTestId("top-bar-delivery").textContent).toMatch(/OPS-9/);
    fireEvent.click(screen.getByTestId("top-bar-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("on kubernetes route keeps profile only — no cluster identity in the bar", () => {
    renderShell({
      route: { name: "kubernetes" },
      profileLabel: "AppFarm",
      delivery: null,
    });

    const bar = screen.getByTestId("contextual-top-bar");
    expect(bar.textContent).toBe("AppFarm");
    expect(bar.textContent).not.toMatch(/cluster/i);
  });
});
