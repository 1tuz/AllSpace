import { isTauri } from "@srelens/core/platform";
import { invokeCommand } from "@srelens/core/transport";

/** Shape returned by the Tauri `liquid_glass_status` command. */
export type LiquidGlassStatus = {
  supported: boolean;
  enabled: boolean;
  kind: string;
};

/**
 * Ask the native shell for liquid-glass capability + current state.
 * Only meaningful under Tauri; callers should gate with `isTauri()`.
 */
export function liquidGlassStatus(): Promise<LiquidGlassStatus> {
  return invokeCommand<LiquidGlassStatus>("liquid_glass_status");
}

/** OS Accessibility → Display → Reduce transparency. */
export function prefersReducedTransparency(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
}

/**
 * Human-readable native glass status — separate from the preference toggle.
 * Reduce transparency always wins over kind, matching CSS + `syncNativeLiquidGlass`.
 */
export function liquidGlassStatusLabel(
  status: Pick<LiquidGlassStatus, "supported" | "enabled" | "kind"> | null,
  reducedTransparency: boolean = prefersReducedTransparency(),
): string {
  if (reducedTransparency) return "Disabled by reduced transparency";
  if (!status) return "Status unavailable";
  if (!status.supported) return "Not supported on this platform";
  switch (status.kind) {
    case "liquid":
      return "Native liquid glass";
    case "vibrancy":
      return "Vibrancy fallback";
    default:
      return status.enabled ? "Unavailable" : "Inactive";
  }
}

/** Last preference passed to {@link syncNativeLiquidGlass} (before OS reduce gate). */
let lastEnabled = false;
let transparencyListenerAttached = false;

function ensureTransparencyListener(): void {
  if (transparencyListenerAttached) return;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  transparencyListenerAttached = true;
  const query = window.matchMedia("(prefers-reduced-transparency: reduce)");
  query.addEventListener("change", () => {
    applyNative(lastEnabled);
  });
}

function applyNative(enabled: boolean): void {
  if (!isTauri()) return;
  const nativeEnabled = enabled && !prefersReducedTransparency();
  void invokeCommand("set_liquid_glass", { enabled: nativeEnabled }).catch((error) => {
    console.warn("set_liquid_glass failed:", error);
  });
}

/**
 * Best-effort sync of the CSS `liquidGlass` preference to the native window
 * effect. Never throws — theme apply must not break if the command is missing
 * or the platform rejects effects.
 *
 * When the OS asks for reduced transparency, native vibrancy is forced off so
 * it stays aligned with the CSS `@media (prefers-reduced-transparency: reduce)`
 * materials in globals.css / theme-palettes.css.
 */
export function syncNativeLiquidGlass(enabled: boolean): void {
  lastEnabled = enabled;
  ensureTransparencyListener();
  applyNative(enabled);
}
