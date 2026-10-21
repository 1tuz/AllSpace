import type { Confidence } from "../model/deliveryTypes";

const LABEL: Record<Confidence, string> = {
  exact: "Exact",
  strong: "Strong",
  heuristic: "Heuristic",
};

/** Confidence with a word label — color is never the only signal. */
export function ConfidenceBadge({
  confidence,
  showCaveat = false,
}: {
  confidence: Confidence;
  /** When true, heuristic joins get an explicit non-certainty note. */
  showCaveat?: boolean;
}) {
  return (
    <span
      className="workspace-shell__mono inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-medium tracking-wide"
      aria-label={`confidence ${confidence}`}
      data-confidence={confidence}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{
          background:
            confidence === "exact"
              ? "var(--ws-confidence-exact)"
              : confidence === "strong"
                ? "var(--ws-confidence-strong)"
                : "var(--ws-confidence-heuristic)",
        }}
        aria-hidden="true"
      />
      {LABEL[confidence]}
      {showCaveat && confidence === "heuristic" && (
        <span className="font-normal text-muted-foreground" data-testid="heuristic-caveat">
          — possible match, not confirmed
        </span>
      )}
    </span>
  );
}
