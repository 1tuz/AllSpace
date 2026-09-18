import type { DeliverySituation } from "../model/deliveryTypes";

const WORD: Record<DeliverySituation["level"], string> = {
  loud: "Loud",
  notable: "Notable",
  calm: "Calm",
};

/** Situation chip: level word + label; not color-only. */
export function SituationBadge({ situation }: { situation: DeliverySituation }) {
  return (
    <span
      className="inline-flex max-w-full items-baseline gap-1.5 text-xs"
      data-situation={situation.level}
    >
      <span
        className="shrink-0 font-medium"
        style={{
          color:
            situation.level === "loud"
              ? "var(--ws-situation-loud)"
              : situation.level === "notable"
                ? "var(--ws-situation-notable)"
                : "var(--ws-situation-calm)",
        }}
      >
        {WORD[situation.level]}
      </span>
      <span className="min-w-0 truncate text-muted-foreground">— {situation.label}</span>
    </span>
  );
}
