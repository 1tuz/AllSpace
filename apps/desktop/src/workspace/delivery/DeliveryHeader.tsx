import type { ReactNode } from "react";
import { Button } from "../../ui";
import type { DeliveryViewModel } from "../model/deliveryViewModel";
import { SituationBadge } from "./SituationBadge";

export function DeliveryHeader({
  view,
  originLabel,
  error,
  onBack,
  backLabel = "← Deliveries",
}: {
  view: DeliveryViewModel;
  originLabel: string;
  error: string | null;
  /** Omit when ContextualTopBar already owns Back. */
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <header className="shrink-0 border-b border-border px-4 py-3" data-testid="delivery-header">
      {onBack ? (
        <Button variant="ghost" size="xs" onClick={onBack}>
          {backLabel}
        </Button>
      ) : null}
      <p className={`text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground${onBack ? " mt-2" : ""}`}>
        Delivery
      </p>
      <h1 className="mt-0.5 text-lg font-semibold tracking-tight">
        <span className="workspace-shell__mono">{view.workId}</span> {view.title}
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">
        {view.contour} · {view.service} · {view.stageLabel}
        {" · "}
        <span data-testid="trace-origin">{originLabel}</span>
      </p>
      {error && (
        <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          Live refresh failed: {error}
        </p>
      )}
      {view.situations.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {view.situations.map((s) => (
            <li key={s.label}>
              <SituationBadge situation={s} />
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

export function TraceBanner({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="border-l-2 border-amber-500 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
      {children}
    </p>
  );
}
