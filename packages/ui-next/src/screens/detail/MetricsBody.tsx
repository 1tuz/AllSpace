import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  asRecord,
  nodeMetrics,
  podMetrics,
  podsForSelector,
  str,
  type K8sObject,
} from "@srelens/core";
import { Button, EmptyState, Sparkline } from "@srelens/ui-kit";
import { Section } from "./Section";
import type { RevisionsState } from "./WorkloadBody";

interface Sample {
  t: number;
  cpu: number;
  mem: number;
}

/** Kinds that can show a metrics timeline. Workload kinds aggregate their pods. */
type MetricsKind = "Pod" | "Node" | "Deployment" | "StatefulSet" | "DaemonSet" | "ReplicaSet" | "Job";

const WORKLOAD_KINDS: readonly MetricsKind[] = [
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "ReplicaSet",
  "Job",
];

const isWorkload = (kind: string): kind is MetricsKind =>
  (WORKLOAD_KINDS as readonly string[]).includes(kind);

type MetricsRange = "5m" | "10m" | "30m" | "1h";

// Each range picks a sampling cadence that keeps the series near ~30 points.
// metrics-server only reports the current value, so the window fills over time.
const RANGES: { id: MetricsRange; label: string; windowMs: number; intervalMs: number }[] = [
  { id: "5m", label: "5m", windowMs: 5 * 60_000, intervalMs: 10_000 },
  { id: "10m", label: "10m", windowMs: 10 * 60_000, intervalMs: 20_000 },
  { id: "30m", label: "30m", windowMs: 30 * 60_000, intervalMs: 60_000 },
  { id: "1h", label: "1h", windowMs: 60 * 60_000, intervalMs: 120_000 },
];

function sumMetrics(rows: { cpuMillicores: number; memoryMiB: number }[]): { cpu: number; mem: number } {
  return rows.reduce((acc, m) => ({ cpu: acc.cpu + m.cpuMillicores, mem: acc.mem + m.memoryMiB }), {
    cpu: 0,
    mem: 0,
  });
}

/**
 * Label selector a workload controller matches its pods by — classic's source.
 * Kept local (not `selectorOf`): metrics still query `matchLabels` only, and
 * `selectorOf` also surfaces `matchExpressions` with a different empty shape.
 */
