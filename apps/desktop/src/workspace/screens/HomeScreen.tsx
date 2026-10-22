import { useEffect, useState, type ReactNode } from "react";
import type { DevOpsProfile, DevOpsRuntimeScope } from "@srelens/core";import type { Delivery } from "../model/deliveryTypes";
import { DeliveryRow } from "../delivery/DeliveryRow";
import { myWorkSections, type MyWorkSection } from "../delivery/myWorkSections";
import type { DeliveryListItem } from "../delivery/summaryToDelivery";
import { useLiveDeliveryList } from "../hooks/useLiveDeliveryList";
import { sourceLabel } from "../delivery/DeliveryStageRail";
import type { RuntimeHandoff } from "../runtimeHandoff";
import { DeliveryTraceScreen } from "./DeliveryTraceScreen";
import { WidgetBoard, type BoardWidget } from "../widgets/WidgetBoard";
import { JiraWidget } from "../widgets/JiraWidget";
import { GitWidget } from "../widgets/GitWidget";
import { CiWidget } from "../widgets/CiWidget";
import { KubernetesWidget } from "../widgets/KubernetesWidget";
import { DockerWidget } from "../widgets/DockerWidget";
import { TraceSummary } from "../widgets/TraceWidget";
import {
  loadBoardLayout,
  moveWidget,
  saveBoardLayout,
  toggleWidgetSpan,
} from "../widgets/layout";
import { selectionToDeliveryItem } from "../widgets/selection";
import type { BoardSelection, WidgetId, WidgetSlot } from "../widgets/types";

const EMPTY_COPY =
  "Nothing needs attention right now. When deliveries arrive, they will show up here.";

const SUMMARY_ITEMS: Array<{ id: MyWorkSection["id"]; label: string }> = [
  { id: "needsAttention", label: "Attention" },
  { id: "inReview", label: "Review" },
  { id: "building", label: "Building" },
  { id: "delivered", label: "Delivered" },
];

/**
 * The board. One screen of related widgets over provider capabilities; a
 * selection in any widget becomes the shared context the Trace resolves.
 */
