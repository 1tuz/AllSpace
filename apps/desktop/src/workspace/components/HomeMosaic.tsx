import type { ReactNode } from "react";
import { HomeWidget } from "./HomeWidget";
import type { HomeWidgetId } from "./homeWidgetIds";
export type { HomeWidgetId } from "./homeWidgetIds";

export function HomeMosaic({
  maximizedId,
  onMaximizeChange,
  summary,
  inbox,
  trace,
}: {
  maximizedId: HomeWidgetId | null;
  onMaximizeChange: (id: HomeWidgetId | null) => void;
  summary: ReactNode;
  inbox: ReactNode;
  trace: ReactNode;
}) {
  const mode = maximizedId ? "maximized" : "grid";

  return (
    <div
      className="home-mosaic"
      data-testid="home-mosaic"
      data-home-mosaic-mode={mode}
      data-maximized-region={maximizedId ?? undefined}
    >
      <HomeWidget
        id="summary"
        title="Summary"
        maximizedId={maximizedId}
        onMaximizeChange={onMaximizeChange}
        className="home-mosaic__summary"
        hidden={maximizedId != null && maximizedId !== "summary"}
      >
        {summary}
      </HomeWidget>
      <HomeWidget
        id="inbox"
        title="Inbox"
        maximizedId={maximizedId}
        onMaximizeChange={onMaximizeChange}
        className="home-mosaic__inbox"
        hidden={maximizedId != null && maximizedId !== "inbox"}
      >
        {inbox}
      </HomeWidget>
      <HomeWidget
        id="trace"
        title="Trace"
        maximizedId={maximizedId}
        onMaximizeChange={onMaximizeChange}
        className="home-mosaic__trace"
        hidden={maximizedId != null && maximizedId !== "trace"}
      >
        {trace}
      </HomeWidget>
    </div>
  );
}
