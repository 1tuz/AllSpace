import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { devopsTraceDelivery, listContexts, type ClusterContext, type DevOpsTrace } from "@srelens/core";
import { Button, Combobox, TextInput } from "../ui";
import { DevOpsSettingsSection } from "../components/DevOpsSettingsSection";
import {
  FIXTURE_CONNECTIONS,
  FIXTURE_DELIVERIES,
  deliveryById,
  homeSections,
  type Confidence,
  type Delivery,
  type TraceEdge,
  type TraceNode,
} from "./fixtures";
import { CONTOUR_PRESETS } from "./contours";
import { applyLiveTrace } from "./liveTrace";
import { WorkspacePalette, type PaletteAction } from "./WorkspacePalette";
import { runtimeHandoffFromAttrs, type RuntimeHandoff } from "./runtimeHandoff";
import {
  PRIMARY_NAV,
  SECONDARY_NAV,
  loadFirstRunDone,
  saveFirstRunDone,
  type WorkspaceRoute,
} from "./nav";

function confidenceLabel(confidence: Confidence): string {
  if (confidence === "exact") return "Exact";
  if (confidence === "strong") return "Strong";
  return "Heuristic";
}

function sourceLabel(source: string): string {
  switch (source) {
    case "jira":
      return "Jira";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    case "jenkins":
      return "Jenkins";
    case "kubernetes":
      return "Kubernetes";
    default:
      return source;
  }
}

function stageHeading(stage: TraceNode["stage"]): string {
  return stage.toUpperCase();
}

