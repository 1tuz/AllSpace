import { useState, type ReactNode } from "react";
import type { DeliveryAnchor, DevOpsProfile, DevOpsRuntimeScope } from "@srelens/core";
import type { Delivery } from "../model/deliveryTypes";
import { DeliveryRow } from "../delivery/DeliveryRow";
import { myWorkSections, type MyWorkSection } from "../delivery/myWorkSections";
import type { DeliveryListItem } from "../delivery/summaryToDelivery";
import { ScreenHeader } from "../components/ScreenHeader";
import { HomeMosaic, type HomeWidgetId } from "../components/HomeMosaic";
import { useLiveDeliveryList } from "../hooks/useLiveDeliveryList";
import { sourceLabel } from "../delivery/DeliveryStageRail";
import type { RuntimeHandoff } from "../runtimeHandoff";
import { DeliveryTraceScreen } from "./DeliveryTraceScreen";

const EMPTY_COPY =
  "Nothing needs attention right now. When deliveries arrive, they will show up here.";

const SUMMARY_ITEMS: Array<{ id: MyWorkSection["id"]; label: string }> = [
  { id: "needsAttention", label: "Attention" },
  { id: "inReview", label: "Review" },
  { id: "building", label: "Building" },
  { id: "delivered", label: "Delivered" },
];

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
  /** Optional deep-link (palette). Row click does not use this. */
  onOpenDelivery?: (id: string, anchor?: DeliveryAnchor) => void;
}) {
  const live = useLiveDeliveryList("myWork", profile);
  const sections: MyWorkSection[] = myWorkSections(live.rows);
  const [localSelected, setLocalSelected] = useState<DeliveryListItem | null>(null);
  const selectedItem = onSelect ? selected : localSelected;
  const setSelected = onSelect ?? setLocalSelected;
  const [maximizedId, setMaximizedId] = useState<HomeWidgetId | null>(null);

  const loading = live.loading;
  const hasSourceProblems = !!live.error || live.sourceErrors.length > 0;
  const failed = !loading && hasSourceProblems && sections.length === 0;
  const empty = !loading && !hasSourceProblems && sections.length === 0;
  const showLiveFailure = hasSourceProblems;

  let inbox: ReactNode;
  if (loading) {
    inbox = (
      <p className="px-4 py-4 text-sm text-muted-foreground" role="status" data-testid="home-live-loading">
        Loading deliveries…
      </p>
    );
  } else if (failed) {
    inbox = (
      <div className="flex flex-col px-4 py-4" data-testid="home-live-error">
        <p className="text-sm text-muted-foreground" role="status">
          My Work could not be loaded. This is not an empty inbox — see the source error above.
        </p>
      </div>
    );
  } else if (empty) {
    inbox = (
      <div
        className="flex flex-col px-4 py-4"
        style={{ gap: "var(--ws-section-gap)" }}
        data-testid="home-live-empty"
      >
        <p className="text-sm text-muted-foreground" role="status">
          {EMPTY_COPY}
        </p>
      </div>
    );
  } else {
    inbox = (
      <div className="flex flex-col" style={{ gap: "var(--ws-section-gap)" }}>
        {sections.map((section) => (
          <HomeSection
            key={section.id}
            section={section}
            selectedId={selectedItem?.id ?? null}
            onSelect={setSelected}
          />
        ))}
      </div>
    );
  }

  const sourceErrors =
    showLiveFailure ? (
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

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="home-screen">
      <ScreenHeader eyebrow="My Work" title="What needs attention" />
      <HomeMosaic
        maximizedId={maximizedId}
        onMaximizeChange={setMaximizedId}
        summary={
          <>
            {!loading && !failed ? <HomeSummaryStrip sections={sections} /> : null}
          </>
        }
        inbox={
          <>
            {sourceErrors}
            {inbox}
          </>
        }
        trace={
          selectedItem?.anchor ? (
            <DeliveryTraceScreen
              deliveryId={selectedItem.id}
              anchor={selectedItem.anchor}
              runtimeScope={runtimeScope}
              profile={profile}
              profileId={profile?.id}
              onBack={() => setSelected(null)}
              onExploreRuntime={onExploreRuntime}
              embedded
              backLabel="← Clear selection"
            />
          ) : (
            <p className="px-4 py-5 text-sm text-muted-foreground" data-testid="home-trace-placeholder">
              Select a delivery to inspect its trace.
            </p>
          )
        }
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
                selected={selectedId === row.id}
                onOpen={() => onSelect(item)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
