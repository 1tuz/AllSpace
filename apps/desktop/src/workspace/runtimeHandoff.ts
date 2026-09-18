/** Workspace → classic IDE handoff for a concrete workload. */

import type { DevOpsRuntimeScope } from "@srelens/core";

export const RUNTIME_HANDOFF_KEY = "srelens.workspace.runtimeHandoff";

export type RuntimeHandoff = {
  context: string;
  kind: string;
  namespace: string;
  name: string;
  /** DevOps contour profile when Delivery → Explore knows one. */
  profileId?: string;
  pod?: string;
  container?: string;
};

/** Stable key for applying a handoff once (Explorer dock / focus nonce). */
export function runtimeHandoffKey(target: RuntimeHandoff): string {
  return [
    target.context,
    target.kind,
    target.namespace,
    target.name,
    target.profileId ?? "",
    target.pod ?? "",
    target.container ?? "",
  ].join("\0");
}

/**
 * Prefer an explicit Explorer/UI scope; else first node `cluster` (+ `namespace`).
 * Live `devops.traceDelivery` only fans out to kube when kubeContext is set.
 */
export function resolveRuntimeScope(
  explicit: DevOpsRuntimeScope | null | undefined,
  nodes?: ReadonlyArray<{ attributes: Record<string, string> }>,
): DevOpsRuntimeScope | undefined {
  const fromExplicit = explicit?.kubeContext?.trim();
  if (fromExplicit) {
    const namespaces = (explicit?.namespaces ?? [])
      .map((ns) => ns.trim())
      .filter(Boolean);
    return {
      kubeContext: fromExplicit,
      ...(namespaces.length ? { namespaces } : {}),
    };
  }
  if (!nodes) return undefined;
  for (const node of nodes) {
    const kubeContext = node.attributes.cluster?.trim();
    if (!kubeContext) continue;
    const ns = node.attributes.namespace?.trim();
    return {
      kubeContext,
      ...(ns ? { namespaces: [ns] } : {}),
    };
  }
  return undefined;
}

export function runtimeScopeFromHandoff(target: RuntimeHandoff): DevOpsRuntimeScope {
  const ns = target.namespace.trim();
  return {
    kubeContext: target.context,
    ...(ns ? { namespaces: [ns] } : {}),
  };
}

function optionalTrim(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

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
      const profileId = optionalTrim(parsed.profileId);
      const pod = optionalTrim(parsed.pod);
      const container = optionalTrim(parsed.container);
      return {
        context: parsed.context,
        kind: parsed.kind,
        namespace: parsed.namespace,
        name: parsed.name,
        ...(profileId ? { profileId } : {}),
        ...(pod ? { pod } : {}),
        ...(container ? { container } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Map runtime attributes onto a classic resource focus. */
export function runtimeHandoffFromAttrs(
  attributes: Record<string, string>,
  fallbackKind = "deployments",
  profileId?: string,
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
  const resolvedProfile = optionalTrim(profileId) ?? optionalTrim(attributes.profileId);
  const pod = optionalTrim(attributes.pod);
  const container = optionalTrim(attributes.container);
  return {
    context,
    kind: kindSlug,
    namespace,
    name,
    ...(resolvedProfile ? { profileId: resolvedProfile } : {}),
    ...(pod ? { pod } : {}),
    ...(container ? { container } : {}),
  };
}
