import { settingsStorage } from "@srelens/core";
import { syncNativeLiquidGlass } from "./liquidGlass";

export type ThemeMode = "dark" | "light" | "system";

/** Built-in geek + product palettes. Ids are `data-theme` values. */
export type ThemeName =
  | "slate"
  | "srelens"
  | "graphite"
  | "catppuccin"
  | "dracula"
  | "nord"
  | "tokyonight"
  | "gruvbox"
  | "onedark"
  | "solarized"
  | "monokai"
  | "rosepine"
  | "everforest"
  | "kanagawa";

export interface Theme {
  name: ThemeName;
  mode: ThemeMode;
  /** Frosted “liquid glass” materials on workspace chrome. Off by default. */
  liquidGlass?: boolean;
}

export interface ThemeOption {
  id: ThemeName;
  name: string;
  description: string;
  /** Accent swatch for the picker. */
  preview: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "slate", name: "Slate", description: "Cool blue operations", preview: "#60a5fa" },
  { id: "srelens", name: "srelens", description: "Teal infrastructure console", preview: "#25c7bd" },
  { id: "graphite", name: "Graphite", description: "Monochrome high contrast", preview: "#8b949e" },
  { id: "catppuccin", name: "Catppuccin", description: "Soothing pastel (Mocha / Latte)", preview: "#cba6f7" },
  { id: "dracula", name: "Dracula", description: "Classic purple-vampire dark", preview: "#bd93f9" },
  { id: "nord", name: "Nord", description: "Arctic bluish palette", preview: "#88c0d0" },
  { id: "tokyonight", name: "Tokyo Night", description: "Clean night-city blues", preview: "#7aa2f7" },
  { id: "gruvbox", name: "Gruvbox", description: "Retro groove warm tones", preview: "#fabd2f" },
  { id: "onedark", name: "One Dark", description: "Atom One Dark family", preview: "#61afef" },
  { id: "solarized", name: "Solarized", description: "Ethan Schoonover classic", preview: "#268bd2" },
  { id: "monokai", name: "Monokai", description: "Vibrant Sublime classic", preview: "#a6e22e" },
  { id: "rosepine", name: "Rosé Pine", description: "Natural pine, faux fur, soho vibes", preview: "#c4a7e7" },
  { id: "everforest", name: "Everforest", description: "Green-based comfortable contrast", preview: "#a7c080" },
  { id: "kanagawa", name: "Kanagawa", description: "Dark wave / wave blue", preview: "#7e9cd8" },
];

const KEY = "fl-theme-v2";
const LEGACY_KEY = "fl-theme";
const LEGACY_BRAND = "free" + "lens";
const DEFAULT_THEME: Theme = { name: "slate", mode: "dark", liquidGlass: false };

/** Palettes removed from the product — normalize into the default. */
const REMOVED_PALETTES = new Set(["supabase", "tangerine", "perpetuity", "agentkube"]);

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && THEME_OPTIONS.some((theme) => theme.id === value);
}

function normalizeThemeName(value: unknown): ThemeName {
  if (value === LEGACY_BRAND) return "srelens";
  if (typeof value === "string" && REMOVED_PALETTES.has(value)) return DEFAULT_THEME.name;
  if (isThemeName(value)) return value;
  return DEFAULT_THEME.name;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light" || value === "system";
}

export function resolvedThemeMode(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function normalizeLiquidGlass(value: unknown): boolean {
  return value === true;
}

/** Read the persisted theme (defaults to Slate dark, glass off). */
export function getInitialTheme(): Theme {
  try {
    const stored = settingsStorage.getItem(KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Theme>;
      return {
        name: normalizeThemeName(parsed.name),
        mode: isThemeMode(parsed.mode) ? parsed.mode : DEFAULT_THEME.mode,
        liquidGlass: normalizeLiquidGlass(parsed.liquidGlass),
      };
    }

    const legacy = settingsStorage.getItem(LEGACY_KEY);
    if (legacy === "light" || legacy === "dark") {
      return { ...DEFAULT_THEME, mode: legacy };
    }
  } catch {
    /* storage unavailable, use the default below */
  }
  return { ...DEFAULT_THEME };
}

/**
 * Apply a theme to the document root and persist it.
 * Sets classic `data-theme` / `data-theme-mode`, shadcn `.dark`, and optional `data-glass`.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const mode = resolvedThemeMode(theme.mode);
  const liquidGlass = theme.liquidGlass === true;

  root.dataset.theme = theme.name;
  root.dataset.themeMode = mode;
  root.dataset.themePreference = theme.mode;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
  if (liquidGlass) root.dataset.glass = "liquid";
  else delete root.dataset.glass;

  try {
    settingsStorage.setItem(
      KEY,
      JSON.stringify({
        name: theme.name,
        mode: theme.mode,
        liquidGlass,
      } satisfies Theme),
    );
  } catch {
    /* storage unavailable, theme still applied for this session */
  }

  // Native vibrancy sits behind the WebView; CSS transparency stays in theme-palettes.
  // AppGate boot and both Appearance UIs share this path.
  syncNativeLiquidGlass(liquidGlass);
}

/** Subscribe to OS appearance when mode is `system`. Returns unsubscribe. */
export function watchSystemTheme(theme: Theme, onChange: (next: Theme) => void): () => void {
  if (theme.mode !== "system") return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => onChange({ ...theme });
  query.addEventListener("change", apply);
  return () => query.removeEventListener("change", apply);
}
