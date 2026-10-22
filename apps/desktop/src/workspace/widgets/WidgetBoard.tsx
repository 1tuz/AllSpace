import type { ReactNode } from "react";
import { useEffect } from "react";
import { ArrowLeft, ArrowRight, StretchHorizontal } from "lucide-react";
import { Button } from "../../ui";
import { WidgetFrame } from "./WidgetFrame";
import type { WidgetId, WidgetSlot } from "./types";

export interface BoardWidget {
  id: WidgetId;
  title: string;
  summary: ReactNode;
  detail: ReactNode;
}

/**
 * The board: a default reading order, per-profile layout, one pinned widget and
 * one expanded widget. Layout controls are in the header and appear on hover or
 * keyboard focus — configuring the board is never a first-run step.
 */
export function WidgetBoard({
  layout,
  widgets,
  expandedId,
  onExpandedChange,
  pinnedId,
  onPinnedChange,
  onMove,
  onToggleSpan,
  hoverIntentMs,
}: {
  layout: WidgetSlot[];
  widgets: BoardWidget[];
  expandedId: WidgetId | null;
  onExpandedChange: (id: WidgetId | null) => void;
  pinnedId: WidgetId | null;
  onPinnedChange: (id: WidgetId | null) => void;
  onMove: (id: WidgetId, delta: -1 | 1) => void;
  onToggleSpan: (id: WidgetId) => void;
  hoverIntentMs?: number;
}) {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const placed = expandedId
    ? layout.filter((slot) => slot.id === expandedId)
    : layout;

  // Escape works even when focus is elsewhere on the board (e.g. after a click).
  useEffect(() => {
    if (!pinnedId && !expandedId) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      onExpandedChange(null);
      onPinnedChange(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinnedId, expandedId, onExpandedChange, onPinnedChange]);

  return (
    <div
      className="widget-board"
      data-testid="widget-board"
      data-board-mode={expandedId ? "expanded" : "grid"}
    >
      {placed.map((slot) => {
        const widget = byId.get(slot.id);
        if (!widget) return null;
        const expanded = expandedId === slot.id;
        return (
          <div
            key={slot.id}
            className="widget-board__cell"
            data-span={expanded ? 2 : slot.span}
          >
            <WidgetFrame
              id={slot.id}
              title={widget.title}
              expanded={expanded}
              pinned={pinnedId === slot.id}
              onPinnedChange={(pinned) => onPinnedChange(pinned ? slot.id : null)}
              onExpandChange={onExpandedChange}
              hoverIntentMs={hoverIntentMs}
              toolbar={
                expanded ? null : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="workspace-shell__no-drag text-muted-foreground"
                      aria-label={`Move ${widget.title} earlier`}
                      title="Move earlier"
                      onClick={() => onMove(slot.id, -1)}
                    >
                      <ArrowLeft className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="workspace-shell__no-drag text-muted-foreground"
                      aria-label={`Move ${widget.title} later`}
                      title="Move later"
                      onClick={() => onMove(slot.id, 1)}
                    >
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="workspace-shell__no-drag text-muted-foreground"
                      aria-label={`Resize ${widget.title}`}
                      title="Toggle width"
                      onClick={() => onToggleSpan(slot.id)}
                    >
                      <StretchHorizontal className="size-3.5" aria-hidden />
                    </Button>
                  </>
                )
              }
              summary={widget.summary}
            >
              {widget.detail}
            </WidgetFrame>
          </div>
        );
      })}
    </div>
  );
}
