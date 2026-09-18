/** Map a provider `DeliverySummary` into a list row. */

import type { DeliveryAnchor, DevOpsDeliverySummary } from "@srelens/core";
import type {
  Delivery,
  DeliveryStage,
  DeliverySituation,
  DeliveryVerdict,
} from "../model/deliveryTypes";

const STAGES = new Set<DeliveryStage>([
  "attention",
  "in_progress",
  "in_review",
  "building",
  "deploying",
  "delivered",
]);

function asStage(raw: string): DeliveryStage {
  return STAGES.has(raw as DeliveryStage) ? (raw as DeliveryStage) : "in_progress";
}

function asLevel(raw: string): DeliverySituation["level"] {
  if (raw === "loud" || raw === "notable" || raw === "calm") return raw;
  if (raw === "healthy") return "calm";
  return "notable";
}

export type DeliveryListItem = Delivery & { anchor?: DeliveryAnchor };

export function summaryToDelivery(
  summary: DevOpsDeliverySummary,
  contour: Delivery["contour"] = "Custom",
): DeliveryListItem {
  const situations: DeliverySituation[] = summary.situations.map((s) => ({
    level: asLevel(s.level),
    label: s.label,
    primaryAction: s.primaryAction,
  }));
  const verdict: DeliveryVerdict | undefined = summary.verdict
    ? {
        summary: summary.verdict.summary,
        severity: asLevel(summary.verdict.severity),
        primaryAction: summary.verdict.primaryAction,
        ageSeconds: summary.verdict.ageSeconds,
      }
    : undefined;

  return {
    id: summary.id,
    workId: summary.workId ?? summary.anchor.value,
    title: summary.title,
    contour,
    service: "",
    stage: asStage(summary.stage),
    stageLabel: summary.stageLabel,
    updated: summary.updated ?? "",
    situations,
    verdict,
    nodes: [],
    edges: [],
    partial: summary.partial,
    sourceErrors: summary.sourceErrors,
    anchor: summary.anchor,
  };
}
