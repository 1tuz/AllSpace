import { describe, it, expect, vi } from "vitest";
import { commandsFor, matchCommands, type CommandDeps } from "./agentCommands";

const base: Omit<CommandDeps, "route"> = {
  context: "prod-eu",
  clusters: [{ id: "id-stage", name: "stage-eu" }],
  workspaces: [{ id: "w2", name: "Platform" }],
  openTab: vi.fn(),
  setActiveCluster: vi.fn(),
  switchWorkspace: vi.fn(),
  onToggleTheme: vi.fn(),
  openAction: vi.fn(),
  openResource: vi.fn(),
};

describe("the / palette", () => {
  it("offers Action only where the route names a resource", () => {
    const onDetail = commandsFor({ ...base, route: "/k/Deployment/checkout/api" });
    expect(onDetail.some((c) => c.group === "Action")).toBe(true);
    const onSettings = commandsFor({ ...base, route: "/settings" });
    expect(onSettings.some((c) => c.group === "Action")).toBe(false);
  });

  it("offers Go only where the route names a resource", () => {
    // Ruling G: `Go` takes the same subject `Action` does — it is not built
    // from the route table, so it must vanish on a route with no resource
    // exactly as `Action` does, not merely "usually agree with it".
    const onDetail = commandsFor({ ...base, route: "/k/Deployment/checkout/api" });
    expect(onDetail.some((c) => c.group === "Go")).toBe(true);
    const onSettings = commandsFor({ ...base, route: "/settings" });
    expect(onSettings.some((c) => c.group === "Go")).toBe(false);
  });

  it("does not offer a rollback, because nothing behind it exists", () => {
    const all = commandsFor({ ...base, route: "/k/Deployment/checkout/api" });
    expect(all.some((c) => /roll ?back/i.test(c.label))).toBe(false);
  });

  it("gates Go commands by the kind's own KindActions, not by kind name alone", () => {
    // A Deployment offers logs but not shell or forward (`descriptors.ts`);
    // a Pod offers all three. A module that drew every Go command for any
    // resource would pass the "present on a resource route" test above while
    // still being wrong about which resource offers what.
    const onDeployment = commandsFor({ ...base, route: "/k/Deployment/checkout/api" });
    expect(onDeployment.some((c) => c.id === "logs")).toBe(true);
    expect(onDeployment.some((c) => c.id === "shell")).toBe(false);
    expect(onDeployment.some((c) => c.id === "forward")).toBe(false);

    const onPod = commandsFor({ ...base, route: "/k/Pod/checkout/api-0" });
    expect(onPod.some((c) => c.id === "shell")).toBe(true);
    expect(onPod.some((c) => c.id === "forward")).toBe(true);
  });

  it("gates Action commands by the kind's own KindActions too — a kind with neither offers none", () => {
    // Review finding: every prior Action assertion used the Deployment
    // fixture, which has BOTH `restart` and `scale` true — so dropping the
    // `actions.restart`/`actions.scale` gates entirely still passed every
    // test in this file. `ConfigMap` (`descriptors.ts`) sets neither, so this
    // is the fixture that actually exercises the gate — but Delete is still
    // offered (KindActions default), so Action is present; restart/scale/evict
    // are not.
    const onConfigMap = commandsFor({ ...base, route: "/k/ConfigMap/checkout/cm-1" });
    expect(onConfigMap.some((c) => c.id === "delete")).toBe(true);
    expect(onConfigMap.some((c) => c.id === "restart")).toBe(false);
    expect(onConfigMap.some((c) => c.id === "scale")).toBe(false);
    expect(onConfigMap.some((c) => c.id === "evict")).toBe(false);
    expect(onConfigMap.some((c) => c.id === "suspend")).toBe(false);
    expect(onConfigMap.some((c) => c.id === "trigger")).toBe(false);
  });

  it("offers delete / evict / suspend / trigger only where KindActions say so", () => {
    const onPod = commandsFor({ ...base, route: "/k/Pod/checkout/api-0" });
    expect(onPod.some((c) => c.id === "evict")).toBe(true);
    expect(onPod.some((c) => c.id === "delete")).toBe(true);
    expect(onPod.some((c) => c.id === "suspend")).toBe(false);
    expect(onPod.some((c) => c.id === "trigger")).toBe(false);

    const onCron = commandsFor({ ...base, route: "/k/CronJob/ops/nightly" });
    expect(onCron.some((c) => c.id === "suspend")).toBe(true);
    expect(onCron.some((c) => c.id === "trigger")).toBe(true);
    expect(onCron.some((c) => c.id === "evict")).toBe(false);
  });

  it("routes a destructive action through openAction, never straight to the capability", () => {
    const openAction = vi.fn();
    const all = commandsFor({ ...base, route: "/k/Deployment/checkout/api", openAction });
    all.find((c) => c.id === "restart")?.run();
    all.find((c) => c.id === "delete")?.run();
    expect(openAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "restart", name: "api", namespace: "checkout", context: "prod-eu" }),
    );
    expect(openAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "delete", name: "api", namespace: "checkout", context: "prod-eu" }),
    );
  });

  /**
   * Handoff opens ResourceMenu's Pending on landing, so labels name the act
   * (and `danger` matches the row menu). `trigger` is the exception: Run now
   * has no Pending, so its label still names the navigation.
   */
  it("labels Action commands as the act whose confirm opens on landing", () => {
    const all = commandsFor({ ...base, route: "/k/Deployment/checkout/api" });
    const restart = all.find((c) => c.id === "restart");
    const scale = all.find((c) => c.id === "scale");
    const del = all.find((c) => c.id === "delete");
    expect(restart?.label).toBe("Restart Deployment/api");
    expect(scale?.label).toBe("Scale Deployment/api");
    expect(del?.label).toBe("Delete Deployment/api");
    expect(restart?.danger).toBe(true);
    expect(scale?.danger).toBe(true);
    expect(del?.danger).toBe(true);
    expect(all.find((c) => c.id === "logs")?.danger).toBeUndefined();

    const onCron = commandsFor({ ...base, route: "/k/CronJob/ops/nightly" });
    expect(onCron.find((c) => c.id === "trigger")?.label).toBe("Open CronJob/nightly to run it");
    expect(onCron.find((c) => c.id === "trigger")?.danger).toBeUndefined();
    expect(onCron.find((c) => c.id === "suspend")?.label).toBe("Suspend / resume CronJob/nightly");
  });

  it("labels shell and forward with the resource now that handoff keeps the promise", () => {
    const all = commandsFor({ ...base, route: "/k/Pod/checkout/api-0" });
    expect(all.find((c) => c.id === "shell")?.label).toBe("Open shell in api-0");
    expect(all.find((c) => c.id === "forward")?.label).toBe("Port forward api-0");
  });

  it("routes Go commands through openResource with the resource's identity, never a bare openTab", () => {
    const openResource = vi.fn();
    const openTab = vi.fn();
    const all = commandsFor({ ...base, route: "/k/Pod/checkout/api-0", openResource, openTab });
    all.find((c) => c.id === "logs")?.run();
    all.find((c) => c.id === "shell")?.run();
    all.find((c) => c.id === "forward")?.run();
    expect(openResource).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "Pod", namespace: "checkout", name: "api-0", context: "prod-eu", as: "logs" }),
    );
    expect(openResource).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "Pod", namespace: "checkout", name: "api-0", context: "prod-eu", as: "shell" }),
    );
    expect(openResource).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "Pod", namespace: "checkout", name: "api-0", context: "prod-eu", as: "forward" }),
    );
    expect(openTab).not.toHaveBeenCalled();
  });

  it("pins the context at build time, not read live off some later call", () => {
    const openAction = vi.fn();
    const first = commandsFor({ ...base, route: "/k/Deployment/checkout/api", context: "prod-eu", openAction });
    // A second build with a different context must not change what the
    // FIRST list's command does when it finally runs.
    commandsFor({ ...base, route: "/k/Deployment/checkout/api", context: "staging", openAction });
    first.find((c) => c.id === "restart")?.run();
    expect(openAction).toHaveBeenCalledWith(expect.objectContaining({ context: "prod-eu" }));
  });

  it("still offers Cluster, Workspace and Toggle theme with no resource in view", () => {
    const onSettings = commandsFor({ ...base, route: "/settings" });
    expect(onSettings.some((c) => c.group === "Cluster")).toBe(true);
    expect(onSettings.some((c) => c.label === "Toggle theme")).toBe(true);
  });

  it("passes both id and name to a Cluster switch, so the strip relabels", () => {
    const setActiveCluster = vi.fn();
    const all = commandsFor({ ...base, route: "/settings", setActiveCluster });
    all.find((c) => c.group === "Cluster")?.run();
    expect(setActiveCluster).toHaveBeenCalledWith("id-stage", "stage-eu");
  });

  it("carries the cluster name into the Cluster switch's own openTab, not just setActiveCluster", () => {
    // A workspace with no "/" tab open yet mints one via `openTab` rather
    // than relabelling an existing one — that mint must carry the label too.
    const openTab = vi.fn();
    const all = commandsFor({ ...base, route: "/settings", openTab });
    all.find((c) => c.group === "Cluster")?.run();
    expect(openTab).toHaveBeenCalledWith("/", { clusterName: "stage-eu" });
  });

  it("switches workspace by id", () => {
    const switchWorkspace = vi.fn();
    const all = commandsFor({ ...base, route: "/settings", switchWorkspace });
    all.find((c) => c.group === "Workspace" && c.label !== "Toggle theme")?.run();
    expect(switchWorkspace).toHaveBeenCalledWith("w2");
  });

  it("toggles theme via the injected handler", () => {
    const onToggleTheme = vi.fn();
    const all = commandsFor({ ...base, route: "/settings", onToggleTheme });
    all.find((c) => c.label === "Toggle theme")?.run();
    expect(onToggleTheme).toHaveBeenCalled();
  });

  it("matches on the label, case-insensitively", () => {
    const all = commandsFor({ ...base, route: "/helm" });
    expect(matchCommands(all, "logs").every((c) => /logs/i.test(c.label))).toBe(true);
    const workspaceMatches = matchCommands(all, "PLATFORM");
    expect(workspaceMatches.some((c) => c.label === "Switch to Platform")).toBe(true);
  });

  it("returns every command for an empty query", () => {
    const all = commandsFor({ ...base, route: "/helm" });
    expect(matchCommands(all, "")).toEqual(all);
  });

  it("scopes Action/Go to resourceTarget even when the route names nothing", () => {
    const openResource = vi.fn();
    const all = commandsFor({
      ...base,
      route: "/settings",
      resourceTarget: { kind: "Pod", namespace: "checkout", name: "api-0" },
      openResource,
      leaveResource: vi.fn(),
    });
    expect(all.some((c) => c.id === "details")).toBe(true);
    expect(all.some((c) => c.id === "logs")).toBe(true);
    expect(all.some((c) => c.id === "back")).toBe(true);
    all.find((c) => c.id === "details")?.run();
    expect(openResource).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "Pod",
        namespace: "checkout",
        name: "api-0",
        as: "detail",
      }),
    );
  });

  it("prefers resourceTarget over the active route's resource", () => {
    const openResource = vi.fn();
    const all = commandsFor({
      ...base,
      route: "/k/Deployment/checkout/other",
      resourceTarget: { kind: "Pod", namespace: "checkout", name: "api-0" },
      openResource,
    });
    all.find((c) => c.id === "logs")?.run();
    expect(openResource).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "Pod", name: "api-0", as: "logs" }),
    );
  });

  it("does not offer Open details or Back on an ordinary route-scoped palette", () => {
    const all = commandsFor({ ...base, route: "/k/Pod/checkout/api-0" });
    expect(all.some((c) => c.id === "details")).toBe(false);
    expect(all.some((c) => c.id === "back")).toBe(false);
  });
});
