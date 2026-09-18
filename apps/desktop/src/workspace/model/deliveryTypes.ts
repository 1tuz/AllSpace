/** Shared Trace / Delivery UI contract. */

export type Confidence = "exact" | "strong" | "heuristic";

export type DeliveryStage =
  | "attention"
  | "in_progress"
  | "in_review"
  | "building"
  | "deploying"
  | "delivered";

export interface TraceEvidence {
  kind: string;
  detail: string;
}

export interface TraceEdge {
  from: string;
  to: string;
  relation: string;
  confidence: Confidence;
  evidence: TraceEvidence[];
}

export interface TraceNode {
  id: string;
  stage: "work" | "change" | "build" | "artifact" | "deployment" | "runtime";
  kind: string;
  source: string;
  title: string;
  status: string;
  timestamp: string;
  url: string | null;
  attributes: Record<string, string>;
}

export interface DeliverySituation {
  level: "calm" | "notable" | "loud";
  label: string;
  primaryAction?: string;
}

/** Chain-level verdict derived by the provider. */
export interface DeliveryVerdict {
  summary: string;
  severity: "calm" | "notable" | "loud";
  primaryAction?: string;
  ageSeconds?: number;
}

export interface Delivery {
  id: string;
  workId: string;
  title: string;
  contour: "AppFarm" | "Komus" | "Custom";
  service: string;
  stage: DeliveryStage;
  stageLabel: string;
  updated: string;
  situations: DeliverySituation[];
  /** Present when backend derived a chain verdict. */
  verdict?: DeliveryVerdict;
  nodes: TraceNode[];
  edges: TraceEdge[];
  partial: boolean;
  sourceErrors: { source: string; message: string }[];
}
