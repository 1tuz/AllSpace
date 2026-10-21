import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { RAIL_COLLAPSED_KEY, type WorkspaceRoute } from "./nav";

type SidebarCallbacks = {
  onNavigate: (route: WorkspaceRoute) => void;
  onSelectProfile: (profileId: string) => void;
  onCollapsedChange: (collapsed: boolean) => void;
};

afterEach(() => {
  cleanup();
  localStorage.removeItem(RAIL_COLLAPSED_KEY);
});

function renderSidebar(
  overrides: Partial<SidebarCallbacks & { collapsed: boolean }> = {},
) {
  return render(
    <WorkspaceSidebar
      route={{ name: "home" }}
      onNavigate={overrides.onNavigate ?? vi.fn()}
      profiles={[
        { id: "appfarm", label: "AppFarm", providers: [] },
        { id: "komus", label: "Komus", providers: [] },
      ]}
      activeProfileId="komus"
      onSelectProfile={overrides.onSelectProfile ?? vi.fn()}
      collapsed={overrides.collapsed ?? false}
      onCollapsedChange={overrides.onCollapsedChange ?? vi.fn()}
    />,
  );
}

describe("WorkspaceSidebar", () => {
  it("marks the rail chrome as a Tauri drag region (CSS alone does nothing on macOS WKWebView)", () => {
    renderSidebar();

    const rail = screen.getByTestId("workspace-sidebar");
    // Traffic-light pad + empty rail chrome must drag — not only a child
    // packed with no-drag profile/search controls (that left zero grab pixels).
    expect(rail.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(rail.classList.contains("workspace-shell__drag")).toBe(true);
    // Interactive controls must stay clickable: no drag attribute on them.
    expect(screen.getByTestId("profile-switcher").hasAttribute("data-tauri-drag-region")).toBe(
      false,
    );
    expect(screen.getByTestId("profile-switcher").classList.contains("workspace-shell__no-drag")).toBe(
      true,
    );
  });

  it("keeps the rail to profile switcher + nav — no brand mark and no Command palette chrome", () => {
    renderSidebar();

    expect(screen.queryByTestId("workspace-brand-mark")).toBeNull();
    expect(screen.queryByText(/Command palette/i)).toBeNull();
    expect(screen.getByTestId("profile-switcher")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Salience" })).toBeTruthy();
  });

  it("offers a collapse control; collapsed rail shows icons without visible labels", () => {
    const onCollapsedChange = vi.fn();
    const { rerender } = renderSidebar({ onCollapsedChange });

    const toggle = screen.getByTestId("workspace-rail-collapse");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);

    rerender(
      <WorkspaceSidebar
        route={{ name: "home" }}
        onNavigate={vi.fn()}
        profiles={[
          { id: "appfarm", label: "AppFarm", providers: [] },
          { id: "komus", label: "Komus", providers: [] },
        ]}
        activeProfileId="komus"
        onSelectProfile={vi.fn()}
        collapsed
        onCollapsedChange={onCollapsedChange}
      />,
    );

    const rail = screen.getByTestId("workspace-sidebar");
    expect(rail.getAttribute("data-collapsed")).toBe("true");
    expect(screen.queryByTestId("profile-switcher")).toBeNull();
    expect(screen.queryByText("My Work")).toBeNull();
    expect(screen.queryByText("Deliveries")).toBeNull();
    expect(screen.getByRole("button", { name: "My Work" })).toBeTruthy();
    expect(screen.getByTestId("workspace-rail-collapse").getAttribute("aria-expanded")).toBe("false");
  });
});
