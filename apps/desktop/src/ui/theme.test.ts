import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

  it("liquid-glass CSS uses one frost layer — nested fills stay transparent so opacity does not stack", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(__dirname, "../styles/theme-palettes.css"), "utf8");
    // Single frost on the shell — not separate rail/main layers with different opacity.
    expect(css).toMatch(
      /html\[data-glass="liquid"\]\s+\.workspace-shell\s*\{[^}]*backdrop-filter:[^}]*blur/s,
    );
    expect(css).toMatch(
      /html\[data-glass="liquid"\]\s+\.workspace-shell__rail,\s*\n?\s*html\[data-glass="liquid"\]\s+\.workspace-shell\s*>\s*\.flex-1\s*\{[^}]*backdrop-filter:\s*none/s,
    );
    // Opacity utilities (bg-input/30, bg-muted/50, …) must clear — attribute substring covers them.
    expect(css).toMatch(
      /html\[data-glass="liquid"\]\s+\.workspace-shell\s+:is\([^)]*\[class\*="bg-input"\]/s,
    );
    expect(css).toMatch(
      /html\[data-glass="liquid"\]\s+\.workspace-shell\s+:is\([^)]*\[class\*="bg-muted"\][^)]*\):not\([^)]*workspace-dense-row[^)]*\)\s*\{[^}]*background-color:\s*transparent/s,
    );
    // Structural seams: soft hairline, not opaque double borders.
    expect(css).toMatch(
      /html\[data-glass="liquid"\]\s+\.workspace-shell__rail\s*\{[^}]*border-right-color:\s*color-mix/s,
    );
  });

  it("liquid-glass CSS keeps dense list/table rows opaque — selection stays readable over frost", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(__dirname, "../styles/theme-palettes.css"), "utf8");
    expect(css).toMatch(
      /:not\(\.workspace-dense-row,\s*\.fl-data-table__row,\s*\.fl-data-table__head\)/,
    );
    // Chrome / palette / popovers still frost — dense exclusion must not drop those rules.
    expect(css).toMatch(
      /html\[data-glass="liquid"\]\s+\[data-testid="workspace-palette"\]\s*>\s*div\s*\{[^}]*backdrop-filter:[^}]*blur/s,
    );
  });

  it("globals.css clears rail backdrop under prefers-reduced-transparency", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(__dirname, "../styles/globals.css"), "utf8");
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-transparency:\s*reduce\)\s*\{[\s\S]*?\.workspace-shell__rail\s*\{[^}]*backdrop-filter:\s*none/s,
    );
  });

  it("theme-palettes.css forces liquid glass opaque under prefers-reduced-transparency", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(__dirname, "../styles/theme-palettes.css"), "utf8");
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-transparency:\s*reduce\)\s*\{[\s\S]*html\[data-glass="liquid"\][\s\S]*backdrop-filter:\s*none/s,
    );
  });

  it("liquid-glass frosts portaled popovers — Combobox/Command mount outside .workspace-shell", async () => {
    // Radix portals to body; shell-scoped transparent fills never reach them, so
    // context pickers stayed solid charcoal over vibrancy (screenshot regression).
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(__dirname, "../styles/theme-palettes.css"), "utf8");
    expect(css).toMatch(
      /html\[data-glass="liquid"\]\s+\[data-slot="popover-content"\]\s*\{[^}]*backdrop-filter:[^}]*blur/s,
    );
    expect(css).toMatch(
      /html\[data-glass="liquid"\]\s+\[data-slot="popover-content"\]\s*\{[^}]*background-color:\s*color-mix/s,
    );
  });

  it("liquid-glass clears bg-border fills inside the shell — colour-scheme gap-px grids must not paint opaque", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(__dirname, "../styles/theme-palettes.css"), "utf8");
    expect(css).toMatch(
      /html\[data-glass="liquid"\]\s+\.workspace-shell\s+:is\([^)]*\[class\*="bg-border"\]/s,
    );
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
    const originalMatchMedia = window.matchMedia;

    function stubMatchMedia(reducedTransparency: boolean) {
      window.matchMedia = (query: string) =>
        ({
          matches: query.includes("prefers-reduced-transparency") ? reducedTransparency : false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList;
    }

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    it("calls set_liquid_glass(true) when liquidGlass is on under Tauri", () => {
      // jsdom stub already returns matches:false; pin reduce off so native stays on.
      stubMatchMedia(false);
      isTauriMock.mockReturnValue(true);
      applyTheme({ name: "nord", mode: "dark", liquidGlass: true });
      expect(invokeCommandMock).toHaveBeenCalledWith("set_liquid_glass", { enabled: true });
    });

    it("calls set_liquid_glass(false) when liquidGlass is off under Tauri", () => {
      stubMatchMedia(false);
      isTauriMock.mockReturnValue(true);
      applyTheme({ name: "nord", mode: "dark", liquidGlass: false });
      expect(invokeCommandMock).toHaveBeenCalledWith("set_liquid_glass", { enabled: false });
    });

    it("forces set_liquid_glass(false) when OS prefers reduced transparency", () => {
      stubMatchMedia(true);
      isTauriMock.mockReturnValue(true);
      applyTheme({ name: "nord", mode: "dark", liquidGlass: true });
      expect(invokeCommandMock).toHaveBeenCalledWith("set_liquid_glass", { enabled: false });
      expect(document.documentElement.dataset.glass).toBe("liquid");
    });

    it("does not invoke set_liquid_glass outside Tauri", () => {
      isTauriMock.mockReturnValue(false);
      applyTheme({ name: "nord", mode: "dark", liquidGlass: true });
      expect(invokeCommandMock).not.toHaveBeenCalled();
    });

    it("still applies CSS glass when native invoke rejects", async () => {
      stubMatchMedia(false);
      isTauriMock.mockReturnValue(true);
      invokeCommandMock.mockRejectedValueOnce(new Error("no window effects"));
      applyTheme({ name: "nord", mode: "dark", liquidGlass: true });
      expect(document.documentElement.dataset.glass).toBe("liquid");
      await Promise.resolve();
      expect(getInitialTheme().liquidGlass).toBe(true);
    });
  });
});
