import { describe, it, expect, vi } from "vitest";
import type { RecentItem } from "@srelens/core";
import {
  k8sKindForRecent,
  listViewSlug,
  recentCommands,
  recentItemFromResource,
  slugForKind,
} from "./paletteRecents";

describe("kind normalize", () => {
  it("stores slug from a K8s label and maps slug back on read", () => {
    expect(slugForKind("Pod")).toBe("pods");
    expect(slugForKind("pods")).toBe("pods");
    expect(k8sKindForRecent("pods")).toBe("Pod");
    expect(k8sKindForRecent("Pod")).toBe("Pod");
  });

  it("builds a resource recent with slug kind for shared storage", () => {
    expect(recentItemFromResource({ kind: "Deployment", namespace: "ns", name: "api" })).toEqual({
      type: "resource",
      kind: "deployments",
      namespace: "ns",
      name: "api",
      label: "ns/api",
    });
  });
});

describe("listViewSlug", () => {
  it("reads a built-in list route, not a detail route", () => {
    expect(listViewSlug("/k/pods")).toBe("pods");
    expect(listViewSlug("/events")).toBe("events");
    expect(listViewSlug("/k/Pod/checkout/api-0")).toBeNull();
    expect(listViewSlug("/settings")).toBeNull();
  });
});

describe("recentCommands", () => {
  const openTab = vi.fn();
  const onPickResource = vi.fn();
  const onOpenRecent = vi.fn();
  const deps = {
    context: "prod-eu",
    route: "/k/pods",
    openTab,
    onPickResource,
    onOpenRecent,
  };

  const recents: RecentItem[] = [
    { type: "resource", kind: "pods", namespace: "ns", name: "a", label: "ns/a" },
    { type: "view", kind: "deployments", label: "Deployments" },
    { type: "resource", kind: "services", namespace: "ns", name: "svc", label: "ns/svc" },
  ];

  it("returns nothing once the reader has typed past /", () => {
    expect(recentCommands(recents, "pod", deps)).toEqual([]);
  });

  it("puts matching list-kind resources under Quick, the rest under Recent", () => {
    const cmds = recentCommands(recents, "", deps);
    expect(cmds.filter((c) => c.group === "Quick").map((c) => c.label)).toEqual(["ns/a"]);
    expect(cmds.filter((c) => c.group === "Recent").map((c) => c.label)).toEqual([
      "Deployments",
      "ns/svc",
    ]);
  });

  it("opens a resource recent via onPickResource with K8s kind", () => {
    const cmds = recentCommands(recents, "", deps);
    cmds.find((c) => c.label === "ns/a")?.run();
    expect(onPickResource).toHaveBeenCalledWith({ kind: "Pod", namespace: "ns", name: "a" });
  });

  it("opens a view recent through openTab with the pinned cluster", () => {
    const cmds = recentCommands(recents, "", { ...deps, route: "/settings" });
    cmds.find((c) => c.label === "Deployments")?.run();
    expect(openTab).toHaveBeenCalledWith("/k/deployments", { clusterName: "prod-eu" });
  });
});
