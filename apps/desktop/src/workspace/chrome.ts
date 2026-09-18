import { drawsOwnChrome } from "../design";
import { isTauri } from "@srelens/core/platform";

/**
 * Dress the workspace window for a dense macOS shell.
 * Overlay titlebar + drag region in the rail; never blocks boot.
 * Classic surface callers should call `resetWorkspaceChrome`.
 */
export async function applyWorkspaceChrome(): Promise<"overlay" | "system"> {
  if (!isTauri() || !drawsOwnChrome()) return "system";
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.setTitle("");
    await win.setTitleBarStyle("overlay");
    return "overlay";
  } catch {
    return "system";
  }
}

/** Hand system chrome back when leaving workspace for classic IDE. */
export async function resetWorkspaceChrome(): Promise<void> {
  if (!isTauri() || !drawsOwnChrome()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.setTitle("srelens");
    await win.setTitleBarStyle("visible");
  } catch {
    /* ignore */
  }
}
