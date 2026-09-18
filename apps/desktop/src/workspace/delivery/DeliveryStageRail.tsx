import { ExternalLink } from "lucide-react";
import type { TraceEdge, TraceNode } from "../model/deliveryTypes";
import { ConfidenceBadge } from "./ConfidenceBadge";

const STAGE_ORDER: TraceNode["stage"][] = ["work", "change", "build", "artifact", "deployment", "runtime"];

export function stageHeading(stage: TraceNode["stage"]): string {
  return stage.toUpperCase();
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "jira":
      return "Jira";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    case "jenkins":
      return "Jenkins";
    case "kubernetes":
      return "Kubernetes";
    case "workspace":
      return "Workspace";
    default:
      return source;
  }
}

/**
 * Linear stage rail — delivery chain narrative only.
 * Primary actions live on the selected-unit detail pane.
 */
export function DeliveryStageRail({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: TraceNode[];
  edges: TraceEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ordered = [...nodes].sort(
    (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage),
  );

  return (
    <ol className="flex flex-col" data-testid="stage-rail" role="listbox" aria-label="Delivery chain">
      {ordered.map((node, index) => {
        const incoming = edges.find((e) => e.to === node.id);
        const selected = selectedId === node.id;
        return (
          <li key={node.id} className="relative">
            {index > 0 && (
              <div className="absolute left-[1.15rem] top-0 h-3 w-px bg-border" aria-hidden="true" />
            )}
            {index > 0 && incoming && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-1 text-[10px] text-muted-foreground">
                <span className="workspace-shell__mono">{incoming.relation}</span>
                <ConfidenceBadge confidence={incoming.confidence} />
              </div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(node.id)}
              className={`workspace-dense-row flex w-full flex-col gap-0.5 border-l-2 text-left transition-colors ${
                selected
                  ? "border-l-primary bg-accent/40"
                  : "border-l-transparent hover:bg-muted/40"
              }`}
            >
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {stageHeading(node.stage)} · {sourceLabel(node.source)}
              </p>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium leading-snug">{node.title}</p>
                {node.url && (
                  <a
                    className="workspace-shell__no-drag text-muted-foreground"
                    href={node.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${node.title}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {node.status}
                {node.timestamp ? ` · ${node.timestamp}` : ""}
              </p>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
