import { useCallback, useEffect, useState } from "react";
import { Button } from "../../ui";
import { CONTOUR_PRESETS } from "../contours";
import {
  healthKindLabel,
  loadConnectionHealth,
  type ConnectionHealthKind,
  type ProviderHealthRow,
} from "../connectionHealth";

function kindTone(kind: ConnectionHealthKind): string {
  switch (kind) {
    case "ok":
    case "valid_empty":
    case "credential_configured":
      return "text-foreground";
    case "credential_missing":
    case "loading":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}

export function ConnectionsScreen() {
  const [rows, setRows] = useState<ProviderHealthRow[]>([]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    setStatusError(null);
    void loadConnectionHealth({}).then((out) => {
      setRows(out.rows);
      setStatusError(out.statusError);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="connections-screen">
      <header className="border-b border-border px-6 py-5">
        <div className="flex items-baseline gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Connections</p>
        </div>
        <h1 className="mt-1 text-xl font-semibold">Contours</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Public endpoints are shown here. Each provider is optional: connect only what this contour uses.
          Credentials are stored encrypted through Settings.
        </p>
      </header>
      <ul className="divide-y divide-border">
        {CONTOUR_PRESETS.map((contour) => (
          <li key={contour.id} className="px-6 py-4">
            <p className="text-sm font-medium">{contour.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{contour.summary}</p>
            <ul className="mt-3 space-y-1 text-xs">
              {contour.providers.map((p) => (
                <li key={p.provider}>
                  <span className="font-medium">{p.label}</span>
                  {" · "}
                  <span className="font-mono">{p.baseUrl}</span>
                  {" · optional"}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Add credentials in Settings only for providers you want to connect.
            </p>
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Live health
          </p>
          <Button variant="ghost" size="xs" onClick={refresh} data-testid="connections-health-retry">
            Retry
          </Button>
        </div>
        {loading && (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="connections-health-loading">
            Checking…
          </p>
        )}
        {!loading && statusError && (
          <p className="mt-2 text-sm" data-testid="connections-health-status-error" role="status">
            {statusError}
          </p>
        )}
        {!loading && !statusError && rows.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="connections-health-empty-profiles">
            No providers on saved profiles yet. Apply an AppFarm or Komus preset in Settings, then store
            credentials.
          </p>
        )}
        {!loading && !statusError && rows.length > 0 && (
          <ul className="mt-2 divide-y divide-border border border-border" data-testid="connections-health-list">
            {rows.map((row) => (
              <li
                key={`${row.profileId}:${row.provider}`}
                className="px-3 py-2 text-sm"
                data-testid={`connections-health-${row.profileId}-${row.provider}`}
                data-health-kind={row.kind}
              >
                <span className="font-medium">
                  {row.profileLabel} · {row.providerLabel}
                </span>
                {" — "}
                <span className={kindTone(row.kind)}>{healthKindLabel(row.kind)}</span>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{row.baseUrl}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
