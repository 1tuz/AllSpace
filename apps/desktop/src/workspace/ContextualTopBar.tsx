import { Button } from "../ui";

export type TopBarDelivery = {
  workId: string;
  title: string;
};

/** Compact context strip: contour + optional Delivery + back. Not a second switcher. */
export function ContextualTopBar({
  profileLabel,
  delivery = null,
  onBack,
}: {
  profileLabel: string;
  delivery?: TopBarDelivery | null;
  onBack?: () => void;
}) {
  return (
    <header
      className="workspace-shell__drag shrink-0 border-b border-border"
      style={{ padding: "0.375rem var(--ws-header-pad-x)" }}
      data-testid="contextual-top-bar"
      data-tauri-drag-region
    >
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span
          className="shrink-0 font-medium text-muted-foreground"
          data-testid="top-bar-profile"
        >
          {profileLabel || "No contour"}
        </span>
        {delivery ? (
          <>
            <span className="shrink-0 text-muted-foreground" aria-hidden>
              ·
            </span>
            <span
              className="min-w-0 truncate text-foreground"
              data-testid="top-bar-delivery"
            >
              <span className="workspace-shell__mono">{delivery.workId}</span>
              {delivery.title ? ` ${delivery.title}` : null}
            </span>
            {onBack ? (
              <Button
                variant="ghost"
                size="xs"
                className="workspace-shell__no-drag ml-auto shrink-0"
                onClick={onBack}
                data-testid="top-bar-back"
              >
                ← Back
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </header>
  );
}
