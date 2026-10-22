import type { DeliveryListItem } from "../delivery/summaryToDelivery";
import type { BoardSelection } from "./types";

/**
 * Map a board selection onto the row shape the shell top bar and the Trace
 * region already understand. Nothing here claims a stage: the trace call fills
 * the real chain, and provider failures stay source errors.
 */
export function selectionToDeliveryItem(selection: BoardSelection): DeliveryListItem {
  return {
    id: `${selection.anchor.kind}:${selection.anchor.value}`,
    workId: selection.anchor.value,
    title: selection.title,
    contour: "Custom",
    service: "",
    stage: "in_progress",
    stageLabel: selection.source,
    updated: "",
    situations: [],
    nodes: [],
    edges: [],
    partial: false,
    sourceErrors: [],
    anchor: selection.anchor,
  };
}
