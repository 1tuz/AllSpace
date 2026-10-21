import { useEffect, useState } from "react";
import {
  Button,
  THEME_OPTIONS,
  applyTheme,
  getInitialTheme,
  watchSystemTheme,
  type Theme,
  type ThemeMode,
  type ThemeName,
} from "../../ui";
import { isTauri } from "@srelens/core/platform";
import {
  liquidGlassStatus,
  liquidGlassStatusLabel,
  prefersReducedTransparency,
  type LiquidGlassStatus,
} from "../../ui/liquidGlass";

const MODE_OPTIONS: Array<{ mode: ThemeMode; label: string; description: string }> = [
  { mode: "light", label: "Light", description: "Always light" },
  { mode: "dark", label: "Dark", description: "Always dark" },
  { mode: "system", label: "System", description: "Follow OS appearance" },
];

/**
 * Workspace Settings → Appearance: mode, geek palette pack, liquid glass.
 * Persists through classic `applyTheme` so Classic IDE and Workspace stay aligned.
 */
export function AppearanceSection() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [glassStatus, setGlassStatus] = useState<LiquidGlassStatus | null>(null);
  const [reducedTransparency, setReducedTransparency] = useState(() =>
    prefersReducedTransparency(),
  );

  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(theme, (next) => applyTheme(next));
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const onChange = () => setReducedTransparency(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isTauri()) {
      setGlassStatus(null);
      return;
    }
    void liquidGlassStatus()
      .then((status) => {
        if (!cancelled) setGlassStatus(status);
      })
      .catch(() => {
        if (!cancelled) setGlassStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [theme.liquidGlass]);

  function setMode(mode: ThemeMode) {
    setTheme((current) => ({ ...current, mode }));
  }

  function setName(name: ThemeName) {
    setTheme((current) => ({ ...current, name }));
  }

  function setLiquidGlass(liquidGlass: boolean) {
    setTheme((current) => ({ ...current, liquidGlass }));
  }

  const statusLabel = liquidGlassStatusLabel(glassStatus, reducedTransparency);

  return (
    <section className="max-w-3xl" data-testid="appearance-section">
      <h2 className="text-sm font-semibold">Appearance</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Light, dark, or system mode, plus a pack of geek colour schemes. Liquid glass frosts the
        sidebar and overlays; it turns off automatically when the OS asks for reduced transparency.
      </p>

      <div className="mt-4" role="group" aria-label="Theme mode">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Mode</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {MODE_OPTIONS.map((option) => (
            <Button
              key={option.mode}
              variant={theme.mode === option.mode ? "primary" : "ghost"}
              onClick={() => setMode(option.mode)}
              aria-pressed={theme.mode === option.mode}
              title={option.description}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-5" role="group" aria-label="Colour scheme">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Colour scheme
        </p>
        <ul
          className="mt-2 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2"
          role="list"
          aria-label="Colour scheme"
        >
          {THEME_OPTIONS.map((option) => {
            const selected = theme.name === option.id;
            return (
              <li key={option.id} className="bg-background">
                <button
                  type="button"
                  className={`flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    selected
                      ? "bg-muted/40 ring-1 ring-inset ring-primary"
                      : "hover:bg-muted/30"
                  }`}
                  onClick={() => setName(option.id)}
                  aria-pressed={selected}
                  data-testid={`theme-palette-${option.id}`}
                >
                  <span
                    className="mt-0.5 h-4 w-4 shrink-0 rounded-sm ring-1 ring-border/60"
                    style={{ backgroundColor: option.preview }}
                    aria-hidden
                  />
                  <span>
                    <span className="font-medium">{option.name}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{option.description}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-5" role="group" aria-label="Materials">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Materials
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            variant={theme.liquidGlass ? "primary" : "ghost"}
            onClick={() => setLiquidGlass(!theme.liquidGlass)}
            aria-pressed={Boolean(theme.liquidGlass)}
            data-testid="liquid-glass-toggle"
          >
            Liquid glass {theme.liquidGlass ? "on" : "off"}
          </Button>
          <p
            className="text-[11px] text-muted-foreground"
            data-testid="liquid-glass-status"
            aria-live="polite"
          >
            {statusLabel}
          </p>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Frosted glass on chrome, palette, and popovers. Dense lists and tables stay opaque.
          Respects <span className="font-mono">prefers-reduced-transparency</span>.
        </p>
      </div>
    </section>
  );
}
