import type { Delivery } from "../model/deliveryTypes";
import {
  deliveryPrimaryAction,
  deliveryVerdict,
  deliveryVerdictLevel,
} from "./myWorkSections";

const LEVEL_WORD = {
  loud: "Needs attention",
  notable: "Notable",
  calm: "Calm",
} as const;

export function DeliveryRow({ delivery, onOpen }: { delivery: Delivery; onOpen: () => void }) {
  const verdict = deliveryVerdict(delivery);
  const level = deliveryVerdictLevel(delivery);
  const action = deliveryPrimaryAction(delivery);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open delivery ${delivery.workId}: ${delivery.title}`}
      className="workspace-dense-row flex w-full items-start gap-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      data-testid="delivery-row"
    >
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-[13px] font-medium leading-snug">
            <span className="workspace-shell__mono">{delivery.workId}</span> {delivery.title}
          </p>
          <p className="shrink-0 text-[11px] text-muted-foreground">{delivery.updated}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          <span className="sr-only">Stage: </span>
          {delivery.stageLabel}
          {delivery.service ? (
            <span className="text-muted-foreground/80"> · {delivery.service}</span>
          ) : null}
        </p>
        {verdict && level && (
          <p className="text-[11px] leading-snug" data-testid="delivery-row-verdict" data-situation={level}>
            <span
              className="font-medium"
              style={{
                color:
                  level === "loud"
                    ? "var(--ws-situation-loud)"
                    : level === "notable"
                      ? "var(--ws-situation-notable)"
                      : "var(--ws-situation-calm)",
              }}
            >
              {LEVEL_WORD[level]}
            </span>
            <span className="text-muted-foreground"> — {verdict}</span>
          </p>
        )}
      </div>
      <span
        className="shrink-0 self-center text-[11px] font-medium text-foreground"
        data-testid="delivery-row-action"
      >
        {action}
      </span>
    </button>
  );
}
