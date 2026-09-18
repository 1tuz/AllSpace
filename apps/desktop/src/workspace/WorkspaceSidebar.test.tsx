import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

afterEach(() => {
  cleanup();
});

describe("WorkspaceSidebar", () => {
  it("marks the rail chrome as a Tauri drag region (CSS alone does nothing on macOS WKWebView)", () => {
    render(
      <WorkspaceSidebar
        route={{ name: "home" }}
        onNavigate={vi.fn()}
        onOpenPalette={vi.fn()}
        profiles={[
          { id: "appfarm", label: "AppFarm", providers: [] },
          { id: "komus", label: "Komus", providers: [] },
        ]}
        activeProfileId="komus"
        onSelectProfile={vi.fn()}
      />,
    );

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
});
