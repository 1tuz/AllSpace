import { useEffect, useState } from "react";
import type { DeliveryAnchor, DevOpsProfile, DevOpsRuntimeScope } from "@srelens/core";
import { useDeliveryTrace } from "../hooks/useDeliveryTrace";
import { pasteDeliveryShell } from "../parseDeliveryPaste";
import type { RuntimeHandoff } from "../runtimeHandoff";
import { DeliveryHeader, TraceBanner } from "../delivery/DeliveryHeader";
import { DeliveryStageRail, sourceLabel } from "../delivery/DeliveryStageRail";
import { EvidenceInspector } from "../delivery/EvidenceInspector";
import { WorkspaceSplitPanes } from "../components/WorkspaceSplitPanes";
import { Button } from "../../ui";

/**
 * Live kube fan-out (`TraceDeliveryIn.kubeContext`) needs an explicit scope.
 *
 * How UI supplies it (resolveRuntimeScope order):
 * 1. `runtimeScope` — last Explorer context (WorkspaceApp) or caller override
 * 2. First delivery node attribute `cluster` (+ optional `namespace`) from a
 *    prior live runtime unit
 *
 * Without either, CI-side of the chain still joins; Kubernetes workloads are
 * skipped. Reverse artifact/workload live seed still needs image-matched
 * `listDeploymentsByImage` results (builds with OCI refs + kubeContext) — there
 * is no get-deployment-by-name path in correlation yet.
 */
export function DeliveryTraceScreen({
  deliveryId,
  anchor,
  runtimeScope,
  profile = null,
  profileId,
  onBack,
  onExploreRuntime,
}: {
  deliveryId: string;
  anchor?: DeliveryAnchor;
  /** Known kube context from Explorer / prior handoff — see file comment. */
  runtimeScope?: DevOpsRuntimeScope | null;
  profile?: Pick<DevOpsProfile, "id" | "label"> | null;
  profileId?: string;
  onBack: () => void;
  onExploreRuntime: (target?: RuntimeHandoff) => void;
}) {
  const delivery = anchor ? pasteDeliveryShell(deliveryId, anchor) : undefined;
  const { view, loading, error } = useDeliveryTrace(delivery, anchor, {
    runtimeScope,
    profileId,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nodeIdsKey = view?.nodes.map((n) => n.id).join("\0") ?? "";

  // Keep selection across live refresh / tab switches; only reset when id gone.
  useEffect(() => {
    setSelectedId((prev) => {
      if (!view?.nodes.length) return null;
      if (prev && view.nodes.some((n) => n.id === prev)) return prev;
      return view.nodes[0]?.id ?? null;
    });
  }, [view?.id, view?.origin, nodeIdsKey, view?.nodes]);

  if (!delivery || !view) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
        <p className="text-sm text-muted-foreground">This delivery is not available.</p>
        <Button variant="ghost" onClick={onBack}>Back to Deliveries</Button>
      </main>
    );
  }

  const originLabel = loading ? "refreshing…" : "live";
  const selected = view.nodes.find((n) => n.id === selectedId) ?? null;
  const incoming = selected ? view.edges.find((e) => e.to === selected.id) ?? null : null;
  const unitErrors = selected
    ? view.sourceErrors.filter((err) => err.source === selected.source)
    : [];
  const chainErrors = selected
    ? view.sourceErrors.filter((err) => err.source !== selected.source)
    : view.sourceErrors;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="delivery-detail">
      <DeliveryHeader view={view} originLabel={originLabel} error={error} onBack={onBack} />

      <div className="flex min-h-0 flex-1 flex-col">
        {(view.partial || chainErrors.length > 0) && (
          <div className="space-y-2 border-b border-border px-4 py-3">
            {view.partial && (
              <TraceBanner>
                Partial delivery — some sources did not answer fully. Successful units stay below.
              </TraceBanner>
            )}
            {chainErrors.length > 0 && (
              <div className="divide-y divide-border border border-border" data-testid="source-errors">
                {chainErrors.map((err) => (
                  <p key={`${err.source}:${err.message}`} className="px-3 py-2 text-sm">
                    <span className="font-medium">{sourceLabel(err.source)}:</span> {err.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {view.nodes.length === 0 ? (
          <EmptyTrace origin={view.origin} hasSourceErrors={view.sourceErrors.length > 0} />
        ) : (
          <WorkspaceSplitPanes
            leftDefault="40"
            left={
              <DeliveryStageRail
                nodes={view.nodes}
                edges={view.edges}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            }
            right={
              <EvidenceInspector
                node={selected}
                incoming={incoming}
                unitErrors={unitErrors}
                profile={profile}
                profileId={profileId}
                onExploreRuntime={onExploreRuntime}
              />
            }
          />
        )}
      </div>
    </main>
  );
}

function EmptyTrace({
  origin,
  hasSourceErrors,
}: {
  origin: "live";
  hasSourceErrors: boolean;
}) {
  if (hasSourceErrors) {
    return (
      <p className="px-4 py-5 text-sm text-muted-foreground" data-testid="empty-live-trace">
        No units could be assembled. Source failures are listed above — this is not an empty success.
      </p>
    );
  }
  return (
    <p className="px-4 py-5 text-sm text-muted-foreground" data-testid="empty-live-trace">
      No units linked to this delivery yet.
    </p>
  );
}
