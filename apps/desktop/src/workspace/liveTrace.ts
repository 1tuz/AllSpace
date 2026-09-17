import type { DevOpsTrace } from "@srelens/core";
import type { Delivery, TraceEdge, TraceNode } from "./fixtures";

function stageForKind(kind: string): TraceNode["stage"] {
  const normalized = kind.toLowerCase();
  if (normalized === "issue" || normalized === "project") return "work";
  if (normalized === "pullrequest" || normalized === "mergerequest" || normalized === "commit") {
    return "change";
  }
  if (normalized === "build" || normalized === "pipeline") return "build";
  if (normalized === "artifact") return "artifact";
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

/** Overlay a live backend Trace onto a fixture Delivery shell (contour/service kept). */
export function applyLiveTrace(base: Delivery, live: DevOpsTrace): Delivery {
  if (live.nodes.length === 0) {
    return {
      ...base,
      partial: base.partial || live.partial || live.sourceErrors.length > 0,
      sourceErrors: live.sourceErrors.length > 0 ? live.sourceErrors : base.sourceErrors,
    };
  }

  const nodes: TraceNode[] = live.nodes.map((node) => ({
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

  const edges: TraceEdge[] = live.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    relation: edge.relation,
    confidence: edge.confidence,
    evidence: edge.evidence,
  }));

  return {
    ...base,
    title: live.nodes[0]?.title ?? base.title,
    partial: live.partial,
    sourceErrors: live.sourceErrors,
    situations: live.situations.map((situation) => ({
      level: "notable" as const,
      label: situation.label,
    })),
    nodes,
    edges,
  };
}
