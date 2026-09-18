import type { DevOpsProfile } from "@srelens/core";
import { Button } from "../../ui";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { sourceLabel, stageHeading } from "./DeliveryStageRail";
import type { TraceEdge, TraceNode } from "../model/deliveryTypes";
import type { RuntimeHandoff } from "../runtimeHandoff";
import { runtimeHandoffFromAttrs } from "../runtimeHandoff";

/** Details derived exclusively from the selected trace unit. */
export function EvidenceInspector({ node, incoming, unitErrors = [], profile = null, profileId, onExploreRuntime }: {
  node: TraceNode | null;
  incoming: TraceEdge | null;
  unitErrors?: { source: string; message: string }[];
  profile?: Pick<DevOpsProfile, "id" | "label"> | null;
  profileId?: string;
  onExploreRuntime?: (target?: RuntimeHandoff) => void;
}) {
  if (!node) return <p className="px-4 py-5 text-sm text-muted-foreground">Select a unit in the delivery chain.</p>;

  const runtime = node.stage === "runtime" || node.stage === "deployment"
    ? runtimeHandoffFromAttrs(node.attributes, "deployments", profileId ?? profile?.id)
    : null;

  return (
    <section className="min-h-0 flex-1 overflow-auto" data-testid="evidence-inspector">
      <header className="border-b border-border px-4 py-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{stageHeading(node.stage)} · {sourceLabel(node.source)}</p>
        <h2 className="mt-1 text-sm font-semibold">{node.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{node.status || "No status returned"} · <span className="workspace-shell__mono">{node.kind}</span></p>
        {runtime && onExploreRuntime ? <div className="mt-3"><Button size="xs" onClick={() => onExploreRuntime(runtime)}>Explore in Kubernetes</Button></div> : null}
      </header>
      {unitErrors.length > 0 ? <div className="border-b border-border px-4 py-3" role="status">{unitErrors.map((error) => <p key={`${error.source}:${error.message}`} className="text-sm">{sourceLabel(error.source)}: {error.message}</p>)}</div> : null}
      {incoming ? <div className="border-b border-border px-4 py-3 text-sm"><p className="font-medium">Linked by {incoming.relation}</p><ConfidenceBadge confidence={incoming.confidence} />{incoming.evidence.map((item) => <p key={`${item.kind}:${item.detail}`} className="mt-1 text-muted-foreground">{item.kind}: {item.detail}</p>)}</div> : null}
      <dl className="divide-y divide-border" data-testid="unit-attributes">
        {Object.entries(node.attributes).length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No additional attributes returned.</p> : null}
        {Object.entries(node.attributes).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(8rem,1fr)_minmax(0,2fr)] gap-3 px-4 py-2 text-sm"><dt className="font-medium">{key}</dt><dd className="overflow-x-auto whitespace-nowrap text-muted-foreground">{value}</dd></div>)}
      </dl>
      {node.url ? <a className="m-4 inline-block text-sm underline" href={node.url} target="_blank" rel="noreferrer">Open in {sourceLabel(node.source)}</a> : null}
    </section>
  );
}
