/**
 * The `/` command palette the console dock turns into when the reader's query
 * starts with a slash — pure over injected deps, like `agentSuggestions.ts`
 * beside it: no React, no store, no I/O, so the palette's *contents* can be
 * reasoned about without mounting the dock at all.
 *
 * **`Go` is resource-scoped, not the route table.** The dock mock reads
 * `Follow logs · checkout-api`, `Open shell in checkout-api`,
 * `Port forward checkout-api` — navigations about the resource the active
 * route names, the same subject `Action` uses, not a way to jump to an
 * app-scoped screen by name. `Action` and `Go` are therefore both absent on a
 * route with no resource (`parseDetailRoute` returns `null`): a command that
 * cannot say what it would act on is not a command, and a missing group is
 * absent, never an empty heading — which falls out for free here, since a
 * group with no `Command` in the flat list below renders no heading at all.
 *
 * **`shell` and `forward` carry the resource into the destination dialog.**
 * Neither has a route of its own (a session menu and a forward dialog, not a
 * URL), so identity travels through `lib/resourceHandoff`: the opener offers
 * `{context, namespace, pod|kind+name}`, then `openTab`s `/terminals` or
 * `/forwards`; that screen takes the intent once and opens `NewSessionMenu`
 * or `NewForwardDialog` already pointed at it. Labels below therefore name
 * the resource again — the navigation keeps that half of the mock's promise.
 *
 * **Action carries the verb into the detail's Pending confirm.** `openAction`
 * offers `{context, kind, namespace, name, action}` through the same handoff
 * module, then opens the resource's detail tab. `useRowMenu` (via
 * DetailActions) takes the intent once and opens the row menu's own confirm —
 * exactly one, never a second dialog over the dock, and never
 * `PALETTE_ACTIONS.run` / a core mutate from Console. Labels below name the
 * act because that confirm opens on landing. `trigger` is the exception: the
 * row menu's Run now has no Pending, so its label still names the navigation.
 *
 * **What is still open.** The handoff prefills; it does not start. A shell
 * still needs Start (and a container pick when the pod has more than one) —
 * unlike `ResourceMenu`'s `Open shell`, which starts the session itself. A
 * forward from `/` has no remote port (the palette never saw one), so the
 * dialog still asks — same as the row menu's door. Auto-start and port
 * discovery would be a later slice.
 *
 * **No Roll back.** Core has no rollout-undo capability for a Deployment's
 * revision history — `rolloutRestart`, `scale`, `evict`, `deletePod`,
 * `cordonNode`, `drainNode` and Helm's own `helmRollback` exist, but nothing
 * walks a Deployment's revision history back. A command that refuses the
 * moment it is run is worse than a command that was never drawn, so this
 * module draws none.
 *
 * **A destructive command navigates with a handoff; it does not open a second
 * dialog over the dock.** `openAction` is the hand-off: Console offers the
 * intent, opens the detail tab, and ResourceMenu's Pending is the one confirm.
 * `deps.context` is read once, here, into each command's closure at BUILD
 * time — the same pin `useRowMenu`'s `Pending.context` takes and for the same
 * reason (`ResourceMenu.tsx`): the cluster rail can move between the
 * keystroke that built this list and the pick that runs one of its commands,
 * and the write must still reach the cluster the reader read this list on.
 */
import { K8S_KIND } from "@srelens/core";
import { parseDetailRoute } from "./detailRoute";
import { descriptorFor } from "./kinds/descriptors";
import type { ActionHandoffVerb } from "./resourceHandoff";

export type CommandGroup = "Quick" | "Recent" | "Action" | "Go" | "Cluster" | "Workspace" | "Resource";

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  hint: string;
  danger?: true;
  run: () => void;
}

export interface ResourceTarget {
  kind: string;
  namespace: string | null;
  name: string;
}

