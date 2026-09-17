/** Workspace → classic IDE handoff for a concrete workload. */

export const RUNTIME_HANDOFF_KEY = "srelens.workspace.runtimeHandoff";

export type RuntimeHandoff = {
  context: string;
  kind: string;
  namespace: string;
  name: string;
};

export function saveRuntimeHandoff(target: RuntimeHandoff): void {
  try {
    sessionStorage.setItem(RUNTIME_HANDOFF_KEY, JSON.stringify(target));
  } catch {
    /* privacy modes — Explore still opens classic without focus */
  }
}

/** Read-and-clear. Leaving it would reopen the same workload on every classic entry. */
export function takeRuntimeHandoff(): RuntimeHandoff | null {
  try {
    const raw = sessionStorage.getItem(RUNTIME_HANDOFF_KEY);
    sessionStorage.removeItem(RUNTIME_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RuntimeHandoff> | null;
    if (
      parsed &&
      typeof parsed.context === "string" &&
      typeof parsed.kind === "string" &&
      typeof parsed.namespace === "string" &&
      typeof parsed.name === "string" &&
      parsed.context &&
      parsed.kind &&
      parsed.name
    ) {
      return {
        context: parsed.context,
        kind: parsed.kind,
        namespace: parsed.namespace,
        name: parsed.name,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Map fixture/live runtime attributes onto a classic resource focus. */
export function runtimeHandoffFromAttrs(
  attributes: Record<string, string>,
  fallbackKind = "deployments",
): RuntimeHandoff | null {
  const context = attributes.cluster?.trim();
  const name = attributes.name?.trim();
  const namespace = attributes.namespace?.trim() ?? "";
  const kind = (attributes.kind?.trim() || fallbackKind).toLowerCase();
  if (!context || !name) return null;
  const kindSlug =
    kind === "deployment"
      ? "deployments"
      : kind === "statefulset"
        ? "statefulsets"
        : kind === "daemonset"
          ? "daemonsets"
          : kind === "pod"
            ? "pods"
            : kind.endsWith("s")
              ? kind
              : `${kind}s`;
  return { context, kind: kindSlug, namespace, name };
}
