import { describe, expect, it, vi } from "vitest";

vi.mock("@srelens/core/platform", () => ({
  isTauri: () => false,
  isWeb: () => true,
}));

vi.mock("../design", () => ({
  drawsOwnChrome: () => true,
}));

import { applyWorkspaceChrome, resetWorkspaceChrome } from "./chrome";

describe("workspace chrome", () => {
  it("stays on system chrome when not running under Tauri", async () => {
    await expect(applyWorkspaceChrome()).resolves.toBe("system");
    await expect(resetWorkspaceChrome()).resolves.toBeUndefined();
  });
});
