import { useEffect, useState } from "react";
import {
  devopsTraceDelivery,
  type DeliveryAnchor,
  type DevOpsRuntimeScope,
  type DevOpsTrace,
} from "@srelens/core";
import type { Delivery } from "../model/deliveryTypes";
import { liveTraceToViewModel, type DeliveryViewModel } from "../model/deliveryViewModel";
import { resolveRuntimeScope } from "../runtimeHandoff";

export interface UseDeliveryTraceResult {
  view: DeliveryViewModel | undefined;
  loading: boolean;
  error: string | null;
}

export interface UseDeliveryTraceOptions {
  /** When true (default), Live mode may call devopsTraceDelivery. */
  enabled?: boolean;
  /**
   * Explicit kube fan-out scope (Explorer selection, prior handoff, caller).
   * Merged with cluster/namespace attributes on delivery.nodes when unset.
   * Without either, live reverse/runtime join skips Kubernetes — see gap note
   * on DeliveryTraceScreen.
   */
  runtimeScope?: DevOpsRuntimeScope | null;
  /** Cache partition / profile isolation for the live call. */
  profileId?: string;
}

/**
 * Only `devops.traceDelivery` supplies units; `enabled` gates fetches when
 * Trace/Evidence panels are hidden.
 */
export function useDeliveryTrace(
  delivery: Delivery | undefined,
  anchor?: DeliveryAnchor,
  options: boolean | UseDeliveryTraceOptions = true,
): UseDeliveryTraceResult {
  const opts: UseDeliveryTraceOptions =
    typeof options === "boolean" ? { enabled: options } : options;
  const enabled = opts.enabled ?? true;
  const [live, setLive] = useState<DevOpsTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resolvedAnchor: DeliveryAnchor | undefined =
    anchor ??
    (delivery
      ? delivery.contour === "Komus"
        ? { kind: "pullRequest", value: delivery.workId.replace(/^PR-/i, "") }
        : { kind: "issue", value: delivery.workId }
      : undefined);

  const scope = resolveRuntimeScope(opts.runtimeScope, delivery?.nodes);
  const scopeKey = scope
    ? `${scope.kubeContext}\u0000${(scope.namespaces ?? []).join("\u0001")}`
    : "";
  const profileId = opts.profileId?.trim() || undefined;

  useEffect(() => {
    if (!delivery || !resolvedAnchor) return;
    if (!enabled) {
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setError(null);
    devopsTraceDelivery(resolvedAnchor, scope, profileId ? { profileId } : undefined)
      .then((trace) => {
        if (!ac.signal.aborted) setLive(trace);
      })
      .catch((reason: unknown) => {
        if (!ac.signal.aborted) {
          setLive(null);
          setError(reason instanceof Error ? reason.message : "live trace failed");
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => {
      ac.abort();
    };
  }, [
    delivery?.id,
    resolvedAnchor?.kind,
    resolvedAnchor?.value,
    enabled,
    scopeKey,
    profileId,
  ]);

  if (!delivery) {
    return { view: undefined, loading, error };
  }

  if (live) {
    return {
      view: liveTraceToViewModel(delivery, live),
      loading,
      error,
    };
  }

  if (error) {
    return {
      view: liveTraceToViewModel(delivery, {
        nodes: [],
        edges: [],
        situations: [],
        partial: true,
        sourceErrors: [{ source: "workspace", message: error }],
      }),
      loading,
      error,
    };
  }

  // Loading or not yet fetched: show an empty live shell.
  return {
    view: {
      ...delivery,
      origin: "live",
      nodes: [],
      edges: [],
      situations: [],
      partial: false,
      sourceErrors: [],
    },
    loading,
    error,
  };
}
