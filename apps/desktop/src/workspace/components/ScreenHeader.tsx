import type { ReactNode } from "react";

/** Compact screen header shared across workspace routes. */
export function ScreenHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header
      className="workspace-shell__drag shrink-0 border-b border-border"
      style={{ padding: "var(--ws-header-pad-y) var(--ws-header-pad-x)" }}
      data-tauri-drag-region
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight">{title}</h1>
          {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="workspace-shell__no-drag shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
