/**
 * Recents for the Console `/` palette — thin adapter over `@srelens/core`
 * `getRecents` / `pushRecent` / `RecentItem`, not a second store.
 *
 * **Kind spelling (shared `srelens.recents` with classic):** classic writes
 * ResourceKind slug (`pods`); next's resource index uses the K8s label
 * (`Pod`). We **store slug on write** so classic and next share one list, and
 * **normalize slug → K8s label on read** when opening a resource (openResource /
 * resourceTarget). Views keep the slug (`kind:pods` → `/k/pods`).
 */
import {
  K8S_KIND,
  RESOURCE_LABELS,
  recentId,
  type CrdRef,
  type RecentItem,
  type ResourceKind,
} from "@srelens/core";
import type { Command } from "./agentCommands";
import type { PaletteResource } from "./resourcePalette";
import { routeForNode } from "./tree";

/** Prefer slug for storage — reverse of {@link k8sKindForRecent}. */
export function slugForKind(kind: string): ResourceKind | string {
  if (Object.prototype.hasOwnProperty.call(K8S_KIND, kind)) return kind;
  const hit = (Object.entries(K8S_KIND) as [ResourceKind, string][]).find(([, label]) => label === kind);
  return hit?.[0] ?? kind;
}

/** Map a stored recent kind to the K8s label next's detail routes expect. */
export function k8sKindForRecent(kind: string): string {
  const label = K8S_KIND[kind as ResourceKind];
  return label || kind;
}

/**
 * List-view slug for Quick ranking — `/k/pods` → `pods`, `/events` → `events`.
 * Detail routes (`/k/Pod/ns/name`) and CRD lists return null.
 */
export function listViewSlug(route: string): ResourceKind | null {
  if (route === "/events") return "events";
  const m = /^\/k\/([^/]+)$/.exec(route);
  if (!m) return null;
  const seg = m[1];
  return Object.prototype.hasOwnProperty.call(K8S_KIND, seg) && K8S_KIND[seg as ResourceKind] !== ""
    ? (seg as ResourceKind)
    : null;
}

export function recentItemFromResource(r: PaletteResource): RecentItem {
  const slug = slugForKind(r.kind);
  return {
    type: "resource",
    kind: String(slug),
    namespace: r.namespace,
    name: r.name,
    label: r.namespace ? `${r.namespace}/${r.name}` : r.name,
  };
}

export function recentItemFromView(slug: ResourceKind): RecentItem {
  return { type: "view", kind: slug, label: RESOURCE_LABELS[slug] };
}

export function recentItemFromCrd(crd: CrdRef): RecentItem {
  return { type: "crd", crd, label: `${crd.kind} (CRD)` };
}

export interface RecentCommandDeps {
  context: string;
  /** Active tab route — drives optional Quick group when empty query. */
  route: string;
  openTab: (route: string, opts?: { clusterName?: string }) => void;
  /** Drill into a resource the same way a Resource search hit does. */
  onPickResource: (r: PaletteResource) => void;
  /** Record the pick (Console → `pushRecent`) before navigate / drill. */
  onOpenRecent: (item: RecentItem) => void;
}

/**
 * Quick + Recent commands for an empty `/` query. Non-empty query → [].
 * Quick = resource recents whose stored kind matches the current list slug.
 */
export function recentCommands(
  recents: readonly RecentItem[],
  query: string,
  deps: RecentCommandDeps,
): Command[] {
  if (query.trim() !== "") return [];

  const listSlug = listViewSlug(deps.route);
  const quick =
    listSlug == null
      ? []
      : recents.filter((r) => r.type === "resource" && r.kind === listSlug);
  const quickIds = new Set(quick.map(recentId));
  const other = quick.length === 0 ? recents : recents.filter((r) => !quickIds.has(recentId(r)));

  return [
    ...quick.map((r) => toCommand(r, "Quick", deps)),
    ...other.map((r) => toCommand(r, "Recent", deps)),
  ];
}

function toCommand(item: RecentItem, group: "Quick" | "Recent", deps: RecentCommandDeps): Command {
  const id = `${group === "Quick" ? "quick" : "recent"}:${recentId(item)}`;
  if (item.type === "resource") {
    return {
      id,
      group,
      label: item.label,
      hint: k8sKindForRecent(item.kind),
      run: () =>
        deps.onPickResource({
          kind: k8sKindForRecent(item.kind),
          namespace: item.namespace,
          name: item.name,
        }),
    };
  }
  if (item.type === "view") {
    return {
      id,
      group,
      label: item.label,
      hint: "view",
      run: () => {
        deps.onOpenRecent(item);
        const next = routeForNode(`kind:${item.kind}`, []);
        if (next) deps.openTab(next, { clusterName: deps.context });
      },
    };
  }
  return {
    id,
    group,
    label: item.label,
    hint: "CRD",
    run: () => {
      deps.onOpenRecent(item);
      const next = routeForNode(`crd:${item.crd.name}`, [item.crd]);
      if (next) deps.openTab(next, { clusterName: deps.context });
    },
  };
}
