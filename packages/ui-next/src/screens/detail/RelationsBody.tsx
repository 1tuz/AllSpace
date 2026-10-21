import {
  ageSortValue,
  jobStatus,
  listJobs,
  podMetrics,
  podsForSelector,
  podStatus,
  relatedPodSelector,
  str,
  type JobSummary,
  type K8sObject,
  type PodMetric,
  type PodSummary,
  type ReplicaSetSummary,
} from "@srelens/core";
import { LoadingState, StatusPill, Table, type Column } from "@srelens/ui-kit";
import { AgeCell } from "../../lib/ageCell";
import { detailRoute } from "../../lib/detailRoute";
import { formatCpu, formatMemory } from "../../lib/kinds/columns";
import { openTab } from "../../lib/tabsStore";
import { hasSelector, selectorOf, type WorkloadSelector } from "../../lib/workloadSelector";
import { SELF_DESCRIBING_KINDS } from "./GenericBody";
import { Section } from "./Section";
import { SectionFailure, useSectionList } from "./sectionList";
import type { RevisionsState } from "./WorkloadBody";

/**
 * Object-scoped owner/owned links — classic's `WorkloadRelations`
 * (`DeployRevisions`, `ManagedPods`, `CronJobJobs`), as a pane of its own.
 *
 * Overview already draws the same tables for workloads that have them; this
 * pane is the design's dedicated Relations tab. Object-scoped Drill
 * (`DrillCard` Signal→Diagnose→Act) is a separate product surface — it needs
 * an incident feed, not Relations data, and is not classic K8s IDE parity.
 */

/** Pane id shared with {@link ResourceTabView}'s tab strip. */
export const PANE_RELATIONS = "relations";

/**
 * Whether this subject has anything Relations can show — the same kinds
 * classic's `WorkloadRelations` covered from ResourceOverview.
 */
export function kindOffersRelations(kind: string, object: K8sObject): boolean {
  if (kind === "Deployment" || kind === "CronJob") return true;
  if (kind === "StatefulSet" || kind === "ReplicaSet" || kind === "DaemonSet") {
    return hasSelector(selectorOf(object));
  }
  return Object.keys(relatedPodSelector(kind, object)).length > 0;
}

function RelationLink({
  label,
  ariaLabel,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  onClick?: () => void;
}) {
  if (!onClick) return <span className="font-mono">{label}</span>;
  return (
    <button
      type="button"
      className="font-mono text-left underline-offset-2 hover:underline"
      aria-label={ariaLabel}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

function openResource(context: string, kind: string, namespace: string | null, name: string) {
  openTab(detailRoute(kind, namespace, name), { clusterName: context });
}

function DeployRevisionsTable({
  context,
  namespace,
  state,
}: {
  context: string;
  namespace: string;
  state: RevisionsState;
}) {
  if (state.status === "idle") return null;
  const columns: Column<ReplicaSetSummary>[] = [
    { key: "revision", header: "#", render: (r) => <span className="font-mono">{r.revision || "—"}</span> },
    { key: "name", header: "Name", render: (r) => <span className="font-mono">{r.name}</span> },
    { key: "pods", header: "Pods", render: (r) => `${r.ready}/${r.desired}` },
    {
      key: "age",
      header: "Age",
      getSortValue: ageSortValue,
      render: (r) => <AgeCell created={r.created} age={r.age} />,
    },
  ];
  return (
    <Section title="Deploy Revisions">
      {state.status === "loading" ? (
        <LoadingState label="Loading revisions" />
      ) : state.status === "error" ? (
        <SectionFailure error={state.error} />
      ) : (
        <Table
          columns={columns}
          data={state.data ?? []}
          getRowKey={(r) => r.name}
          emptyText="No revisions"
          onRowClick={(row) => openResource(context, "ReplicaSet", namespace, row.name)}
        />
      )}
    </Section>
  );
}

type PodRow = PodSummary & { cpu?: number; memory?: number };

function ManagedPodsTable({
  context,
  namespace,
  selector,
}: {
  context: string;
  namespace: string;
  selector: WorkloadSelector;
}) {
  const selectorKey = JSON.stringify([selector.matchLabels, selector.matchExpressions]);
  const state = useSectionList<PodRow[]>(true, [context, namespace, selectorKey], async () => {
    const [podsOut, metricsOut] = await Promise.all([
      podsForSelector(context, namespace, selector.matchLabels, selector.matchExpressions),
      podMetrics(context, namespace).catch((): { metrics?: PodMetric[] } => ({ metrics: [] })),
    ]);
    if (podsOut.error) return { error: podsOut.error };
    const usage = new Map((metricsOut.metrics ?? []).map((m) => [m.name, m]));
    return {
      data: (podsOut.pods ?? []).map((p) => {
        const m = usage.get(p.name);
        return { ...p, cpu: m?.cpuMillicores, memory: m?.memoryMiB };
      }),
    };
  });

  const columns: Column<PodRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (pod) => (
        <RelationLink
          label={pod.name}
          ariaLabel={`Open Pod ${pod.name}`}
          onClick={() => openResource(context, "Pod", pod.namespace || namespace, pod.name)}
        />
      ),
    },
    {
      key: "node",
      header: "Node",
      render: (pod) => (
        <RelationLink
          label={pod.node || "—"}
          ariaLabel={`Open Node ${pod.node}`}
          onClick={
            pod.node ? () => openResource(context, "Node", null, pod.node) : undefined
          }
        />
      ),
    },
    { key: "ready", header: "Ready", render: (p) => p.ready },
    { key: "cpu", header: "CPU", render: (p) => (p.cpu != null ? formatCpu(p.cpu) : "—") },
    { key: "memory", header: "Memory", render: (p) => (p.memory != null ? formatMemory(p.memory) : "—") },
    {
      key: "status",
      header: "Status",
      render: (p) => {
        const status = podStatus(p);
        return <StatusPill status={status.status} kind={status.health} tinted />;
      },
    },
  ];

  return (
    <Section title="Pods">
      {state.status === "loading" ? (
        <LoadingState label="Loading pods" />
      ) : state.status === "error" ? (
        <SectionFailure error={state.error} />
      ) : (
        <Table
          columns={columns}
          data={state.data ?? []}
          getRowKey={(p) => p.name}
          emptyText="No pods"
          onRowClick={(pod) => openResource(context, "Pod", pod.namespace || namespace, pod.name)}
        />
      )}
    </Section>
  );
}

