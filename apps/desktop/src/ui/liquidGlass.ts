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

/**
 * Best-effort sync of the CSS `liquidGlass` preference to the native window
 * effect. Never throws — theme apply must not break if the command is missing
 * or the platform rejects effects.
 */
export function syncNativeLiquidGlass(enabled: boolean): void {
  if (!isTauri()) return;
  void invokeCommand("set_liquid_glass", { enabled }).catch((error) => {
    console.warn("set_liquid_glass failed:", error);
  });
}
