import { settingsStorage } from "@srelens/core";
import type { WidgetId, WidgetSlot } from "./types";

export const BOARD_LAYOUT_KEY_PREFIX = "srelens.workspace.board.";

export const BOARD_WIDGET_IDS: WidgetId[] = [
  "summary",
  "trace",
  "jira",
  "git",
  "ci",
  "kubernetes",
  "docker",
];

/** First launch needs no configuration: the old fixed mosaic, plus provider widgets. */
export const DEFAULT_BOARD_LAYOUT: WidgetSlot[] = [
  { id: "summary", span: 2 },
  { id: "jira", span: 1 },
  { id: "git", span: 1 },
  { id: "ci", span: 1 },
  { id: "kubernetes", span: 1 },
  { id: "docker", span: 1 },
  { id: "trace", span: 2 },
];

type LayoutStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === "string" && (BOARD_WIDGET_IDS as string[]).includes(value);
}

/**
 * Normalise stored layout: drop unknown ids, dedupe, and append widgets added
 * since the layout was saved so an upgrade never hides a widget.
 */
export function normalizeBoardLayout(value: unknown): WidgetSlot[] {
  const saved = Array.isArray(value) ? value : [];
  const seen = new Set<WidgetId>();
  const out: WidgetSlot[] = [];
  for (const raw of saved) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as { id?: unknown; span?: unknown };
    if (!isWidgetId(candidate.id) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    out.push({ id: candidate.id, span: candidate.span === 2 ? 2 : 1 });
  }
  for (const slot of DEFAULT_BOARD_LAYOUT) {
    if (!seen.has(slot.id)) out.push({ ...slot });
  }
  return out;
}

export function boardLayoutKey(profileId: string): string {
  return `${BOARD_LAYOUT_KEY_PREFIX}${profileId || "default"}`;
}

/** Read the layout for one profile. A bad or absent value yields the default. */
export function loadBoardLayout(profileId: string, storage?: LayoutStore): WidgetSlot[] {
  const backing = storage ?? defaultStorage();
  if (!backing) return DEFAULT_BOARD_LAYOUT.map((slot) => ({ ...slot }));
  try {
    const raw = backing.getItem(boardLayoutKey(profileId));
    if (!raw) return DEFAULT_BOARD_LAYOUT.map((slot) => ({ ...slot }));
    return normalizeBoardLayout(JSON.parse(raw));
  } catch {
    return DEFAULT_BOARD_LAYOUT.map((slot) => ({ ...slot }));
  }
}

export function saveBoardLayout(profileId: string, layout: WidgetSlot[], storage?: LayoutStore): void {
  const backing = storage ?? defaultStorage();
  if (!backing) return;
  try {
    backing.setItem(boardLayoutKey(profileId), JSON.stringify(normalizeBoardLayout(layout)));
  } catch {
    /* settings backend unavailable — keep the in-memory layout */
  }
}

/** Drop a deleted profile's layout so a recreated id starts from the default. */
export function clearBoardLayout(profileId: string, storage?: LayoutStore): void {
  const backing = storage ?? defaultStorage();
  if (!backing) return;
  try {
    backing.removeItem(boardLayoutKey(profileId));
  } catch {
    /* settings backend unavailable — nothing was stored to drop */
  }
}

/** Move a widget by one position; edges are no-ops. */
export function moveWidget(layout: WidgetSlot[], id: WidgetId, delta: -1 | 1): WidgetSlot[] {
  const index = layout.findIndex((slot) => slot.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= layout.length) return layout;
  const next = [...layout];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Toggle a widget between one and two columns. */
export function toggleWidgetSpan(layout: WidgetSlot[], id: WidgetId): WidgetSlot[] {
  return layout.map((slot) =>
    slot.id === id ? { ...slot, span: slot.span === 2 ? 1 : 2 } : slot,
  );
}

function defaultStorage(): LayoutStore | null {
  try {
    return settingsStorage as unknown as LayoutStore;
  } catch {
    return null;
  }
}
