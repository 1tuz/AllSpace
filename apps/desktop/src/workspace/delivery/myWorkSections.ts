/** My Work inbox grouping for provider-backed delivery summaries. */

import type { Delivery, DeliverySituation } from "../model/deliveryTypes";

const LEVEL_RANK: Record<DeliverySituation["level"], number> = {
  loud: 0,
  notable: 1,
  calm: 2,
};

export type MyWorkSectionId =
  | "needsAttention"
  | "inProgress"
  | "inReview"
  | "building"
  | "delivered";

export interface MyWorkSection {
  id: MyWorkSectionId;
  title: string;
  rows: Delivery[];
}

const SECTION_META: { id: MyWorkSectionId; title: string; match: (d: Delivery) => boolean }[] = [
  {
    id: "needsAttention",
    title: "Needs attention",
    match: (d) => d.stage === "attention" || d.situations.some((s) => s.level === "loud"),
  },
  {
    id: "inProgress",
    title: "In progress",
    match: (d) => d.stage === "in_progress",
  },
  {
    id: "inReview",
    title: "In review",
    match: (d) => d.stage === "in_review",
  },
  {
    id: "building",
    title: "Building or deploying",
    match: (d) => d.stage === "building" || d.stage === "deploying",
  },
  {
    id: "delivered",
    title: "Recently delivered",
    match: (d) => d.stage === "delivered",
  },
];

function situationRank(delivery: Delivery): number {
  if (delivery.situations.length === 0) return 99;
  return Math.min(...delivery.situations.map((s) => LEVEL_RANK[s.level]));
}

/** Loudest situation label — plain-language verdict for a row. */
export function deliveryVerdict(delivery: Delivery): string | null {
  if (delivery.verdict?.summary) return delivery.verdict.summary;
  const loud =
    delivery.situations.find((s) => s.level === "loud") ?? delivery.situations[0] ?? null;
  return loud?.label ?? null;
}

/** Severity word for the verdict; color alone is never enough. */
export function deliveryVerdictLevel(
  delivery: Delivery,
): DeliverySituation["level"] | null {
  if (delivery.verdict?.severity === "loud" || delivery.verdict?.severity === "notable" || delivery.verdict?.severity === "calm") {
    return delivery.verdict.severity;
  }
  const loud =
    delivery.situations.find((s) => s.level === "loud") ?? delivery.situations[0] ?? null;
  return loud?.level ?? null;
}

/** Single primary action label for opening the delivery. */
export function deliveryPrimaryAction(_delivery: Delivery): string {
  return "Open";
}

/**
 * Non-empty My Work sections only. A delivery that matches Needs attention
 * is not also listed under Building even if stage could overlap — attention wins.
 */
export function myWorkSections(deliveries: Delivery[]): MyWorkSection[] {
  const claimed = new Set<string>();
  const sections: MyWorkSection[] = [];

  for (const meta of SECTION_META) {
    const rows = deliveries
      .filter((d) => !claimed.has(d.id) && meta.match(d))
      .sort((a, b) => situationRank(a) - situationRank(b));
    if (rows.length === 0) continue;
    for (const row of rows) claimed.add(row.id);
    sections.push({ id: meta.id, title: meta.title, rows });
  }

  return sections;
}