function workloadMatchLabels(object: K8sObject): Record<string, string> | undefined {
  const matchLabels = asRecord(asRecord(object.spec).selector).matchLabels;
  if (!matchLabels || typeof matchLabels !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(matchLabels as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Live CPU/memory timeline for a Pod, Node, or workload controller — port of
 * classic `MetricsPanel` onto ui-kit. Metrics Server only reports the current
 * value, so we poll and build the series over time. Workloads sum pod usage
 * matched by `spec.selector.matchLabels`.
 *
 * The *Fn props are injectable for testing.
 */
export function MetricsBody({
  kind,
  object,
  context,
  intervalMs,
  range: initialRange = "5m",
  podMetricsFn = podMetrics,
  nodeMetricsFn = nodeMetrics,
  podsForSelectorFn = podsForSelector,
}: {
  kind: string;
  object: K8sObject;
  context: string;
  /** Required by the pane-body table; unused here. */
  revisions?: RevisionsState;
  intervalMs?: number;
  range?: MetricsRange;
  podMetricsFn?: typeof podMetrics;
  nodeMetricsFn?: typeof nodeMetrics;
  podsForSelectorFn?: typeof podsForSelector;
}): ReactNode {
  const name = str(object.metadata?.name);
  const namespace = str(object.metadata?.namespace) || null;
  const selector = isWorkload(kind) ? workloadMatchLabels(object) : undefined;

  const [range, setRange] = useState<MetricsRange>(initialRange);
  const [series, setSeries] = useState<Sample[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "unavailable">("loading");
  const gotData = useRef(false);

  const cfg = RANGES.find((r) => r.id === range) ?? RANGES[0];
  const effectiveInterval = intervalMs ?? cfg.intervalMs;
  const selectorKey = JSON.stringify(selector ?? null);

  useEffect(() => {
    let active = true;
    gotData.current = false;
    setSeries([]);
    setStatus("loading");

    async function sample(): Promise<{ cpu: number; mem: number } | null> {
      if (kind === "Node") {
        const out = await nodeMetricsFn(context);
        const m = out.metrics?.find((x) => x.name === name);
        return m ? { cpu: m.cpuMillicores, mem: m.memoryMiB } : null;
      }
      if (kind === "Pod") {
        const out = await podMetricsFn(context, namespace ?? "");
        const m = out.metrics?.find((x) => x.name === name);
        return m ? { cpu: m.cpuMillicores, mem: m.memoryMiB } : null;
      }
      if (!selector || Object.keys(selector).length === 0) return null;
      const ns = namespace ?? "";
      const [podsOut, metricsOut] = await Promise.all([
        podsForSelectorFn(context, ns, selector),
        podMetricsFn(context, ns),
      ]);
      const metrics = metricsOut.metrics ?? [];
      if (metrics.length === 0) return null;
      const names = new Set((podsOut.pods ?? []).map((p) => p.name));
      return sumMetrics(metrics.filter((m) => names.has(m.name)));
    }

    async function tick() {
      const s = await sample();
      if (!active) return;
      if (s === null) {
        // A transient miss shouldn't wipe an existing series; only show empty
        // if we've never received a sample.
        if (!gotData.current) setStatus("unavailable");
        return;
      }
      gotData.current = true;
      setStatus("ok");
      const now = Date.now();
      setSeries((prev) =>
        [...prev, { t: now, cpu: s.cpu, mem: s.mem }].filter((x) => now - x.t <= cfg.windowMs),
      );
    }

    void tick();
    const timer = setInterval(() => void tick(), effectiveInterval);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    kind,
    context,
    namespace,
    name,
    selectorKey,
    effectiveInterval,
    cfg.windowMs,
    podMetricsFn,
    nodeMetricsFn,
    podsForSelectorFn,
  ]);

  const rangePicker = (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Metrics time range">
      {RANGES.map((r) => (
        <Button
          key={r.id}
          type="button"
          variant="ghost"
          size="xs"
          aria-pressed={range === r.id}
          onClick={() => setRange(r.id)}
        >
          {r.label}
        </Button>
      ))}
    </div>
  );

  // Sole content of the Metrics pane — defaultOpen so the tab is not a caret
  // over an empty fold (same rule as PodContainersBody's Containers block).
  if (status === "unavailable") {
    return (
      <Section title="Metrics" defaultOpen>
        <div className="flex flex-col gap-3">
          {rangePicker}
          <EmptyState
            compact
            title="No metrics available"
            hint="The cluster needs the Kubernetes Metrics Server."
          />
        </div>
      </Section>
    );
  }

  const latest = series[series.length - 1];
  const cores = latest ? (latest.cpu / 1000).toFixed(3) : "—";

  return (
    <Section title="Metrics" defaultOpen>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-[0.75rem] text-muted">
            {isWorkload(kind) ? "Aggregated across pods · " : ""}
            Live from the Kubernetes Metrics Server
          </p>
          {rangePicker}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[0.8125rem] font-medium">CPU</span>
            <span className="num text-[0.8125rem]">{latest ? `${cores} cores` : "—"}</span>
          </div>
          <Sparkline points={series.map((s) => s.cpu)} tone="accent" ariaLabel="CPU usage" />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[0.8125rem] font-medium">Memory</span>
            <span className="num text-[0.8125rem]">{latest ? `${latest.mem} MiB` : "—"}</span>
          </div>
          <Sparkline points={series.map((s) => s.mem)} tone="info" ariaLabel="Memory usage" />
        </div>
      </div>
    </Section>
  );
}
