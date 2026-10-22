import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Maximize2, Minimize2, Pin, PinOff } from "lucide-react";
import { Button } from "../../ui";
import type { WidgetId } from "./types";

/** Wait for intent before opening, so crossing a widget does not flash it open. */
export const HOVER_INTENT_MS = 180;
/** Short grace after the pointer leaves: re-entering cancels the close. */
export const HOVER_GRACE_MS = 140;

type Timer = ReturnType<typeof setTimeout>;

/**
 * One board widget.
 *
 * `compact` → `hover` on pointer intent, `pinned` on click, `expanded` takes the
 * board. The detail body is mounted on first open and then kept mounted while
 * collapsed, so scroll position, selection and in-flight reads survive. While
 * not expanded, the body is a fixed-position panel anchored to the card: a
 * neighbour never reflows because another widget opened.
 */
export function WidgetFrame({
  id,
  title,
  summary,
  children,
  toolbar,
  expanded,
  onExpandChange,
  pinned,
  onPinnedChange,
  hoverIntentMs = HOVER_INTENT_MS,
  hoverGraceMs = HOVER_GRACE_MS,
}: {
  id: WidgetId;
  title: string;
  /** Always-rendered compact content (key numbers, a few rows). */
  summary: ReactNode;
  /** Detail content — mounted on first open, never refetched by collapsing. */
  children: ReactNode;
  /** Board controls (move / resize) rendered in the header. */
  toolbar?: ReactNode;
  expanded: boolean;
  onExpandChange: (id: WidgetId | null) => void;
  /** Controlled by the board so only one widget is pinned at a time. */
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  hoverIntentMs?: number;
  hoverGraceMs?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const openTimer = useRef<Timer | null>(null);
  const closeTimer = useRef<Timer | null>(null);
  const bodyId = useId();

  const open = expanded || pinned || hovered;
  const state = expanded ? "expanded" : pinned ? "pinned" : hovered ? "hover" : "compact";

  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /** Anchor the detail panel to the card without moving the grid. */
  const placePanel = useCallback(() => {
    if (expanded) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const width = Math.max(rect.width, 320);
    const viewportWidth = window.innerWidth || width;
    const viewportHeight = window.innerHeight || 0;
    const left = Math.min(Math.max(rect.left, margin), Math.max(margin, viewportWidth - width - margin));
    const top = rect.bottom + 4;
    setPanelStyle({
      position: "fixed",
      top,
      left,
      width,
      maxHeight: Math.max(180, viewportHeight - top - margin),
      zIndex: 40,
    });
  }, [expanded]);

  useLayoutEffect(() => {
    if (!open || expanded) return;
    placePanel();
    const onReflow = () => placePanel();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, expanded, placePanel]);

  function onPointerEnter(event: ReactPointerEvent) {
    if (event.pointerType && event.pointerType !== "mouse") return;
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (pinned || expanded || openTimer.current) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      setHovered(true);
    }, hoverIntentMs);
  }

  function onPointerLeave(event: ReactPointerEvent) {
    if (event.pointerType && event.pointerType !== "mouse") return;
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (pinned || expanded) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setHovered(false);
    }, hoverGraceMs);
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key !== "Escape") return;
    if (!open) return;
    event.stopPropagation();
    if (expanded) onExpandChange(null);
    onPinnedChange(false);
    setHovered(false);
    // Collapsing hides the body; keep focus somewhere visible.
    titleRef.current?.focus();
  }

  return (
    <section
      ref={rootRef}
      className="widget-frame"
      data-testid={`widget-${id}`}
      data-widget-id={id}
      data-widget-state={state}
      data-widget-expanded={expanded ? "true" : "false"}
      aria-label={title}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
    >
      <header className="widget-frame__head">
        <button
          ref={titleRef}
          type="button"
          className="widget-frame__title"
          aria-expanded={open}
          aria-controls={bodyId}
          title={pinned ? "Unpin widget" : "Pin widget"}
          onClick={() => onPinnedChange(!pinned)}
        >
          {title}
        </button>
        {toolbar ? <div className="widget-frame__tools">{toolbar}</div> : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="workspace-shell__no-drag text-muted-foreground"
          aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
          aria-pressed={pinned}
          title={pinned ? "Unpin widget" : "Pin widget"}
          onClick={() => onPinnedChange(!pinned)}
        >
          {pinned ? <PinOff className="size-3.5" aria-hidden /> : <Pin className="size-3.5" aria-hidden />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="workspace-shell__no-drag text-muted-foreground"
          aria-label={expanded ? `Restore ${title}` : `Expand ${title}`}
          title={expanded ? "Restore" : "Expand"}
          onClick={() => onExpandChange(expanded ? null : id)}
        >
          {expanded ? (
            <Minimize2 className="size-3.5" aria-hidden />
          ) : (
            <Maximize2 className="size-3.5" aria-hidden />
          )}
        </Button>
      </header>
      <div
        className="widget-frame__summary"
        onClick={() => {
          if (!expanded && !pinned) onPinnedChange(true);
        }}
      >
        {summary}
      </div>
      <div
        id={bodyId}
        className="widget-frame__body"
        data-testid={`widget-${id}-body`}
        hidden={!open}
        style={expanded ? undefined : panelStyle}
      >
        {hasOpened ? children : null}
      </div>
    </section>
  );
}
