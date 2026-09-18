import { describe, expect, it } from "vitest";
import {
  CONTOUR_PRESETS,
  contourById,
  contourKubeconfigPaths,
  contourPresetForProfile,
} from "./contours";

describe("contourKubeconfigPaths", () => {
  it("builds absolute paths from the Komus kubeconfig dir + hints (not AppFarm)", () => {
    const komus = contourById("komus");
    expect(komus).toBeDefined();
    const paths = contourKubeconfigPaths(komus!);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path.includes("/komus/kubeconfigs/"))).toBe(true);
    expect(paths.some((path) => path.endsWith("/dev.yaml"))).toBe(true);
    expect(paths.every((path) => !path.includes("/AppFarm/"))).toBe(true);
  });

  it("maps a komus profile to the Komus preset, not AppFarm", () => {
    expect(contourPresetForProfile({ id: "komus", label: "Komus" })?.id).toBe("komus");
    expect(contourPresetForProfile({ id: "appfarm", label: "AppFarm" })?.id).toBe("appfarm");
    expect(CONTOUR_PRESETS.map((c) => c.id).sort()).toEqual(["appfarm", "komus"]);
  });
});
