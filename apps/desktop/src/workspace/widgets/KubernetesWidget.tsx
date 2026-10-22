import { useState } from "react";
import {
  listContexts,
  listPods,
  podStatus,
  podStatusCounts,
  type ClusterContext,
  type PodSummary,
} from "@srelens/core";
import { useWidgetQuery } from "./useWidgetQuery";
import { WidgetMetric, WidgetMetrics, WidgetState } from "./WidgetParts";
import type { WidgetSourceProps } from "./types";
import type { RuntimeHandoff } from "../runtimeHandoff";
import { contourKubeconfigPaths, contourPresetForProfile } from "../contours";

/** Explorer surfaces a cluster row can reach without picking a resource first. */
const QUICK_KINDS: Array<{ kind: string; label: string }> = [
  { kind: "pods", label: "Pods" },
  { kind: "events", label: "Events" },
  { kind: "portforwards", label: "Port forwards" },
  { kind: "helmreleases", label: "Helm" },
];

/** Shared verdict vocabulary → the board's three row tones. */
function toneFor(health: ReturnType<typeof podStatus>["health"]): "calm" | "notable" | "loud" {
  if (health === "success") return "calm";
  return health === "danger" ? "loud" : "notable";
}

/**
 * Kubernetes widget: contexts come from this profile's kubeconfigs (a local file
 * read, no cluster contacted). Depth — pod health, then the workloads behind it —
 * loads only once the panel is open, because listing a cluster's pods is the
 * expensive part. Each row hands the explorer a concrete target, so logs, YAML,
 * shell, events, port-forward and Helm arrive with the same context and profile.
 */
