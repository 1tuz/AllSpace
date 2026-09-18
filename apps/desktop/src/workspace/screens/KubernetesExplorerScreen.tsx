import { useEffect, useRef, useState } from "react";
import {
  listContexts,
  listCrds,
  RESOURCE_LABELS,
  type ClusterContext,
  type CrdRef,
  type DevOpsProfile,
  type DevOpsRuntimeScope,
  type NewResourceDraft,
  type ResourceKind,
} from "@srelens/core";
import { Button, Combobox } from "../../ui";
import { Dock, type DockKind, type DockSession } from "../../components/Dock";
import { ResourceBrowser } from "../../components/ResourceBrowser";
import { HelmReleasesView } from "../../components/HelmReleasesView";
import { PortForwardsView } from "../../components/PortForwardsView";
import { CustomResourceBrowser } from "../../components/CustomResourceBrowser";
import { NewResourceEditor } from "../../components/NewResourceEditor";
import { EditResourceTab } from "../../components/EditResourceTab";
import {
  runtimeHandoffKey,
  type RuntimeHandoff,
} from "../runtimeHandoff";
import { contourKubeconfigPaths, contourPresetForProfile } from "../contours";

/** Browseable + special Classic surfaces Workspace hosts (mirror Sidebar NAV_SECTIONS; skip chrome kinds). */
const EXPLORER_BROWSER_KINDS: ResourceKind[] = [
  "pods",
  "deployments",
  "statefulsets",
  "daemonsets",
  "replicasets",
  "jobs",
  "cronjobs",
  "services",
  "endpoints",
  "endpointslices",
  "ingresses",
  "ingressclasses",
  "networkpolicies",
  "configmaps",
  "secrets",
  "resourcequotas",
  "limitranges",
  "horizontalpodautoscalers",
  "poddisruptionbudgets",
  "priorityclasses",
  "runtimeclasses",
  "leases",
  "mutatingwebhookconfigurations",
  "validatingwebhookconfigurations",
  "persistentvolumeclaims",
  "persistentvolumes",
  "storageclasses",
  "serviceaccounts",
  "roles",
  "rolebindings",
  "clusterroles",
  "clusterrolebindings",
  "namespaces",
  "nodes",
  "events",
];

const EXPLORER_SPECIAL = ["portforwards", "helmreleases", "customresources"] as const;
type ExplorerSpecial = (typeof EXPLORER_SPECIAL)[number];
type ExplorerKind = ResourceKind | ExplorerSpecial;

const SPECIAL_LABELS: Record<ExplorerSpecial, string> = {
  portforwards: "Port Forwards",
  helmreleases: "Helm Releases",
  customresources: "Custom Resources",
};

const EXPLORER_KINDS: ExplorerKind[] = [...EXPLORER_BROWSER_KINDS, ...EXPLORER_SPECIAL];

function isBrowserKind(kind: ExplorerKind): kind is ResourceKind {
  return (EXPLORER_BROWSER_KINDS as string[]).includes(kind);
}

function explorerKind(kind: string | undefined): ExplorerKind {
  if (kind && EXPLORER_KINDS.includes(kind as ExplorerKind)) return kind as ExplorerKind;
  return "deployments";
}

function kindLabel(kind: ExplorerKind): string {
  if (kind === "portforwards" || kind === "helmreleases" || kind === "customresources") {
    return SPECIAL_LABELS[kind];
  }
  return RESOURCE_LABELS[kind];
}

/** Prefer pods when handoff names a concrete pod; else workload kind. */
function handoffKind(focus: RuntimeHandoff): ExplorerKind {
  if (focus.pod) return "pods";
  return explorerKind(focus.kind);
}

type EditorPanel =
  | { mode: "new"; initialKind?: string; draft?: NewResourceDraft; namespace: string }
  | { mode: "edit"; kind: string; namespace: string | null; name: string; draft: string | null };

