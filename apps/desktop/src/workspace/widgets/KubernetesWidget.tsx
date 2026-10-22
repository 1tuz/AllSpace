import { listContexts, type ClusterContext } from "@srelens/core";
import { useWidgetQuery } from "./useWidgetQuery";
import { WidgetMetric, WidgetMetrics, WidgetState } from "./WidgetParts";
import type { WidgetSourceProps } from "./types";
import { contourKubeconfigPaths, contourPresetForProfile } from "../contours";

/**
 * Kubernetes widget: the contexts this profile's kubeconfigs declare. No
 * cluster is contacted here — listing contexts is a local file read, so a
 * compact widget costs nothing. Depth (namespaces, pods, logs, YAML, shell,
 * port-forward, Helm) opens in the explorer with this context pinned.
 */
export function KubernetesWidget({
  profile,
  profileId,
  onOpenExplorer,
  variant = "compact",
}: WidgetSourceProps & { onOpenExplorer: (context?: string) => void }) {
  const contour = contourPresetForProfile(profile);
  const paths = contour ? contourKubeconfigPaths(contour) : [];
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

  const current = contexts.find((context) => context.isCurrent) ?? null;
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
            onOpen={() => onOpenExplorer(context.name)}
            verbose={variant === "detail"}
          />
        ))}
        {variant === "detail" ? (
          <button type="button" className="widget-action" onClick={() => onOpenExplorer()}>
            Open Kubernetes explorer
          </button>
        ) : null}
      </div>
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
