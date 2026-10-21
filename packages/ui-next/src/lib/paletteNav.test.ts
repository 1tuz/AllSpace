import { beforeEach, describe, it, expect, vi } from "vitest";
import type { CrdRef } from "@srelens/core";
import { goToCommands, navKindSlugs } from "./paletteNav";

const CERT: CrdRef = {
  name: "certificates.cert-manager.io",
  group: "cert-manager.io",
  version: "v1",
  kind: "Certificate",
  plural: "certificates",
  namespaced: true,
};

describe("goToCommands", () => {
  const openTab = vi.fn();
  const onOpenRecent = vi.fn();
  const deps = { context: "prod-eu", openTab, onOpenRecent };

  beforeEach(() => {
    openTab.mockReset();
    onOpenRecent.mockReset();
  });

  it("exposes the sidebar's kind slugs", () => {
    expect(navKindSlugs()).toContain("pods");
    expect(navKindSlugs()).toContain("nodes");
    expect(navKindSlugs()).not.toContain("overview");
  });

  it("on empty query offers the first six built-in Go to kinds, not CRDs", () => {
    const cmds = goToCommands([CERT], "", deps);
    expect(cmds).toHaveLength(6);
    expect(cmds.every((c) => c.group === "Go" && c.label.startsWith("Go to "))).toBe(true);
    expect(cmds.some((c) => /CRD/.test(c.label))).toBe(false);
  });

  it("filters kinds and CRDs by label substring when the query is non-empty", () => {
    const cmds = goToCommands([CERT], "cert", deps);
    expect(cmds.map((c) => c.label)).toContain("Go to Certificate (CRD)");
    cmds.find((c) => c.label.includes("Certificate"))?.run();
    expect(onOpenRecent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "crd", crd: CERT }),
    );
    expect(openTab).toHaveBeenCalledWith("/k/certificates.cert-manager.io", {
      clusterName: "prod-eu",
    });
  });

  it("opens a kind route pinned to the palette context", () => {
    const cmds = goToCommands([], "pods", deps);
    const pods = cmds.find((c) => c.label === "Go to Pods");
    expect(pods).toBeTruthy();
    pods?.run();
    expect(openTab).toHaveBeenCalledWith("/k/pods", { clusterName: "prod-eu" });
  });
});
