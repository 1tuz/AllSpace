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

  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(theme, (next) => applyTheme(next));
  }, [theme]);

  function setMode(mode: ThemeMode) {
    setTheme((current) => ({ ...current, mode }));
  }

  function setName(name: ThemeName) {
    setTheme((current) => ({ ...current, name }));
  }

  function setLiquidGlass(liquidGlass: boolean) {
    setTheme((current) => ({ ...current, liquidGlass }));
  }

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
        <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {THEME_OPTIONS.map((option) => {
            const selected = theme.name === option.id;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  className={`flex w-full items-start gap-3 border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selected ? "border-primary bg-muted/50" : "border-border hover:bg-muted/40"
                  }`}
                  onClick={() => setName(option.id)}
                  aria-pressed={selected}
                  data-testid={`theme-palette-${option.id}`}
                >
                  <span
                    className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border border-border"
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
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant={theme.liquidGlass ? "primary" : "ghost"}
            onClick={() => setLiquidGlass(!theme.liquidGlass)}
            aria-pressed={Boolean(theme.liquidGlass)}
            data-testid="liquid-glass-toggle"
          >
            Liquid glass {theme.liquidGlass ? "on" : "off"}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Frosted glass across the workspace shell (rail, screens, panels, dock). Respects{" "}
          <span className="font-mono">prefers-reduced-transparency</span>.
        </p>
      </div>
    </section>
  );
}