export interface CommandDeps {
  /** The active tab's route — what `Action` and `Go` are scoped to. */
  route: string;
  /**
   * When set (Console resource-palette drill), Action/Go use this resource
   * instead of `parseDetailRoute(route)` — find-then-act without leaving `/`.
   */
  resourceTarget?: ResourceTarget | null;
  /** The kubeconfig context in focus, pinned into every command built here. */
  context: string;
  clusters: readonly { id: string; name: string }[];
  workspaces: readonly { id: string; name: string }[];
  /**
   * Opens a route in a tab. Takes the same `clusterName` the real store
   * function does — `ResourceMenu.tsx`'s own Follow-logs / detail / edit
   * navigations always pass `{ clusterName: context }`, so a tab this module
   * opens must too, or it carries no cluster label (or a stale one after a
   * cluster switch) where every other navigation of the same actions does.
   */
  openTab: (route: string, opts?: { clusterName?: string }) => void;
  /**
   * Switches the active cluster. **Both arguments, always**: since the tab
   * strip's relabel fix, a caller that passes only `id` leaves the strip
   * showing the previous cluster's name over the new cluster's tabs.
   */
  setActiveCluster: (id: string, name: string) => void;
  switchWorkspace: (id: string) => void;
  onToggleTheme: () => void;
  /**
   * Opens the row menu's own confirm for a destructive action, with the
   * intent — never the capability — carried across. See the module doc for
   * why this replaces calling `rolloutRestart`/`scaleResource` here directly.
   */
  openAction: (a: {
    kind: string;
    namespace: string;
    name: string;
    context: string;
    action: ActionHandoffVerb;
  }) => void;
  /**
   * Opens `Follow logs` / `Open shell` / `Port forward` on a resource, with
   * the identity carried across — the same reason `openAction` exists rather
   * than a bare navigation. `shell` and `forward` have no route of their own;
   * Console offers them through `lib/resourceHandoff` so the destination
   * dialog opens already pointed at the resource.
   */
  openResource: (r: {
    kind: string;
    namespace: string;
    name: string;
    context: string;
    as: "logs" | "shell" | "forward" | "detail";
  }) => void;
  /**
   * Leaves resource-palette drill mode. Only set while a search hit is pinned
   * as `resourceTarget`; absent on the ordinary route-scoped palette.
   */
  leaveResource?: () => void;
}

/**
 * `k8sKind → slug`, the reverse of core's own `K8S_KIND`, so this module can
 * ask the list screen's own `KindDescriptor` which actions a kind offers —
 * the same question `detailData.tsx`'s `SLUG_BY_K8S_KIND` asks, built the
 * same way (from core's table, not hand-duplicated) for the same reason: a
 * kind added there must never go silently unresolvable here.
 */
const SLUG_BY_K8S_KIND: Record<string, string> = Object.fromEntries(
  Object.entries(K8S_KIND)
    .filter(([, k8sKind]) => k8sKind !== "")
    .map(([slug, k8sKind]) => [k8sKind, slug]),
);

/**
 * `Action` and `Go` — scoped to `resourceTarget` when drilling from a search
 * hit, otherwise to the one resource `deps.route` names. Absent when neither
 * names a resource.
 */