/** Delivery-first product shell. No global cluster selection. */
export function WorkspaceApp({
  onOpenClassicIde,
  initialRoute,
}: {
  onOpenClassicIde?: (target?: RuntimeHandoff) => void;
  initialRoute?: WorkspaceRoute;
} = {}) {
  const [route, setRoute] = useState<WorkspaceRoute>(() => {
    if (initialRoute) return initialRoute;
    return loadFirstRunDone() ? { name: "home" } : { name: "first-run" };
  });
  const [deliveryFilter, setDeliveryFilter] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);

  function openDelivery(id: string) {
    setRoute({ name: "delivery", id });
  }

  function finishFirstRun() {
    saveFirstRunDone();
    setRoute({ name: "connections" });
  }

  function onPaletteAction(action: PaletteAction) {
    if (action.kind === "delivery") {
      openDelivery(action.id);
      return;
    }
    setRoute({ name: action.route });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen min-h-0 bg-background text-foreground" data-testid="workspace-shell">
      <WorkspacePalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onAction={onPaletteAction} />
      <nav
        className="workspace-shell__rail flex w-52 shrink-0 flex-col border-r border-border bg-muted/30"
        aria-label="Workspace"
      >
        <div className="border-b border-border px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
          <p className="mt-1 text-sm font-semibold">DevOps</p>
          <button
            type="button"
            className="mt-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setPaletteOpen(true)}
          >
            Command palette ⌘K
          </button>
        </div>
        <ul className="flex flex-1 flex-col gap-0.5 p-2">
          {PRIMARY_NAV.map((item) => (
            <li key={item.id}>
              <NavButton
                label={item.label}
                active={route.name === item.id || (item.id === "deliveries" && route.name === "delivery")}
                onClick={() => setRoute({ name: item.id })}
              />
            </li>
          ))}
        </ul>
        <ul className="flex flex-col gap-0.5 border-t border-border p-2">
          {SECONDARY_NAV.map((item) => (
            <li key={item.id}>
              <NavButton label={item.label} active={route.name === item.id} onClick={() => setRoute({ name: item.id })} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {route.name === "first-run" && <FirstRunScreen onContinue={finishFirstRun} onSkip={() => { saveFirstRunDone(); setRoute({ name: "home" }); }} />}
        {route.name === "home" && <HomeScreen onOpenDelivery={openDelivery} />}
        {route.name === "deliveries" && (
          <DeliveriesScreen
            filter={deliveryFilter}
            onFilter={setDeliveryFilter}
            onOpenDelivery={openDelivery}
          />
        )}
        {route.name === "delivery" && (
          <DeliveryDetailScreen
            delivery={deliveryById(route.id)}
            onBack={() => setRoute({ name: "deliveries" })}
            onExploreRuntime={(target) => {
              if (onOpenClassicIde && target) {
                onOpenClassicIde(target);
                return;
              }
              setRoute({ name: "kubernetes" });
            }}
          />
        )}
        {route.name === "connections" && <ConnectionsScreen />}
        {route.name === "settings" && <SettingsScreen onOpenClassicIde={onOpenClassicIde} />}
        {route.name === "kubernetes" && <KubernetesExplorerScreen onOpenClassicIde={onOpenClassicIde} />}
      </div>
    </div>
  );
}

function NavButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-md px-3 py-2 text-left text-sm ${active ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"}`}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </button>
  );
}

function FirstRunScreen({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  return (
    <main className="flex flex-1 flex-col overflow-auto px-8 py-10" data-testid="first-run">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">First run</p>
      <h1 className="mt-2 text-2xl font-semibold">Set up your engineering workspace</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Connect the systems that move code into production. Cluster selection happens later, inside Kubernetes.
        Presets match sibling AppFarm / Komus repos (public URLs only).
      </p>
      <div className="mt-8 grid max-w-3xl gap-3">
        {CONTOUR_PRESETS.map((contour) => (
          <ContourCard key={contour.id} title={contour.label} detail={contour.summary} />
        ))}
        <ContourCard title="Custom" detail="Configure another contour" />
      </div>
      <div className="mt-8 flex gap-2">
        <Button onClick={onContinue}>Continue to Connections</Button>
        <Button variant="ghost" onClick={onSkip}>Explore fixtures first</Button>
      </div>
    </main>
  );
}

function ContourCard({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border border-border px-4 py-3">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function HomeScreen({ onOpenDelivery }: { onOpenDelivery: (id: string) => void }) {
  const sections = homeSections();
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="home-screen">
      <header className="border-b border-border px-6 py-5">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Home</p>
        <h1 className="mt-1 text-xl font-semibold">What needs attention</h1>
        <p className="mt-1 text-sm text-muted-foreground">No Kubernetes context required. Rows are delivery contexts, not clusters.</p>
      </header>
      <div className="flex flex-col gap-6 px-6 py-5">
        <HomeSection title="Needs attention" rows={sections.needsAttention} onOpen={onOpenDelivery} />
        <HomeSection title="In progress" rows={sections.inProgress} onOpen={onOpenDelivery} empty="Nothing in progress." />
        <HomeSection title="In review" rows={sections.inReview} onOpen={onOpenDelivery} empty="Nothing in review." />
        <HomeSection title="Building / deploying" rows={sections.building} onOpen={onOpenDelivery} />
        <HomeSection title="Recently delivered" rows={sections.delivered} onOpen={onOpenDelivery} empty="No recent deliveries in fixtures." />
      </div>
    </main>
  );
}

function HomeSection({
  title,
  rows,
  onOpen,
  empty = "None.",
}: {
  title: string;
  rows: Delivery[];
  onOpen: (id: string) => void;
  empty?: string;
}) {
  return (
    <section>
      <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border border border-border">
          {rows.map((row) => (
            <li key={row.id}>
              <DeliveryRow delivery={row} onOpen={() => onOpen(row.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeliveryRow({ delivery, onOpen }: { delivery: Delivery; onOpen: () => void }) {
  const loud = delivery.situations.find((s) => s.level === "loud") ?? delivery.situations[0];
  return (
    <button type="button" onClick={onOpen} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted/40">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          <span className="font-mono">{delivery.workId}</span> {delivery.title}
        </p>
        <p className="text-xs text-muted-foreground">{delivery.updated}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        {delivery.contour} · {delivery.service} · {delivery.stageLabel}
      </p>
      {loud && (
        <p className="text-xs">
          <span className="font-medium">{loud.level === "loud" ? "Loud" : loud.level === "notable" ? "Notable" : "Calm"}</span>
          {" — "}
          {loud.label}
        </p>
      )}
    </button>
  );
}

function DeliveriesScreen({
  filter,
  onFilter,
  onOpenDelivery,
}: {
  filter: string;
  onFilter: (value: string) => void;
  onOpenDelivery: (id: string) => void;
}) {
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return FIXTURE_DELIVERIES;
    return FIXTURE_DELIVERIES.filter(
      (d) =>
        d.workId.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q) ||
        d.service.toLowerCase().includes(q) ||
        d.contour.toLowerCase().includes(q),
    );
  }, [filter]);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="deliveries-screen">
      <header className="border-b border-border px-6 py-5">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Deliveries</p>
        <h1 className="mt-1 text-xl font-semibold">All delivery contexts</h1>
        <div className="mt-4 max-w-md">
          <TextInput aria-label="Filter deliveries" placeholder="Filter by work, service, contour…" value={filter} onValueChange={onFilter} />
        </div>
      </header>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id}>
            <DeliveryRow delivery={row} onOpen={() => onOpenDelivery(row.id)} />
          </li>
        ))}
      </ul>
    </main>
  );
}

function DeliveryDetailScreen({
  delivery,
  onBack,
  onExploreRuntime,
}: {
  delivery: Delivery | undefined;
  onBack: () => void;
  onExploreRuntime: (target?: RuntimeHandoff) => void;
}) {
  const [live, setLive] = useState<DevOpsTrace | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  useEffect(() => {
    if (!delivery) return;
    let cancelled = false;
    setLiveLoading(true);
    setLiveError(null);
    devopsTraceDelivery(delivery.workId)
      .then((trace) => {
        if (!cancelled) setLive(trace);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLive(null);
          setLiveError(error instanceof Error ? error.message : "live trace failed");
        }
      })
      .finally(() => {
        if (!cancelled) setLiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [delivery?.id, delivery?.workId]);

  if (!delivery) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
        <p className="text-sm text-muted-foreground">Delivery not found.</p>
        <Button variant="ghost" onClick={onBack}>Back to Deliveries</Button>
      </main>
    );
  }

  const view = live ? applyLiveTrace(delivery, live) : delivery;
  const runtime = view.nodes.find((n) => n.stage === "runtime");

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="delivery-detail">
      <header className="border-b border-border px-6 py-5">
        <Button variant="ghost" onClick={onBack}>← Deliveries</Button>
        <p className="mt-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Delivery trace</p>
        <h1 className="mt-1 text-xl font-semibold">
          <span className="font-mono">{view.workId}</span> {view.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {view.contour} · {view.service} · {view.stageLabel}
          {liveLoading ? " · refreshing live…" : live && live.nodes.length > 0 ? " · live" : " · fixture"}
        </p>
        {liveError && (
          <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            Live trace unavailable: {liveError}. Showing fixture.
          </p>
        )}
        {view.situations.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {view.situations.map((s) => (
              <li key={s.label} className="text-sm">
                <span className="font-medium">{s.level === "loud" ? "Loud" : s.level === "notable" ? "Notable" : "Calm"}</span>
                {" — "}
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="flex flex-col gap-4 px-6 py-5">
        {view.partial && (
          <p role="status" className="border-l-2 border-amber-500 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            Partial trace — one or more sources did not answer fully.
          </p>
        )}
        {view.sourceErrors.length > 0 && (
          <div className="divide-y divide-border border border-border" data-testid="source-errors">
            {view.sourceErrors.map((err) => (
              <p key={`${err.source}:${err.message}`} className="px-3 py-2 text-sm">
                <span className="font-medium">{sourceLabel(err.source)}:</span> {err.message}
              </p>
            ))}
          </div>
        )}

        <ol className="flex flex-col divide-y divide-border border border-border">
          {view.nodes.map((node, index) => {
            const incoming = view.edges.find((e) => e.to === node.id);
            return (
              <li key={node.id} className="px-4 py-4">
                {index > 0 && incoming && <EdgeMeta edge={incoming} />}
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {stageHeading(node.stage)} · {sourceLabel(node.source)} · {node.kind}
                </p>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{node.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {node.status} · {node.timestamp}
                    </p>
                  </div>
                  {node.url && (
                    <a className="text-muted-foreground" href={node.url} target="_blank" rel="noreferrer" aria-label={`Open ${node.title}`}>
                      <ExternalLink className="size-4" aria-hidden="true" />
                    </a>
                  )}
                </div>
                {node.stage === "runtime" && runtime && (
                  <div className="mt-3">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const target = runtimeHandoffFromAttrs(runtime.attributes);
                        onExploreRuntime(target ?? undefined);
                      }}
                    >
                      Explore in Kubernetes
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </main>
  );
}

function EdgeMeta({ edge }: { edge: TraceEdge }) {
  return (
    <div className="mb-3 flex flex-col gap-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <ArrowRight className="size-3" aria-hidden="true" />
        <span>{edge.relation}</span>
        <span aria-label={`confidence ${edge.confidence}`}>· {confidenceLabel(edge.confidence)}</span>
      </div>
      {edge.evidence.map((ev) => (
        <p key={`${ev.kind}:${ev.detail}`} className="font-mono pl-5">
          {ev.kind}: {ev.detail}
        </p>
      ))}
    </div>
  );
}

function ConnectionsScreen() {
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="connections-screen">
      <header className="border-b border-border px-6 py-5">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Connections</p>
        <h1 className="mt-1 text-xl font-semibold">Contours</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Public endpoints below. Store Jira/GitLab/Bitbucket/Jenkins secrets in Settings (encrypted vault)
          after unlock — never returned to React. Smoke:{" "}
          <span className="font-mono text-xs">srelens devops jira search AFS-…</span>
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
                  {" · env "}
                  <span className="font-mono">{p.envKeys.join(", ")}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">creds: {contour.credentialEnvFile}</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              kube: {contour.kubeconfigDir}/[{contour.kubeconfigHints.slice(0, 3).join(", ")}…]
            </p>
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-6 py-4">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Fixture status (demo)</p>
        <ul className="mt-2 divide-y divide-border border border-border">
          {FIXTURE_CONNECTIONS.map((c) => (
            <li key={`${c.contour}:${c.provider}`} className="px-3 py-2 text-sm">
              <span className="font-medium">{c.contour} · {c.provider}</span>
              {" — "}
              <span className="text-muted-foreground">{c.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

function SettingsScreen({ onOpenClassicIde }: { onOpenClassicIde?: (target?: RuntimeHandoff) => void }) {
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="settings-screen">
      <header className="border-b border-border px-6 py-5">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Settings</p>
        <h1 className="mt-1 text-xl font-semibold">Workspace</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Unlock the vault at launch (password / biometric), then store connector credentials below.
          Values go into the encrypted vault and are never read back into React.
        </p>
      </header>
      <div className="flex flex-col gap-8 px-6 py-5">
        <DevOpsSettingsSection />
        <section className="max-w-2xl border-t border-border pt-5">
          <h2 className="text-sm font-semibold">Kubernetes OIDC (AppFarm)</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            AppFarm kubeconfigs use <span className="font-mono text-xs">kubectl oidc-login</span>. When the
            token expires (often daily), the next API call opens the system browser for Keycloak login —
            same as bare kubectl. That is the exec plugin, not DevOps vault credentials. Keep
            <span className="font-mono text-xs"> kubectl</span> / oidc-login on PATH (desktop already
            repairs login-shell PATH at startup).
          </p>
        </section>
        {onOpenClassicIde && (
          <div>
            <Button variant="ghost" onClick={onOpenClassicIde}>
              Open classic Kubernetes IDE
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

function KubernetesExplorerScreen({ onOpenClassicIde }: { onOpenClassicIde?: (target?: RuntimeHandoff) => void }) {
  const [contexts, setContexts] = useState<ClusterContext[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");

  useEffect(() => {
    let active = true;
    void listContexts([])
      .then((outcome) => {
        if (!active) return;
        setContexts(outcome.contexts ?? []);
        setError(outcome.error ?? "");
      })
      .catch((reason) => {
        if (!active) return;
        setContexts([]);
        setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  const options = (contexts ?? []).map((c) => ({ value: c.name, label: c.name }));

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="kubernetes-explorer">
      <header className="border-b border-border px-6 py-5">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Kubernetes</p>
        <h1 className="mt-1 text-xl font-semibold">Explorer</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Secondary mode. Cluster selection lives here — not as global app state. AppFarm contexts use
          kubectl oidc-login: expired tokens open the system browser for Keycloak (often daily).
        </p>
        <div className="mt-4 max-w-md">
          <Combobox
            ariaLabel="Cluster context"
            placeholder={contexts === null ? "Loading contexts…" : "Select a context"}
            options={options}
            value={selected}
            onValueChange={setSelected}
          />
        </div>
        {error && (
          <p role="alert" className="mt-3 border-l-2 border-destructive px-3 py-2 text-sm text-destructive">
            Failed to list contexts: {error}
          </p>
        )}
        {contexts && !error && contexts.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">No kubeconfig contexts found. That is an empty result, not a failed call.</p>
        )}
        {selected && <p className="mt-3 text-sm">Selected context: <span className="font-mono">{selected}</span></p>}
      </header>
      <div className="px-6 py-5">
        <p className="text-sm text-muted-foreground">
          Full resource browsers mount here later. Delivery Trace → Explore opens the classic IDE focused on the
          runtime workload (Deployments / Logs / Shell / YAML via that surface).
        </p>
        {onOpenClassicIde && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => onOpenClassicIde()}>
              Open classic IDE{selected ? ` (then pick ${selected})` : ""}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