export function HomeScreen({
  profile,
  runtimeScope,
  selected = null,
  onSelect,
  onExploreRuntime,
}: {
  profile: DevOpsProfile | null;
  runtimeScope?: DevOpsRuntimeScope | null;
  /** Lifted so the shell top bar can show work id/title + back. */
  selected?: DeliveryListItem | null;
  onSelect?: (item: DeliveryListItem | null) => void;
  onExploreRuntime: (target?: RuntimeHandoff) => void;
}) {
  const live = useLiveDeliveryList("myWork", profile);
  const sections: MyWorkSection[] = myWorkSections(live.rows);
  const profileId = profile?.id ?? "";
  const [selection, setSelection] = useState<BoardSelection | null>(null);
  const [layout, setLayout] = useState<WidgetSlot[]>(() => loadBoardLayout(profileId));
  const [expandedId, setExpandedId] = useState<WidgetId | null>(null);
  const [pinnedId, setPinnedId] = useState<WidgetId | null>(null);

  // A profile owns its layout and its context: switching drops both.
  useEffect(() => {
    setLayout(loadBoardLayout(profileId));
    setSelection(null);
    setExpandedId(null);
    setPinnedId(null);
  }, [profileId]);

  function choose(next: BoardSelection | null) {
    setSelection(next);
    onSelect?.(next ? selectionToDeliveryItem(next) : null);
  }

  function updateLayout(next: WidgetSlot[]) {
    setLayout(next);
    saveBoardLayout(profileId, next);
  }

  const loading = live.loading;
  const hasSourceProblems = !!live.error || live.sourceErrors.length > 0;
  const failed = !loading && hasSourceProblems && sections.length === 0;
  const empty = !loading && !hasSourceProblems && sections.length === 0;

  const sourceErrors = hasSourceProblems ? (
    <div className="space-y-2 border-b border-border px-4 py-3" data-testid="home-live-source-errors">
      {live.error ? (
        <p className="text-sm" role="alert">
          Could not load My Work: {live.error}
        </p>
      ) : null}
      {live.partial && !live.error && live.rows.length > 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          Partial results — some sources did not answer fully.
        </p>
      ) : null}
      {live.sourceErrors.length > 0 ? (
        <div className="divide-y divide-border border border-border">
          {live.sourceErrors.map((err) => (
            <p key={`${err.source}:${err.message}`} className="px-3 py-2 text-sm">
              <span className="font-medium">{sourceLabel(err.source)}:</span> {err.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  let deliveryRows: ReactNode;
  if (loading) {
    deliveryRows = (
      <p className="px-4 py-4 text-sm text-muted-foreground" role="status" data-testid="home-live-loading">
        Loading deliveries…
      </p>
    );
  } else if (failed) {
    deliveryRows = (
      <p className="px-4 py-4 text-sm text-muted-foreground" role="status" data-testid="home-live-error">
        My Work could not be loaded. This is not an empty inbox — see the source error above.
      </p>
    );
  } else if (empty) {
    deliveryRows = (
      <p
        className="px-4 py-4 text-sm text-muted-foreground"
        role="status"
        data-testid="home-live-empty"
      >
        {EMPTY_COPY}
      </p>
    );
  } else {
    deliveryRows = (
      <div className="flex flex-col" style={{ gap: "var(--ws-section-gap)" }}>
        {sections.map((section) => (
          <HomeSection
            key={section.id}
            section={section}
            selectedId={selection?.anchor.value ?? selected?.anchor?.value ?? null}
            onSelect={(row) =>
              choose({
                anchor: row.anchor ?? { kind: "issue", value: row.workId },
                title: row.title,
                source: row.contour,
              })
            }
          />
        ))}
      </div>
    );
  }

  const traceAnchor = selection?.anchor ?? selected?.anchor ?? null;
  const traceId = selection
    ? selectionToDeliveryItem(selection).id
    : (selected?.id ?? "board");

  const widgets: BoardWidget[] = [
    {
      id: "summary",
      title: "My Work",
      summary: (
        <div className="flex flex-col">
          {loading || failed ? (
            <p className="px-4 py-3 text-sm text-muted-foreground" role="status">
              {loading ? "Loading deliveries…" : "Sources did not answer."}
            </p>
          ) : empty ? (
            <p className="px-4 py-3 text-sm text-muted-foreground" role="status" data-testid="home-live-empty">
              {EMPTY_COPY}
            </p>
          ) : (
            <HomeSummaryStrip sections={sections} />
          )}
        </div>
      ),
      detail: (
        <div className="flex min-h-0 flex-col">
          {sourceErrors}
          {deliveryRows}
        </div>
      ),
    },
    {
      id: "jira",
      title: "Jira",
      summary: (
        <JiraWidget
          profile={profile}
          profileId={profileId}
          selection={selection}
          onSelect={choose}
          variant="compact"
        />
      ),
      detail: (
        <JiraWidget
          profile={profile}
          profileId={profileId}
          selection={selection}
          onSelect={choose}
          variant="detail"
        />
      ),
    },
    {
      id: "git",
      title: "Git",
      summary: (
        <GitWidget
          profile={profile}
          profileId={profileId}
          selection={selection}
          onSelect={choose}
          variant="compact"
        />
      ),
      detail: (
        <GitWidget
          profile={profile}
          profileId={profileId}
          selection={selection}
          onSelect={choose}
          variant="detail"
        />
      ),
    },
    {
      id: "ci",
      title: "CI/CD",
      summary: (
        <CiWidget
          profile={profile}
          profileId={profileId}
          selection={selection}
          onSelect={choose}
          variant="compact"
        />
      ),
      detail: (
        <CiWidget
          profile={profile}
          profileId={profileId}
          selection={selection}
          onSelect={choose}
          variant="detail"
        />
      ),
    },
    {
      id: "kubernetes",
      title: "Kubernetes",
      summary: (
        <KubernetesWidget
          profile={profile}
          profileId={profileId}
          selection={selection}
          onSelect={choose}
          onOpenExplorer={onExploreRuntime}
          variant="compact"
        />
      ),
      detail: (
        <KubernetesWidget
          profile={profile}
          profileId={profileId}
          selection={selection}
          onSelect={choose}
          onOpenExplorer={onExploreRuntime}
          variant="detail"
        />
      ),
    },
    {
      id: "docker",
      title: "Docker",
      summary: (
        <DockerWidget
          profile={profile}
          profileId={profileId}
          selection={selection}
          onSelect={choose}
          variant="compact"
        />
      ),
      detail: (
        <DockerWidget
          profile={profile}
          profileId={profileId}
          selection={selection}
          onSelect={choose}
          variant="detail"
        />
      ),
    },
    {
      id: "trace",
      title: "Delivery Trace",
      summary: (
        <TraceSummary selection={selection} profile={profile} runtimeScope={runtimeScope} />
      ),
      detail:
        traceAnchor && traceId ? (
          <DeliveryTraceScreen
            deliveryId={traceId}
            anchor={traceAnchor}
            runtimeScope={runtimeScope}
            profile={profile}
            profileId={profile?.id}
            onBack={() => choose(null)}
            onExploreRuntime={onExploreRuntime}
            embedded
            backLabel="← Clear selection"
          />
        ) : (
          <p className="px-4 py-5 text-sm text-muted-foreground" data-testid="home-trace-placeholder">
            Select a delivery to inspect its trace.
          </p>
        ),
    },
  ];

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="home-screen">
      <WidgetBoard
        layout={layout}
        widgets={widgets}
        expandedId={expandedId}
        onExpandedChange={setExpandedId}
        pinnedId={pinnedId}
        onPinnedChange={setPinnedId}
        onMove={(id, delta) => updateLayout(moveWidget(layout, id, delta))}
        onToggleSpan={(id) => updateLayout(toggleWidgetSpan(layout, id))}
      />
    </main>
  );
}

function HomeSummaryStrip({ sections }: { sections: MyWorkSection[] }) {
  const countById = new Map(sections.map((section) => [section.id, section.rows.length]));

  return (
    <div
      className="grid grid-cols-4 divide-x divide-border border-b border-border"
      data-testid="home-summary-strip"
      role="list"
      aria-label="Delivery summary"
    >
      {SUMMARY_ITEMS.map((item) => (
        <div key={item.id} className="px-4 py-2.5" role="listitem">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {item.label}
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{countById.get(item.id) ?? 0}</p>
        </div>
      ))}
    </div>
  );
}

function HomeSection({
  section,
  selectedId,
  onSelect,
}: {
  section: MyWorkSection;
  selectedId: string | null;
  onSelect: (row: DeliveryListItem) => void;
}) {
  const headingId = `home-section-${section.id}`;
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="px-4 pt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
      >
        {section.title}
      </h2>
      <ul className="mt-1.5 divide-y divide-border border-y border-border" role="list">
        {section.rows.map((row: Delivery) => {
          const item = row as DeliveryListItem;
          return (
            <li key={row.id}>
              <DeliveryRow
                delivery={row}
                selected={selectedId === row.workId}
                onOpen={() => onSelect(item)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