function resourceCommands(deps: CommandDeps): Command[] {
  const detail = deps.resourceTarget ?? parseDetailRoute(deps.route);
  if (!detail) return [];
  const { kind, namespace, name } = detail;
  const ns = namespace ?? "";
  const slug = SLUG_BY_K8S_KIND[kind];
  // A kind absent from `K8S_KIND` (a CRD) resolves no descriptor and offers
  // no `Action`/`Go` command here — the same refusal `KindActions` documents
  // for Delete on a custom resource: offering an action that cannot say what
  // it would run against is worse than not offering it.
  const actions = slug ? (descriptorFor(slug)?.actions ?? {}) : {};
  // Read once, into every command's closure below — see the module doc.
  const context = deps.context;

  const commands: Command[] = [];

  // Drill-only: the active route already IS the detail, so "Open …" would be
  // a no-op there. After a search hit, this is the non-destructive default.
  if (deps.resourceTarget) {
    commands.push({
      id: "details",
      group: "Go",
      label: `Open ${kind}/${name}`,
      hint: "detail",
      run: () => deps.openResource({ kind, namespace: ns, name, context, as: "detail" }),
    });
  }

  // Action verbs whose handoff opens ResourceMenu's Pending on the detail.
  // Labels name the act because that confirm lands with the tab. `danger` for
  // the same verbs the row menu marks danger — colour still means "this
  // opens a destructive confirm", not "this writes now".
  if (actions.restart) {
    commands.push({
      id: "restart",
      group: "Action",
      label: `Restart ${kind}/${name}`,
      hint: "confirm on the resource",
      danger: true,
      run: () => deps.openAction({ kind, namespace: ns, name, context, action: "restart" }),
    });
  }
  if (actions.scale) {
    commands.push({
      id: "scale",
      group: "Action",
      label: `Scale ${kind}/${name}`,
      hint: "confirm on the resource",
      danger: true,
      run: () => deps.openAction({ kind, namespace: ns, name, context, action: "scale" }),
    });
  }
  if (actions.evict) {
    commands.push({
      id: "evict",
      group: "Action",
      label: `Evict ${kind}/${name}`,
      hint: "confirm on the resource",
      danger: true,
      run: () => deps.openAction({ kind, namespace: ns, name, context, action: "evict" }),
    });
  }
  // Absent / true offers Delete — same default as `KindActions.delete`.
  if (actions.delete !== false) {
    commands.push({
      id: "delete",
      group: "Action",
      label: `Delete ${kind}/${name}`,
      hint: "confirm on the resource",
      danger: true,
      run: () => deps.openAction({ kind, namespace: ns, name, context, action: "delete" }),
    });
  }
  if (actions.suspend) {
    commands.push({
      id: "suspend",
      group: "Action",
      // Palette has no suspended bit; the confirm labels Suspend vs Resume from
      // the row once the detail takes the handoff.
      label: `Suspend / resume ${kind}/${name}`,
      hint: "confirm on the resource",
      run: () => deps.openAction({ kind, namespace: ns, name, context, action: "suspend" }),
    });
  }
  if (actions.trigger) {
    commands.push({
      id: "trigger",
      group: "Action",
      // Run now has no Pending on the row menu — this only opens the detail.
      label: `Open ${kind}/${name} to run it`,
      hint: "Run now lives on the resource",
      run: () => deps.openAction({ kind, namespace: ns, name, context, action: "trigger" }),
    });
  }

  // Every `Go` command hands the full resource identity to `openResource`
  // rather than opening a bare route: `Open shell` and `Port forward` have no
  // route of their own to carry the subject through (a session menu and a
  // dialog, not a route). Console maps them through `lib/resourceHandoff` so
  // the destination opens already pointed at the resource. `Follow logs`
  // goes through the same door for the same reason `openAction` is one door
  // rather than two: one hand-off, fully specified.
  if (actions.logs) {
    commands.push({
      id: "logs",
      group: "Go",
      label: `Follow logs · ${name}`,
      hint: "all containers",
      run: () => deps.openResource({ kind, namespace: ns, name, context, as: "logs" }),
    });
  }
  if (actions.shell) {
    commands.push({
      id: "shell",
      group: "Go",
      label: `Open shell in ${name}`,
      hint: "Terminals · pod preselected",
      run: () => deps.openResource({ kind, namespace: ns, name, context, as: "shell" }),
    });
  }
  if (actions.forward) {
    commands.push({
      id: "forward",
      group: "Go",
      label: `Port forward ${name}`,
      hint: "Forwards · target preselected",
      run: () => deps.openResource({ kind, namespace: ns, name, context, as: "forward" }),
    });
  }

  if (deps.resourceTarget && deps.leaveResource) {
    commands.push({
      id: "back",
      group: "Go",
      label: "← Back to search",
      hint: "clear drill",
      run: () => deps.leaveResource!(),
    });
  }

  return commands;
}

/** One `Switch to <cluster>` per cluster the strip knows about — never
 *  filtered to "not the current one": the palette lists what it can do, not
 *  what it thinks the reader wants. */
function clusterCommands(deps: CommandDeps): Command[] {
  return deps.clusters.map((c) => ({
    id: `cluster-${c.id}`,
    group: "Cluster" as const,
    label: `Switch to ${c.name}`,
    hint: c.id,
    // §F: "a Cluster command → /" — the reader lands on the control room
    // rather than a tab that may name nothing on the cluster just switched
    // to. `clusterName` is passed here too, not left to `setActiveCluster`'s
    // own relabel alone: that relabels tabs the workspace ALREADY has, and a
    // workspace with no "/" tab open yet would otherwise mint one with no
    // cluster label at all.
    run: () => {
      deps.setActiveCluster(c.id, c.name);
      deps.openTab("/", { clusterName: c.name });
    },
  }));
}

/**
 * `Switch to <workspace>` per workspace, plus `Toggle theme`.
 *
 * Theme has no group of its own among the design's four (`Action`, `Go`,
 * `Cluster`, `Workspace`) — it is a window-level preference, not scoped to a
 * cluster or a resource, so it sits here rather than inventing a fifth
 * `CommandGroup` member for one command.
 */
function workspaceCommands(deps: CommandDeps): Command[] {
  const switches: Command[] = deps.workspaces.map((w) => ({
    id: `workspace-${w.id}`,
    group: "Workspace",
    label: `Switch to ${w.name}`,
    hint: "workspace",
    run: () => deps.switchWorkspace(w.id),
  }));
  return [
    ...switches,
    {
      id: "theme",
      group: "Workspace",
      label: "Toggle theme",
      hint: "light / dark",
      run: () => deps.onToggleTheme(),
    },
  ];
}

export function commandsFor(deps: CommandDeps): readonly Command[] {
  return [...resourceCommands(deps), ...clusterCommands(deps), ...workspaceCommands(deps)];
}

/** Case-insensitive substring match on the label — nothing else, so a match
 *  the reader can see none of the reason for (a hidden id, a hint) can never
 *  come back. */
export function matchCommands(all: readonly Command[], query: string): readonly Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((c) => c.label.toLowerCase().includes(q));
}
