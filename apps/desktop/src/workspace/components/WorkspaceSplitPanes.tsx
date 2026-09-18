import type { ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

/** Horizontal master/detail split — chain narrative left, unit detail right. */
export function WorkspaceSplitPanes({
  left,
  right,
  leftDefault = "40",
  leftMin = "28",
}: {
  left: ReactNode;
  right: ReactNode;
  leftDefault?: string;
  leftMin?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1" data-testid="workspace-split-panes">
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize={leftDefault} minSize={leftMin} className="min-h-0 min-w-0 overflow-auto">
          {left}
        </Panel>
        <Separator className="workspace-panel-resize" />
        <Panel
          defaultSize={String(100 - Number(leftDefault))}
          minSize="24"
          className="min-h-0 min-w-0 overflow-auto border-l border-border bg-muted/10"
        >
          {right}
        </Panel>
      </Group>
    </div>
  );
}
