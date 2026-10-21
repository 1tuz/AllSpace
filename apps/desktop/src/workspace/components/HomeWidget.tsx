import type { ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "../../ui";
import type { HomeWidgetId } from "./homeWidgetIds";
export type { HomeWidgetId } from "./homeWidgetIds";

export function HomeWidget({
  id,
  title,
  maximizedId,
  onMaximizeChange,
  children,
  className,
  hidden,
}: {
  id: HomeWidgetId;
  title: string;
  maximizedId: HomeWidgetId | null;
  onMaximizeChange: (id: HomeWidgetId | null) => void;
  children: ReactNode;
  className?: string;
  hidden?: boolean;
}) {
  const maximized = maximizedId === id;
  const toggleLabel = maximized ? "Restore" : "Maximize";

  return (
    <section
      data-testid={`home-widget-${id}`}
      data-maximized={maximized ? "true" : "false"}
      hidden={hidden}
      className={`flex min-h-0 flex-col border-b border-border ${className ?? ""}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="workspace-shell__no-drag text-muted-foreground"
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => onMaximizeChange(maximized ? null : id)}
        >
          {maximized ? (
            <Minimize2 className="size-3.5" aria-hidden />
          ) : (
            <Maximize2 className="size-3.5" aria-hidden />
          )}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
