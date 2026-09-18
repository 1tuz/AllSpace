import { useMemo, useState } from "react";
import type { DevOpsProfile } from "@srelens/core";
import { TextInput } from "../../ui";
import { DeliveryRow } from "../delivery/DeliveryRow";
import { ScreenHeader } from "../components/ScreenHeader";
import { useLiveDeliveryList } from "../hooks/useLiveDeliveryList";
import { sourceLabel } from "../delivery/DeliveryStageRail";
import type { DeliveryListItem } from "../delivery/summaryToDelivery";
import { DeliveryTraceScreen } from "./DeliveryTraceScreen";

export function DeliveriesScreen({
  profile,
  filter,
  onFilter,
}: {
  profile: DevOpsProfile | null;
  filter: string;
  onFilter: (value: string) => void;
}) {
  const live = useLiveDeliveryList("list", profile);
  const [selected, setSelected] = useState<DeliveryListItem | null>(null);

  const rows = useMemo(() => {
    const scoped: DeliveryListItem[] = live.rows;
    const q = filter.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (d) =>
        d.workId.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q) ||
        d.service.toLowerCase().includes(q) ||
        d.contour.toLowerCase().includes(q),
    );
  }, [filter, live.rows]);

  const loading = live.loading;
  const hasSourceProblems = !!live.error || live.sourceErrors.length > 0;
  const callFailed = hasSourceProblems && rows.length === 0;
  const liveEmpty =
    !loading &&
    !hasSourceProblems &&
    rows.length === 0 &&
    filter.trim() === "";
  const filterEmpty = !loading && !liveEmpty && !callFailed && rows.length === 0;
  const showErrors = hasSourceProblems;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="deliveries-screen">
      <ScreenHeader
        eyebrow="Deliveries"
        title="Browse deliveries"
        description={
          loading ? undefined : (
            <div className="mt-2 max-w-md">
              <TextInput
                aria-label="Filter deliveries"
                placeholder="Filter by work, service, contour…"
                value={filter}
                onValueChange={onFilter}
              />
            </div>
          )
        }
      />
      {loading ? (
        <p className="px-4 py-4 text-sm text-muted-foreground" role="status" data-testid="deliveries-live-loading">
          Loading deliveries…
        </p>
      ) : null}
      {showErrors ? (
        <div className="space-y-2 border-b border-border px-4 py-3" data-testid="deliveries-live-source-errors">
          {live.error ? (
            <p className="text-sm" role="alert">
              Could not load deliveries: {live.error}
            </p>
          ) : null}
          {live.partial && !live.error ? (
            <p className="text-sm text-muted-foreground" role="status">
              Partial results — some sources did not answer fully.
            </p>
          ) : null}
          {live.sourceErrors.map((err) => (
            <p key={`${err.source}:${err.message}`} className="text-sm">
              <span className="font-medium">{sourceLabel(err.source)}:</span> {err.message}
            </p>
          ))}
        </div>
      ) : null}
      {callFailed ? (
        <div className="px-4 py-4" data-testid="deliveries-live-error">
          <p className="text-sm text-muted-foreground" role="status">
            Deliveries could not be loaded. This is not an empty list — see the source error above.
          </p>
        </div>
      ) : liveEmpty ? (
        <div className="px-4 py-4" data-testid="deliveries-live-empty">
          <p className="text-sm text-muted-foreground" role="status">
            No deliveries to show yet. Connected providers will list work here when available.
          </p>
        </div>
      ) : filterEmpty ? (
        <div className="px-4 py-4" data-testid="deliveries-filter-empty">
          <p className="text-sm text-muted-foreground" role="status">
            No deliveries match this filter.
          </p>
        </div>
      ) : loading ? null : (
        <div className="flex min-h-0 flex-1" data-testid="deliveries-master-detail">
          <aside className="min-w-0 basis-[42%] overflow-auto border-r border-border">
            <ul className="divide-y divide-border border-t border-border" role="list" aria-label="Deliveries">
              {rows.map((row) => (
                <li key={row.id} data-selected={selected?.id === row.id || undefined}>
                  <DeliveryRow delivery={row} onOpen={() => setSelected(row)} />
                </li>
              ))}
            </ul>
          </aside>
          <section className="min-w-0 flex-1" aria-label="Delivery preview">
            {selected?.anchor ? (
              <DeliveryTraceScreen
                deliveryId={selected.id}
                anchor={selected.anchor}
                profile={profile}
                profileId={profile?.id}
                onBack={() => setSelected(null)}
                onExploreRuntime={() => {}}
              />
            ) : (
              <p className="px-4 py-5 text-sm text-muted-foreground">Select a delivery to inspect its trace.</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