export function KubernetesWidget({
  profile,
  profileId,
  onOpenExplorer,
  variant = "compact",
}: WidgetSourceProps & { onOpenExplorer: (target?: RuntimeHandoff) => void }) {
  const contour = contourPresetForProfile(profile);
  const paths = contour ? contourKubeconfigPaths(contour) : [];
  const [wantPods, setWantPods] = useState(false);
  const query = useWidgetQuery({
    key: `k8s.contexts.${contour?.id ?? "default"}`,
    profileId,
    enabled: true,
    load: () =>
      listContexts(paths, undefined, { replaceDefaults: Boolean(contour) }).then((outcome) => {
        if (outcome.error) throw new Error(outcome.error);
        return outcome.contexts ?? [];
      }),
  });

  if (query.loading) return <WidgetState kind="loading" text="Reading kubeconfig contexts…" />;
  if (query.error) {
    return <WidgetState kind="error" text={`Contexts could not be read: ${query.error}`} />;
  }

  const contexts = query.data ?? [];
  if (contexts.length === 0) {
    return (
      <WidgetState
        kind="unavailable"
        text={
          contour
            ? `No kubeconfig contexts found for ${contour.label}. Point this profile at its kubeconfig files.`
            : "No kubeconfig contexts found. Add a kubeconfig in Connections to see clusters here."
        }
      />
    );
  }

  const current = contexts.find((context) => context.isCurrent) ?? contexts[0] ?? null;
  const local = contexts.filter((context) => context.isLocal).length;

  return (
    <div className="widget-body" data-widget-variant={variant}>
      <WidgetMetrics>
        <WidgetMetric label="Contexts" value={contexts.length} />
        <WidgetMetric label="Current" value={current?.name ?? "none"} />
        <WidgetMetric label="Local" value={local} />
      </WidgetMetrics>
      <div className={variant === "detail" ? "widget-detail-rows" : "widget-compact-rows"}>
        {(variant === "detail" ? contexts : contexts.slice(0, 3)).map((context) => (
          <ClusterRow
            key={context.stableId}
            context={context}
            onOpen={() => onOpenExplorer({ context: context.name, kind: "pods", namespace: "", name: "" })}
            verbose={variant === "detail"}
          />
        ))}
        {variant === "detail" && current ? (
          <ClusterDepth
            context={current.name}
            profileId={profileId}
            wantPods={wantPods}
            onLoadPods={() => setWantPods(true)}
            onOpen={onOpenExplorer}
          />
        ) : null}
        {variant === "detail" ? (
          <button type="button" className="widget-action" onClick={() => onOpenExplorer()}>
            Open Kubernetes explorer
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Pod phase counts, and the pods behind the loud numbers, for one context. */
function ClusterDepth({
  context,
  profileId,
  wantPods,
  onLoadPods,
  onOpen,
}: {
  context: string;
  profileId: string;
  wantPods: boolean;
  onLoadPods: () => void;
  onOpen: (target?: RuntimeHandoff) => void;
}) {
  const counts = useWidgetQuery({
    key: `k8s.podCounts.${context}`,
    profileId,
    load: () =>
      podStatusCounts(context).then((outcome) => {
        if (outcome.error || !outcome.counts) throw new Error(outcome.error ?? "no counts");
        return outcome.counts;
      }),
  });
  const pods = useWidgetQuery({
    key: `k8s.pods.${context}`,
    profileId,
    enabled: wantPods,
    load: () =>
      listPods(context, "").then((outcome) => {
        if (outcome.error) throw new Error(outcome.error);
        return outcome.pods ?? [];
      }),
  });

  const trouble = (pods.data ?? [])
    .map((pod) => ({ pod, verdict: podStatus(pod) }))
    .filter((entry) => entry.verdict.flagged);

  return (
    <div className="widget-depth" data-testid="widget-kubernetes-depth">
      <p className="widget-depth__title">{context}</p>
      {counts.loading ? (
        <WidgetState kind="loading" text="Reading pod phases…" />
      ) : counts.error ? (
        <WidgetState kind="error" text={`Pod counts failed: ${counts.error}`} />
      ) : counts.data ? (
        <WidgetMetrics>
          <WidgetMetric label="Running" value={counts.data.running} />
          <WidgetMetric
            label="Pending"
            value={counts.data.pending}
            tone={counts.data.pending > 0 ? "notable" : "default"}
          />
          <WidgetMetric
            label="Failed"
            value={counts.data.failed}
            tone={counts.data.failed > 0 ? "loud" : "default"}
          />
        </WidgetMetrics>
      ) : null}
      <div className="widget-depth__actions">
        {QUICK_KINDS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            className="widget-action"
            onClick={() => onOpen({ context, kind, namespace: "", name: "" })}
          >
            {label}
          </button>
        ))}
      </div>
      {wantPods ? (
        pods.loading ? (
          <WidgetState kind="loading" text="Listing pods…" />
        ) : pods.error ? (
          <WidgetState kind="error" text={`Pods could not be listed: ${pods.error}`} />
        ) : trouble.length === 0 ? (
          <WidgetState kind="empty" text="No pod needs attention in this context." />
        ) : (
          <div className="widget-detail-rows">
            {trouble.slice(0, 8).map(({ pod, verdict }) => (
              <button
                key={`${pod.namespace}/${pod.name}`}
                type="button"
                className="widget-row"
                data-selectable="true"
                title={`Open logs for ${pod.namespace}/${pod.name}`}
                onClick={() =>
                  onOpen({
                    context,
                    kind: "pods",
                    namespace: pod.namespace,
                    name: pod.name,
                    pod: pod.name,
                  })
                }
              >
                <span className="widget-row__dot" data-tone={toneFor(verdict.health)} aria-hidden />
                <span className="widget-row__title">{pod.name}</span>
                <span className="widget-row__status" data-tone={toneFor(verdict.health)}>
                  {verdict.status}
                </span>
                <span className="widget-row__meta">
                  {[pod.namespace, pod.restarts > 0 ? `${pod.restarts} restarts` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            ))}
          </div>
        )
      ) : (
        <button type="button" className="widget-action" onClick={onLoadPods}>
          Load pods needing attention
        </button>
      )}
    </div>
  );
}

function ClusterRow({
  context,
  onOpen,
  verbose = false,
}: {
  context: ClusterContext;
  onOpen: () => void;
  verbose?: boolean;
}) {
  return (
    <button
      type="button"
      className="widget-row"
      data-selectable="true"
      data-current={context.isCurrent ? "true" : "false"}
      onClick={onOpen}
      title={`Open ${context.name} in the Kubernetes explorer`}
    >
      <span className="widget-row__dot" data-tone={context.isCurrent ? "calm" : "notable"} aria-hidden />
      <span className="widget-row__title">{context.name}</span>
      <span className="widget-row__meta">
        {[verbose ? context.cluster : null, verbose ? context.server : context.cluster]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </button>
  );
}