export function KubernetesExplorerScreen({
  focus,
  onRuntimeScopeChange,
  profile = null,
}: {
  focus: RuntimeHandoff | null;
  /** Remember Explorer context for Delivery live kube fan-out. */
  onRuntimeScopeChange?: (scope: DevOpsRuntimeScope | null) => void;
  /** Active DevOps profile — scopes kubeconfig files to the contour. */
  profile?: DevOpsProfile | null;
}) {
  const [contexts, setContexts] = useState<ClusterContext[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [kind, setKind] = useState<ExplorerKind>(() => (focus ? handoffKind(focus) : "deployments"));
  const [crd, setCrd] = useState<CrdRef | null>(null);
  const [crds, setCrds] = useState<CrdRef[] | null>(null);
  const [crdError, setCrdError] = useState("");
  const [editor, setEditor] = useState<EditorPanel | null>(null);
  const [dockSessions, setDockSessions] = useState<DockSession[]>([]);
  const [activeDock, setActiveDock] = useState<number | null>(null);
  const [dockHeight, setDockHeight] = useState(300);
  const [focusNonce, setFocusNonce] = useState(0);
  const [browserNamespace, setBrowserNamespace] = useState(() => focus?.namespace ?? "");
  const dockId = useRef(1);
  const appliedHandoff = useRef<string | null>(null);
  const contour = contourPresetForProfile(profile);
  const profileKey = profile?.id ?? "";

  useEffect(() => {
    let active = true;
    setContexts(null);
    setError("");
    const paths = contour ? contourKubeconfigPaths(contour) : [];
    void listContexts(paths, undefined, { replaceDefaults: Boolean(contour) })
      .then((outcome) => {
        if (!active) return;
        const list = outcome.contexts ?? [];
        setContexts(list);
        setError(outcome.error ?? "");
        // Keep a handoff / user pick across contour reload when it still exists.
        // Clearing eagerly on every profileKey tick dropped Explore focus before
        // the browser could mount (profiles hydrate after the handoff navigate).
        setSelected((prev) => (prev && list.some((c) => c.name === prev) ? prev : ""));
      })
      .catch((reason) => {
        if (!active) return;
        setContexts([]);
        setError(String(reason));
        setSelected("");
      });
    return () => {
      active = false;
    };
  }, [contour, profileKey]);

  useEffect(() => {
    if (!focus) return;
    const key = runtimeHandoffKey(focus);
    setSelected(focus.context);
    setKind(handoffKind(focus));
    setBrowserNamespace(focus.namespace ?? "");
    setFocusNonce((n) => n + 1);
    setEditor(null);
    onRuntimeScopeChange?.({
      kubeContext: focus.context,
      ...(focus.namespace.trim() ? { namespaces: [focus.namespace.trim()] } : {}),
    });

    if (focus.pod && appliedHandoff.current !== key) {
      appliedHandoff.current = key;
      const id = dockId.current++;
      setDockSessions((current) => [
        ...current,
        {
          id,
          kind: "logs",
          context: focus.context,
          namespace: focus.namespace,
          pod: focus.pod,
          ...(focus.container ? { container: focus.container } : {}),
        },
      ]);
      setActiveDock(id);
    }
  }, [focus, onRuntimeScopeChange]);

  useEffect(() => {
    if (kind !== "customresources" || !selected) {
      setCrds(null);
      setCrdError("");
      return;
    }
    let active = true;
    setCrds(null);
    setCrdError("");
    void listCrds(selected).then((out) => {
      if (!active) return;
      if (out.error) {
        setCrdError(out.error);
        setCrds([]);
      } else {
        setCrds(out.crds ?? []);
      }
    });
    return () => {
      active = false;
    };
  }, [kind, selected]);

  function selectContext(value: string) {
    setSelected(value);
    setEditor(null);
    setCrd(null);
    if (value) {
      onRuntimeScopeChange?.({ kubeContext: value });
    } else {
      onRuntimeScopeChange?.(null);
    }
  }

  function selectKind(value: string) {
    const next = explorerKind(value);
    setKind(next);
    setEditor(null);
    if (next !== "customresources") setCrd(null);
  }

  const options = (contexts ?? []).map((c) => ({ value: c.name, label: c.name }));
  const kindOptions = EXPLORER_KINDS.map((value) => ({ value, label: kindLabel(value) }));
  const crdOptions = (crds ?? []).map((c) => ({
    value: c.name,
    label: c.group ? `${c.kind} (${c.group})` : c.kind,
  }));
  const focusResourceName = focus?.pod && kind === "pods" ? focus.pod : focus?.name;
  const browserFocus =
    focus &&
    focus.context === selected &&
    isBrowserKind(kind) &&
    handoffKind(focus) === kind &&
    focusResourceName
      ? {
          name: focusResourceName,
          namespace: focus.namespace || null,
          nonce: focusNonce || 1,
        }
      : undefined;

  function openDock(kind: DockKind, session: Omit<DockSession, "id" | "kind">) {
    const id = dockId.current++;
    setDockSessions((current) => [...current, { id, kind, ...session }]);
    setActiveDock(id);
  }
  function closeDockTab(id: number) {
    setDockSessions((current) => {
      const remaining = current.filter((session) => session.id !== id);
      setActiveDock((active) => (active === id ? (remaining.at(-1)?.id ?? null) : active));
      return remaining;
    });
  }

  function openNewResource(initialKind?: string) {
    if (!selected) return;
    setEditor({
      mode: "new",
      initialKind,
      namespace: browserNamespace.split(",")[0]?.trim() || "default",
    });
  }

  function openEditResource(resourceKind: string, namespace: string | null, name: string) {
    if (!selected) return;
    setEditor({ mode: "edit", kind: resourceKind, namespace, name, draft: null });
  }

  const scopeBits = [focus?.profileId, focus?.pod, focus?.container].filter(Boolean);

  function renderClusterBody() {
    if (editor?.mode === "new") {
      return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="explorer-new-resource">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Button variant="ghost" size="sm" onClick={() => setEditor(null)}>
              Back
            </Button>
            <span className="text-sm text-muted-foreground">New resource</span>
          </div>
          <NewResourceEditor
            context={selected}
            namespace={editor.namespace}
            initialKind={editor.initialKind}
            draft={editor.draft}
            onDraftChange={(draft) => setEditor({ ...editor, draft })}
            onCreated={() => setEditor({ ...editor, draft: undefined })}
          />
        </div>
      );
    }
    if (editor?.mode === "edit") {
      return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="explorer-edit-resource">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Button variant="ghost" size="sm" onClick={() => setEditor(null)}>
              Back
            </Button>
            <span className="text-sm text-muted-foreground">
              Edit {editor.kind}/{editor.namespace ?? "—"}/{editor.name}
            </span>
          </div>
          <EditResourceTab
            context={selected}
            kind={editor.kind}
            namespace={editor.namespace}
            name={editor.name}
            draft={editor.draft}
            onDraftChange={(yaml) => setEditor({ ...editor, draft: yaml })}
            onEdited={() => setEditor({ ...editor, draft: null })}
          />
        </div>
      );
    }
    if (kind === "portforwards") {
      return (
        <div className="min-h-0 flex-1 overflow-auto" data-testid="explorer-port-forwards">
          <PortForwardsView context={selected} />
        </div>
      );
    }
    if (kind === "helmreleases") {
      return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="explorer-helm-releases">
          <HelmReleasesView
            context={selected}
            initialNamespace={browserNamespace}
            onNamespaceChange={setBrowserNamespace}
            openHelmDock={(s) =>
              openDock("helm", { context: s.context, namespace: s.namespace, helm: s.helm })
            }
          />
        </div>
      );
    }
    if (kind === "customresources") {
      return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="explorer-custom-resources">
          <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
            <Combobox
              ariaLabel="Custom resource definition"
              placeholder={crds === null ? "Loading CRDs…" : "Select a CRD"}
              options={crdOptions}
              value={crd?.name ?? ""}
              onValueChange={(name) => {
                const next = (crds ?? []).find((c) => c.name === name) ?? null;
                setCrd(next);
              }}
            />
          </div>
          {crdError && (
            <p role="alert" className="px-3 py-2 text-sm text-destructive">
              Failed to list CRDs: {crdError}
            </p>
          )}
          {crds && !crdError && crds.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">No CRDs in this cluster.</p>
          )}
          {crd ? (
            <CustomResourceBrowser context={selected} crd={crd} />
          ) : (
            !crdError &&
            crds &&
            crds.length > 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">Select a CRD to browse instances.</p>
            )
          )}
        </div>
      );
    }
    if (isBrowserKind(kind)) {
      return (
        <ResourceBrowser
          context={selected}
          kind={kind}
          sharedWatch
          focus={browserFocus}
          initialNamespace={browserNamespace}
          onNamespaceChange={setBrowserNamespace}
          onOpenTerminal={(session) => openDock("terminal", session)}
          onOpenLogs={(session) => openDock("logs", session)}
          onOpenWorkloadLogs={(session) =>
            openDock("logs", { ...session, workload: { kind: session.kind, name: session.name } })
          }
          onOpenEdit={openEditResource}
          onOpenNew={openNewResource}
        />
      );
    }
    return null;
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="kubernetes-explorer">
      <header className="border-b border-border px-6 py-5">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Kubernetes</p>
        <h1 className="mt-1 text-xl font-semibold">Explorer</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Secondary mode. Cluster selection is scoped to the active contour&apos;s kubeconfig
          files — not the shell&apos;s $KUBECONFIG or ~/.kube mix. AppFarm contexts use kubectl
          oidc-login: expired tokens open the system browser for Keycloak (often daily).
        </p>
        <div className="mt-4 flex max-w-2xl flex-wrap gap-2">
          <Combobox
            ariaLabel="Cluster context"
            placeholder={contexts === null ? "Loading contexts…" : "Select a context"}
            options={options}
            value={selected}
            onValueChange={selectContext}
          />
          <Combobox
            ariaLabel="Resource kind"
            placeholder="Resource kind"
            options={kindOptions}
            value={kind}
            onValueChange={selectKind}
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
        {scopeBits.length > 0 && (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="runtime-handoff-profile">
            {focus?.profileId ? (
              <>
                Profile: <span className="font-mono">{focus.profileId}</span>
              </>
            ) : null}
            {focus?.pod ? (
              <>
                {focus.profileId ? " · " : null}
                pod <span className="font-mono">{focus.pod}</span>
              </>
            ) : null}
            {focus?.container ? (
              <>
                {" · "}
                container <span className="font-mono">{focus.container}</span>
              </>
            ) : null}
          </p>
        )}
      </header>
      {selected ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {renderClusterBody()}
          {dockSessions.length > 0 && (
            <Dock
              sessions={dockSessions}
              activeId={activeDock}
              height={dockHeight}
              onActivate={setActiveDock}
              onCloseTab={closeDockTab}
              onClose={() => { setDockSessions([]); setActiveDock(null); }}
              onResize={setDockHeight}
            />
          )}
        </div>
      ) : (
        <div className="px-6 py-5">
          <p className="text-sm text-muted-foreground">Select a context to browse workloads, YAML, logs, and in-pod shells.</p>
        </div>
      )}
    </main>
  );
}
