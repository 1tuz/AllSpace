import type { DeliveryAnchor, DevOpsProfile } from "@srelens/core";

/** Board widgets, in default reading order. */
export type WidgetId =
  | "summary"
  | "trace"
  | "jira"
  | "git"
  | "ci"
  | "kubernetes"
  | "docker";

/** One placed widget: column span only — rows flow. */
export interface WidgetSlot {
  id: WidgetId;
  span: 1 | 2;
}

/** What the reader picked, shared by every widget on the board. */
export interface BoardSelection {
  anchor: DeliveryAnchor;
  title: string;
  /** Human label for the source the selection came from, e.g. "Jira". */
  source: string;
}

export type BoardWidgetTitle = Record<WidgetId, string>;

/** Props every provider widget receives from the board. */
export interface WidgetSourceProps {
  profile: DevOpsProfile | null;
  profileId: string;
  selection: BoardSelection | null;
  onSelect: (selection: BoardSelection) => void;
  /** `compact` is the always-rendered card; `detail` is the opened panel. */
  variant?: "compact" | "detail";
}
