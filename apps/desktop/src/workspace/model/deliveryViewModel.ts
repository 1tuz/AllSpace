import type { DevOpsTrace, DevOpsTraceEdge, DevOpsTraceNode } from "@srelens/core";
import type { Delivery, DeliverySituation, DeliveryVerdict, TraceEdge, TraceNode } from "./deliveryTypes";

export type DataOrigin = "live";

/** UI-facing delivery mapped from `DevOpsTrace`. */
export interface DeliveryViewModel extends Delivery {
  origin: DataOrigin;
}

function stageForKind(kind: string): TraceNode["stage"] {
  const normalized = kind.toLowerCase();
  if (normalized === "issue" || normalized === "project") return "work";
  if (normalized === "pullrequest" || normalized === "mergerequest" || normalized === "commit") {
    return "change";
  }
  if (normalized === "build" || normalized === "pipeline") return "build";
  if (normalized === "artifact") return "artifact";
  if (normalized === "deployment") return "deployment";
  if (normalized === "workload") return "runtime";
  return "work";
}

function stringifyAttrs(attributes: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

function mapNodes(nodes: DevOpsTraceNode[]): TraceNode[] {
  return nodes.map((node) => ({
    id: node.id,
    stage: stageForKind(node.kind),
    kind: node.kind,
    source: node.source,
    title: node.title,
    status: String(node.attributes.status ?? ""),
    timestamp: "",
    url: node.url,
    attributes: stringifyAttrs(node.attributes),
  }));
}

function mapEdges(edges: DevOpsTraceEdge[]): TraceEdge[] {
  return edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    relation: edge.relation,
    confidence: edge.confidence,
    evidence: edge.evidence,
  }));
}

/** Map backend level strings onto the UI vocabulary. */
function mapSituationLevel(level: string): DeliverySituation["level"] {
  if (level === "loud" || level === "notable" || level === "calm") return level;
  if (level === "healthy") return "calm";
  return "notable";
}

function mapVerdict(live: DevOpsTrace): DeliveryVerdict | undefined {
  if (!live.verdict) return undefined;
  return {
    summary: live.verdict.summary,
    severity: mapSituationLevel(live.verdict.severity),
    primaryAction: live.verdict.primaryAction,
    ageSeconds: live.verdict.ageSeconds,
  };
}

/**
 * Map a live backend Trace into a DeliveryViewModel shell.
 * Empty provider answers stay empty.
 */
export function liveTraceToViewModel(
  shell: Pick<Delivery, "id" | "workId" | "title" | "contour" | "service" | "stage" | "stageLabel" | "updated">,
  live: DevOpsTrace,
): DeliveryViewModel {
  return {
    ...shell,
    origin: "live",
    title: live.nodes[0]?.title ?? shell.title,
    partial: live.partial,
    sourceErrors: live.sourceErrors,
    situations: live.situations.map((situation) => ({
      level: mapSituationLevel(situation.level),
      label: situation.label,
      primaryAction: situation.primaryAction,
    })),
    verdict: mapVerdict(live),
    nodes: mapNodes(live.nodes),
    edges: mapEdges(live.edges),
  };
}
