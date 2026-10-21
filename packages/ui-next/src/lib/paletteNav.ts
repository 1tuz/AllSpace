/**
 * Built-in + CRD "Go to …" entries for the Console `/` palette — kept out of
 * `resourcePalette.ts` so that module stays about resource name search.
 *
 * Routes go through {@link routeForNode} (`kind:<slug>` / `crd:<name>`) so a
 * CRD the loaded list no longer has cannot open a dead tab. Every `openTab`
 * pins `clusterName: context`.
 */
import { RESOURCE_LABELS, type CrdRef, type RecentItem, type ResourceKind } from "@srelens/core";
import type { Command } from "./agentCommands";
import { recentItemFromCrd, recentItemFromView } from "./paletteRecents";
import { NAV_GROUPS, routeForNode } from "./tree";

/** Flat NAV kind slugs (same set the sidebar's kind leaves use). */
export function navKindSlugs(): ResourceKind[] {
  return NAV_GROUPS.flatMap((g) => g.kinds);
}

export interface GoToCommandDeps {
  context: string;
  openTab: (route: string, opts?: { clusterName?: string }) => void;
  /** Record the navigation target in recents (Console → `pushRecent`). */
  onOpenRecent: (item: RecentItem) => void;
}

/**
 * `Go to <label>` for built-in kinds and discovered CRDs.
 * Empty query: first six kinds (classic). Typed query: filter label substring,
 * kinds + CRDs, capped at eight.
 */
export function goToCommands(crds: readonly CrdRef[], query: string, deps: GoToCommandDeps): Command[] {
  const q = query.trim().toLowerCase();
  const kinds = navKindSlugs().map((slug) => ({
    id: `goto:kind:${slug}`,
    label: RESOURCE_LABELS[slug],
    recent: recentItemFromView(slug),
    route: routeForNode(`kind:${slug}`, [...crds]),
  }));
  const crdNav = crds.map((c) => ({
    id: `goto:crd:${c.name}`,
    label: `${c.kind} (CRD)`,
    recent: recentItemFromCrd(c),
    route: routeForNode(`crd:${c.name}`, [...crds]),
  }));

  const picked = !q
    ? kinds.filter((n) => n.route).slice(0, 6)
    : [...kinds, ...crdNav]
        .filter((n) => n.route && n.label.toLowerCase().includes(q))
        .sort((a, b) => {
          const A = a.label.toLowerCase();
          const B = b.label.toLowerCase();
          const as = A.startsWith(q) ? 0 : 1;
          const bs = B.startsWith(q) ? 0 : 1;
          return as !== bs ? as - bs : A.localeCompare(B);
        })
        .slice(0, 8);

  return picked.map((n) => ({
    id: n.id,
    group: "Go" as const,
    label: `Go to ${n.label}`,
    hint: n.recent.type === "crd" ? "CRD" : "view",
    run: () => {
      deps.onOpenRecent(n.recent);
      if (n.route) deps.openTab(n.route, { clusterName: deps.context });
    },
  }));
}