function RecentJobsTable({
  context,
  namespace,
  ownerName,
}: {
  context: string;
  namespace: string;
  ownerName: string;
}) {
  const state = useSectionList<JobSummary[]>(true, [context, namespace, ownerName], async () => {
    const out = await listJobs(context, namespace);
    return out.error
      ? { error: out.error }
      : { data: (out.jobs ?? []).filter((j) => j.owner === ownerName) };
  });

  const columns: Column<JobSummary>[] = [
    { key: "name", header: "Name", render: (j) => <span className="font-mono">{j.name}</span> },
    { key: "completions", header: "Completions", render: (j) => j.completions },
    {
      key: "status",
      header: "Status",
      render: (j) => {
        const { status, health } = jobStatus(j.failed, j.active);
        return <StatusPill status={status} kind={health} />;
      },
    },
    { key: "duration", header: "Duration", render: (j) => j.duration || "—" },
    {
      key: "age",
      header: "Age",
      getSortValue: ageSortValue,
      render: (j) => <AgeCell created={j.created} age={j.age} />,
    },
  ];

  return (
    <Section title="Recent Jobs">
      {state.status === "loading" ? (
        <LoadingState label="Loading jobs" />
      ) : state.status === "error" ? (
        <SectionFailure error={state.error} />
      ) : (
        <Table
          columns={columns}
          data={state.data ?? []}
          getRowKey={(j) => j.name}
          emptyText="No jobs yet"
          onRowClick={(row) => openResource(context, "Job", namespace, row.name)}
        />
      )}
    </Section>
  );
}

/**
 * The Relations pane body for one subject.
 *
 * `revisions` is the shared Deployment read from `useDetailSubject` — same
 * list Overview's Deploy Revisions table uses — so switching panes cannot
 * disagree about which ReplicaSet is current.
 */
export function RelationsBody({
  kind,
  object,
  context,
  revisions = { status: "idle" } satisfies RevisionsState as RevisionsState,
}: {
  kind: string;
  object: K8sObject;
  context: string;
  revisions?: RevisionsState;
}) {
  const namespace = str(object.metadata?.namespace);
  const name = str(object.metadata?.name);
  if (!context || !namespace || !name) return null;

  const workloadSelector = selectorOf(object);
  const selfDescribing = SELF_DESCRIBING_KINDS.has(kind);
  // Workloads that describe themselves use the full LabelSelector; everyone
  // else (DaemonSet, Service, Job, …) uses core's relatedPodSelector equality
  // half — the same split Overview already uses.
  const podsSelector: WorkloadSelector | null = selfDescribing
    ? hasSelector(workloadSelector)
      ? workloadSelector
      : null
    : (() => {
        const labels = relatedPodSelector(kind, object);
        return Object.keys(labels).length > 0
          ? { matchLabels: labels, matchExpressions: [] }
          : null;
      })();

  // DaemonSet is not self-describing, but selectorOf still reads its full
  // LabelSelector — prefer that when present so matchExpressions are not lost.
  const daemonSelector =
    kind === "DaemonSet" && hasSelector(workloadSelector) ? workloadSelector : null;
  const managedSelector = daemonSelector ?? podsSelector;

  return (
    <>
      {kind === "Deployment" && (
        <DeployRevisionsTable context={context} namespace={namespace} state={revisions} />
      )}
      {managedSelector && (
        <ManagedPodsTable context={context} namespace={namespace} selector={managedSelector} />
      )}
      {kind === "CronJob" && (
        <RecentJobsTable context={context} namespace={namespace} ownerName={name} />
      )}
    </>
  );
}
