import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isTauriMock, invokeCommandMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => false),
  invokeCommandMock: vi.fn(),
}));

vi.mock("@srelens/core/platform", () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock("@srelens/core/transport", () => ({
  invokeCommand: (...args: unknown[]) => invokeCommandMock(...args),
}));

import { AppearanceSection } from "./AppearanceSection";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-glass");
  document.documentElement.classList.remove("dark");
  isTauriMock.mockReset().mockReturnValue(false);
  invokeCommandMock.mockReset();
});

beforeEach(() => {
  localStorage.clear();
  isTauriMock.mockReturnValue(false);
  invokeCommandMock.mockResolvedValue({ supported: false, enabled: false, kind: "none" });
});

describe("AppearanceSection", () => {
  it("renders mode, geek palettes, and liquid glass", () => {
    render(<AppearanceSection />);
    expect(screen.getByTestId("appearance-section")).toBeDefined();
    expect(screen.getByRole("button", { name: "System" })).toBeDefined();
    expect(screen.getByTestId("theme-palette-dracula")).toBeDefined();
    expect(screen.getByTestId("theme-palette-catppuccin")).toBeDefined();
    expect(screen.getByTestId("liquid-glass-toggle")).toBeDefined();
    expect(screen.getByTestId("liquid-glass-status")).toBeDefined();
  });

  it("applies Dracula and liquid glass to the document", () => {
    render(<AppearanceSection />);
    fireEvent.click(screen.getByTestId("theme-palette-dracula"));
    expect(document.documentElement.dataset.theme).toBe("dracula");
    fireEvent.click(screen.getByTestId("liquid-glass-toggle"));
    expect(document.documentElement.dataset.glass).toBe("liquid");
  });

  it("keeps liquid glass after a second palette click (applyTheme must not drop it)", () => {
    render(<AppearanceSection />);
    fireEvent.click(screen.getByTestId("liquid-glass-toggle"));
    expect(document.documentElement.dataset.glass).toBe("liquid");
    fireEvent.click(screen.getByTestId("theme-palette-nord"));
    expect(document.documentElement.dataset.theme).toBe("nord");
    expect(document.documentElement.dataset.glass).toBe("liquid");
  });

  it("lays colour schemes in a shared hairline grid — one outer frame, not a stack of card borders", () => {
    render(<AppearanceSection />);
    const list = screen.getByRole("list", { name: "Colour scheme" });
    expect(list.className).toMatch(/gap-px/);
    expect(list.className).toMatch(/border/);
    expect(list.className).toMatch(/overflow-hidden/);
    const tile = screen.getByTestId("theme-palette-dracula");
    expect(tile.className).not.toMatch(/\bborder-border\b/);
    fireEvent.click(tile);
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    expect(tile.className).toMatch(/ring-/);
  });

  it("shows native liquid glass status from liquidGlassStatus", async () => {
    isTauriMock.mockReturnValue(true);
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "liquid_glass_status") {
        return Promise.resolve({ supported: true, enabled: true, kind: "liquid" });
      }
      return Promise.resolve({ supported: true, enabled: true, kind: "liquid" });
    });
    render(<AppearanceSection />);
    fireEvent.click(screen.getByTestId("liquid-glass-toggle"));
    await waitFor(() => {
      expect(screen.getByTestId("liquid-glass-status").textContent).toBe("Native liquid glass");
    });
    expect(screen.getByTestId("liquid-glass-toggle").textContent).toMatch(/on/);
  });

  it("shows vibrancy fallback status from liquidGlassStatus", async () => {
    isTauriMock.mockReturnValue(true);
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "liquid_glass_status") {
        return Promise.resolve({ supported: true, enabled: true, kind: "vibrancy" });
      }
      return Promise.resolve({ supported: true, enabled: true, kind: "vibrancy" });
    });
    render(<AppearanceSection />);
    await waitFor(() => {
      expect(screen.getByTestId("liquid-glass-status").textContent).toBe("Vibrancy fallback");
    });
  });

  it("shows disabled copy when OS prefers reduced transparency", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({
        matches: query.includes("prefers-reduced-transparency"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;

    isTauriMock.mockReturnValue(true);
    invokeCommandMock.mockResolvedValue({ supported: true, enabled: false, kind: "none" });
    render(<AppearanceSection />);
    expect(screen.getByTestId("liquid-glass-status").textContent).toBe(
      "Disabled by reduced transparency",
    );
    fireEvent.click(screen.getByTestId("liquid-glass-toggle"));
    expect(screen.getByTestId("liquid-glass-toggle").textContent).toMatch(/on/);
    expect(screen.getByTestId("liquid-glass-status").textContent).toBe(
      "Disabled by reduced transparency",
    );

    window.matchMedia = originalMatchMedia;
  });
});
