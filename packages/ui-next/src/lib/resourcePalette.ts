/**
 * Resource search for the Console `/` palette — the classic CommandPalette's
 * "find a resource, then act" half, without rebuilding Dock or a second modal.
 *
 * Pure over injected `list` / `onPick`, like `agentCommands.ts`: the palette's
 * *contents* can be asserted without mounting the dock. Indexing hits the
 * cluster once when `/` mode opens; filtering stays client-side.
 *
 * **Bare `/` lists no resources.** Dumping every Pod/Deployment on an empty
 * query would bury Cluster/Workspace under a wall. Type a name (or `pod
 * nginx`) to search — same narrowing classic's KIND_TOKENS give.
 *
 * **Drill, then KindActions.** Picking a hit is Console's job (`onPick`): it
 * pins the resource as `CommandDeps.resourceTarget` so Action/Go reuse the
 * same descriptor gates `agentCommands` already uses for the active route.
 * This module only finds; it does not invent a second action registry.
 */
import { K8S_KIND, listResource, type ResourceKind } from "@srelens/core";
import type { Command } from "./agentCommands";

/** One indexed resource — K8s kind label (`Deployment`), not the slug. */
export interface PaletteResource {
  kind: string;
  namespace: string | null;
  name: string;
}

/** Kinds indexed for name search when the palette opens — same set classic uses. */
const SEARCH_SLUGS: ResourceKind[] = [
  "pods",
  "deployments",
  "statefulsets",
  "daemonsets",
  "replicasets",
  "jobs",
  "cronjobs",
  "services",
  "ingresses",
  "configmaps",
  "secrets",
  "persistentvolumeclaims",
  "serviceaccounts",
  "nodes",
];

/**
 * Leading query token → K8s kind, so `pod nginx` / `svc web` narrow before
 * name-filtering. Keys: slug, singular label, kubectl short aliases.
 */
const KIND_TOKENS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const slug of SEARCH_SLUGS) {
    const label = K8S_KIND[slug];
    if (!label) continue;
    map[slug] = label;
    map[label.toLowerCase()] = label;
  }
  const aliases: Record<string, string> = {
    po: "Pod",
    deploy: "Deployment",
    deploys: "Deployment",
    sts: "StatefulSet",
    ds: "DaemonSet",
    rs: "ReplicaSet",
    cj: "CronJob",
    svc: "Service",
    ing: "Ingress",
    cm: "ConfigMap",
    pvc: "PersistentVolumeClaim",
    sa: "ServiceAccount",
    no: "Node",
  };
  Object.assign(map, aliases);
  return map;
})();

/** Rank startsWith matches before substring matches, then alphabetically. */
function rankBy(q: string, keyOf: (t: PaletteResource) => string) {
  return (a: PaletteResource, b: PaletteResource) => {
    const A = keyOf(a).toLowerCase();
    const B = keyOf(b).toLowerCase();
    const as = A.startsWith(q) ? 0 : 1;
    const bs = B.startsWith(q) ? 0 : 1;
    return as !== bs ? as - bs : A.localeCompare(B);
  };
}

/** List searchable kinds cluster-wide; a kind that errors contributes nothing. */
export async function loadResourceIndex(
  context: string,
  list: typeof listResource = listResource,
): Promise<PaletteResource[]> {
  const lists = await Promise.all(
    SEARCH_SLUGS.map(async (slug) => {
      const label = K8S_KIND[slug];
      if (!label) return [] as PaletteResource[];
      const out = await list(context, label, "");
      if (out.error || !out.items) return [];
      return out.items.map((r) => ({
        kind: label,
        namespace: r.namespace || null,
        name: r.name,
      }));
    }),
  );
  return lists.flat();
}

/** Client-side filter over a loaded index. Empty query → no hits. */
export function matchResources(items: readonly PaletteResource[], query: string): PaletteResource[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const [first, ...rest] = q.split(/\s+/);
  const kind = KIND_TOKENS[first];
  const nameQuery = kind ? rest.join(" ") : q;
  const scoped = kind ? items.filter((r) => r.kind === kind) : items;
  return scoped
    .filter((r) => r.name.toLowerCase().includes(nameQuery))
    .sort(rankBy(nameQuery, (r) => r.name))
    .slice(0, 50);
}

/** One `Resource` command per match — `onPick` is how Console enters drill mode. */
export function resourceHitCommands(
  items: readonly PaletteResource[],
  query: string,
  onPick: (r: PaletteResource) => void,
): Command[] {
  return matchResources(items, query).map((r) => {
    const ns = r.namespace ?? "";
    const where = r.namespace ? ` · ${r.namespace}` : "";
    return {
      id: `resource:${r.kind}:${ns}:${r.name}`,
      group: "Resource" as const,
      label: `${r.name} · ${r.kind}${where}`,
      hint: "actions",
      run: () => onPick(r),
    };
  });
}
