import { describe, it, expect, beforeEach, vi } from "vitest";

const { isTauriMock, invokeCommandMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => false),
  invokeCommandMock: vi.fn(async () => undefined),
}));

vi.mock("@srelens/core/platform", () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock("@srelens/core/transport", () => ({
  invokeCommand: invokeCommandMock,
}));

import { getInitialTheme, applyTheme, THEME_OPTIONS } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-mode");
  document.documentElement.removeAttribute("data-theme-preference");
  document.documentElement.removeAttribute("data-glass");
  document.documentElement.classList.remove("dark");
  isTauriMock.mockReset().mockReturnValue(false);
  invokeCommandMock.mockReset().mockResolvedValue(undefined);
});

describe("theme", () => {
  it("defaults to the Slate dark theme without liquid glass", () => {
    expect(getInitialTheme()).toEqual({ name: "slate", mode: "dark", liquidGlass: false });
  });

  it("applies and persists a named light theme, and reads it back", () => {
    applyTheme({ name: "srelens", mode: "light" });
    expect(document.documentElement.dataset.theme).toBe("srelens");
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(getInitialTheme()).toEqual({ name: "srelens", mode: "light", liquidGlass: false });
  });

  it("marks dark with both data attributes and the shadcn `dark` class", () => {
    applyTheme({ name: "graphite", mode: "light" });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    applyTheme({ name: "graphite", mode: "dark" });
    expect(document.documentElement.dataset.theme).toBe("graphite");
    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(getInitialTheme()).toEqual({ name: "graphite", mode: "dark", liquidGlass: false });
  });

  it("persists geek palettes such as Catppuccin and Dracula", () => {
    applyTheme({ name: "catppuccin", mode: "dark" });
    expect(getInitialTheme().name).toBe("catppuccin");
    applyTheme({ name: "dracula", mode: "light" });
    expect(getInitialTheme()).toMatchObject({ name: "dracula", mode: "light" });
  });

  it("toggles liquid glass on the document root", () => {
    applyTheme({ name: "nord", mode: "dark", liquidGlass: true });
    expect(document.documentElement.dataset.glass).toBe("liquid");
    expect(getInitialTheme().liquidGlass).toBe(true);
    applyTheme({ name: "nord", mode: "dark", liquidGlass: false });
    expect(document.documentElement.dataset.glass).toBeUndefined();
  });

  it("liquid-glass CSS clears opaque body/#root paint — frosted chrome over solid fill is invisible", async () => {
    // theme-palettes.css owns materials; without transparent html/body/#root the
    // macOS vibrancy behind the WebView never shows through the shell.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(__dirname, "../styles/theme-palettes.css"), "utf8");
    expect(css).toMatch(/html\[data-glass="liquid"\]\s+body/);
    expect(css).toMatch(/html\[data-glass="liquid"\]\s+#root/);
    expect(css).toMatch(
      /html\[data-glass="liquid"\],\s*\n?\s*html\[data-glass="liquid"\]\s+body,\s*\n?\s*html\[data-glass="liquid"\]\s+#root\s*\{[^}]*background:\s*transparent/s,
    );
  });

  it("liquid-glass CSS frosts the whole workspace surface stack, not only the rail", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(__dirname, "../styles/theme-palettes.css"), "utf8");
    // Opaque Tailwind fills on screens/panels were hiding native glass.
    expect(css).toMatch(/html\[data-glass="liquid"\][^{]*\.bg-background/);
    expect(css).toMatch(/html\[data-glass="liquid"\][^{]*\.workspace-shell header/);
    expect(css).toMatch(/html\[data-glass="liquid"\][^{]*\[data-testid\^="workspace-panel-"\]/);
    expect(css).toMatch(/color-mix\(in oklab, var\(--background\)[^)]+transparent\)/);
  });

  it("ships a pack of named geek schemes", () => {
    const ids = THEME_OPTIONS.map((option) => option.id);
    for (const id of [
      "catppuccin",
      "dracula",
      "nord",
      "tokyonight",
      "gruvbox",
      "onedark",
      "solarized",
      "monokai",
      "rosepine",
      "everforest",
      "kanagawa",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("migrates the old string preference into the default palette", () => {
    localStorage.setItem("fl-theme", "light");
    expect(getInitialTheme()).toEqual({ name: "slate", mode: "light", liquidGlass: false });
  });

  it("migrates removed palette names into the default palette", () => {
    localStorage.setItem("fl-theme-v2", JSON.stringify({ name: "supabase", mode: "dark" }));
    expect(getInitialTheme()).toEqual({ name: "slate", mode: "dark", liquidGlass: false });
  });

  describe("native liquid glass (Tauri)", () => {
    it("calls set_liquid_glass(true) when liquidGlass is on under Tauri", () => {
      isTauriMock.mockReturnValue(true);
      applyTheme({ name: "nord", mode: "dark", liquidGlass: true });
      expect(invokeCommandMock).toHaveBeenCalledWith("set_liquid_glass", { enabled: true });
    });

    it("calls set_liquid_glass(false) when liquidGlass is off under Tauri", () => {
      isTauriMock.mockReturnValue(true);
      applyTheme({ name: "nord", mode: "dark", liquidGlass: false });
      expect(invokeCommandMock).toHaveBeenCalledWith("set_liquid_glass", { enabled: false });
    });

    it("does not invoke set_liquid_glass outside Tauri", () => {
      isTauriMock.mockReturnValue(false);
      applyTheme({ name: "nord", mode: "dark", liquidGlass: true });
      expect(invokeCommandMock).not.toHaveBeenCalled();
    });

    it("still applies CSS glass when native invoke rejects", async () => {
      isTauriMock.mockReturnValue(true);
      invokeCommandMock.mockRejectedValueOnce(new Error("no window effects"));
      applyTheme({ name: "nord", mode: "dark", liquidGlass: true });
      expect(document.documentElement.dataset.glass).toBe("liquid");
      await Promise.resolve();
      expect(getInitialTheme().liquidGlass).toBe(true);
    });
  });
});
