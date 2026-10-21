import { describe, it, expect, vi } from "vitest";
import {
  loadResourceIndex,
  matchResources,
  resourceHitCommands,
  type PaletteResource,
} from "./resourcePalette";

const ITEMS: PaletteResource[] = [
  { kind: "Deployment", namespace: "checkout", name: "api" },
  { kind: "Deployment", namespace: "default", name: "nginx" },
  { kind: "Pod", namespace: "checkout", name: "api-0" },
  { kind: "Pod", namespace: "default", name: "nginx-abc" },
  { kind: "Service", namespace: "checkout", name: "api" },
  { kind: "Node", namespace: null, name: "node-1" },
];

describe("matchResources", () => {
  it("returns nothing for an empty query — bare / is not a resource dump", () => {
    expect(matchResources(ITEMS, "")).toEqual([]);
    expect(matchResources(ITEMS, "   ")).toEqual([]);
  });

  it("matches by name substring, case-insensitively", () => {
    const hits = matchResources(ITEMS, "API");
    expect(hits.map((h) => `${h.kind}/${h.namespace}/${h.name}`)).toEqual([
      "Deployment/checkout/api",
      "Service/checkout/api",
      "Pod/checkout/api-0",
    ]);
  });

  it("narrows by a leading kind token before the name", () => {
    const hits = matchResources(ITEMS, "pod nginx");
    expect(hits).toEqual([{ kind: "Pod", namespace: "default", name: "nginx-abc" }]);
  });

  it("accepts kubectl-style short aliases", () => {
    const hits = matchResources(ITEMS, "deploy api");
    expect(hits).toEqual([{ kind: "Deployment", namespace: "checkout", name: "api" }]);
  });

  it("ranks startsWith ahead of substring", () => {
    const hits = matchResources(
      [
        { kind: "Pod", namespace: "a", name: "x-api" },
        { kind: "Pod", namespace: "a", name: "api" },
      ],
      "api",
    );
    expect(hits.map((h) => h.name)).toEqual(["api", "x-api"]);
  });
});

describe("resourceHitCommands", () => {
  it("builds a Resource command per match that calls onPick", () => {
    const onPick = vi.fn();
    const cmds = resourceHitCommands(ITEMS, "nginx", onPick);
    expect(cmds.every((c) => c.group === "Resource")).toBe(true);
    expect(cmds.map((c) => c.label)).toEqual([
      "nginx · Deployment · default",
      "nginx-abc · Pod · default",
    ]);
    cmds[0]?.run();
    expect(onPick).toHaveBeenCalledWith({ kind: "Deployment", namespace: "default", name: "nginx" });
  });

  it("offers nothing when the query matches no resource", () => {
    expect(resourceHitCommands(ITEMS, "zzzz", vi.fn())).toEqual([]);
  });
});

describe("loadResourceIndex", () => {
  it("lists the searchable kinds and flattens name/namespace", async () => {
    const list = vi.fn(async (_ctx: string, kind: string) => {
      if (kind === "Pod") return { items: [{ name: "p1", namespace: "ns", age: "1d" }] };
      if (kind === "Deployment") return { items: [{ name: "d1", namespace: "ns", age: "2d" }] };
      return { items: [] };
    });
    const items = await loadResourceIndex("prod", list);
    expect(items).toContainEqual({ kind: "Pod", namespace: "ns", name: "p1" });
    expect(items).toContainEqual({ kind: "Deployment", namespace: "ns", name: "d1" });
    expect(list.mock.calls.every((c) => c[0] === "prod")).toBe(true);
    expect(list.mock.calls.some((c) => c[1] === "Pod")).toBe(true);
    expect(list.mock.calls.some((c) => c[1] === "Deployment")).toBe(true);
  });

  it("skips a kind that returned an error rather than inventing rows", async () => {
    const list = vi.fn(async (_ctx: string, kind: string) => {
      if (kind === "Pod") return { error: "forbidden" };
      if (kind === "Node") return { items: [{ name: "n1", namespace: "", age: "1d" }] };
      return { items: [] };
    });
    const items = await loadResourceIndex("prod", list);
    expect(items).toEqual([{ kind: "Node", namespace: null, name: "n1" }]);
  });
});
