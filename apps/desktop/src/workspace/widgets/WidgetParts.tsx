import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { ProviderEntity } from "@srelens/core";

/** Compact metric cell — label over value, never a fake zero. */
export function WidgetMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "notable" | "loud";
}) {
  return (
    <div className="widget-metric" data-tone={tone}>
      <p className="widget-metric__label">{label}</p>
      <p className="widget-metric__value tabular-nums">{value}</p>
    </div>
  );
}

export function WidgetMetrics({ children }: { children: ReactNode }) {
  return <div className="widget-metrics">{children}</div>;
}

/**
 * Explicit source state. `unavailable` (not configured / engine absent) is a
 * different fact from `empty` (the source answered with nothing).
 */
export function WidgetState({
  kind,
  text,
  action,
}: {
  kind: "loading" | "empty" | "unavailable" | "error";
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="widget-state" data-kind={kind} role={kind === "error" ? "alert" : "status"}>
      <p>{text}</p>
      {action ? <div className="widget-state__action">{action}</div> : null}
    </div>
  );
}

export function entityAttribute(entity: ProviderEntity, key: string): string | null {
  const value = entity.attributes?.[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return null;
}

const CALM = new Set([
  "success",
  "succeeded",
  "passed",
  "merged",
  "closed",
  "done",
  "resolved",
  "delivered",
  "healthy",
]);
const LOUD = new Set([
  "failure",
  "failed",
  "error",
  "aborted",
  "cancelled",
  "canceled",
  "declined",
  "rejected",
  "blocked",
]);

/** One shared tone vocabulary for provider status words. */
export function statusTone(status: string | null): "calm" | "notable" | "loud" {
  const value = status?.toLowerCase() ?? "";
  if (CALM.has(value)) return "calm";
  if (LOUD.has(value)) return "loud";
  return "notable";
}

/**
 * A provider row. Clickable only when it can become a real anchor — a row with
 * no anchor is text rather than a button that does nothing. The external link
 * is a sibling of the button, not nested inside it.
 */
export function EntityRow({
  entity,
  status,
  meta,
  selected = false,
  onSelect,
}: {
  entity: ProviderEntity;
  status?: string | null;
  meta?: string | null;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const tone = statusTone(status ?? null);
  const content = (
    <>
      <span className="widget-row__dot" data-tone={tone} aria-hidden />
      <span className="widget-row__title">{entity.title}</span>
      {status ? (
        <span className="widget-row__status" data-tone={tone}>
          {status}
        </span>
      ) : null}
      {meta ? <span className="widget-row__meta">{meta}</span> : null}
    </>
  );

  return (
    <div className="widget-row-shell">
      {onSelect ? (
        <button
          type="button"
          className="widget-row"
          data-selectable="true"
          aria-pressed={selected}
          onClick={onSelect}
        >
          {content}
        </button>
      ) : (
        <div className="widget-row" data-selectable="false">
          {content}
        </div>
      )}
      {entity.url ? (
        <a
          className="widget-row__link"
          href={entity.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${entity.title} in a browser`}
        >
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}
