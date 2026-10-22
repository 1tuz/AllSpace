import { useEffect, useState } from "react";
import {
  devopsTraceDelivery,
  type DevOpsProfile,
  type DevOpsRuntimeScope,
  type DevOpsTrace,
} from "@srelens/core";
import type { BoardSelection } from "./types";
import { WidgetState } from "./WidgetParts";

const STAGES: Array<{ key: string; label: string }> = [
  { key: "work", label: "Work" },
  { key: "change", label: "Change" },
  { key: "build", label: "Build" },
  { key: "artifact", label: "Artifact" },
  { key: "deployment", label: "Deploy" },
  { key: "runtime", label: "Runtime" },
];

function stageOf(kind: string): string {
  const value = kind.toLowerCase();
  if (value.includes("issue") || value.includes("work")) return "work";
  if (value.includes("pull") || value.includes("merge") || value.includes("commit") || value.includes("branch"))
    return "change";
  if (value.includes("build") || value.includes("pipeline")) return "build";
  if (value.includes("artifact") || value.includes("image")) return "artifact";
  if (value.includes("deployment")) return "deployment";
  return "runtime";
}

/**
 * Compact Trace: one line per link of the chain, from the live trace for the
 * shared selection. A stage with no node stays empty — the chain does not
 * invent a link, and source failures are counted, not hidden.
 */
export function TraceSummary({
  selection,
  profile,
  runtimeScope,
}: {
  selection: BoardSelection | null;
  profile: DevOpsProfile | null;
  runtimeScope?: DevOpsRuntimeScope | null;
}) {
  const [trace, setTrace] = useState<DevOpsTrace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTrace(null);
    setError(null);
    if (!selection) return;
    let cancelled = false;
    devopsTraceDelivery(selection.anchor, runtimeScope ?? undefined, {
      ...(profile?.id ? { profileId: profile.id } : {}),
    })
      .then((next) => {
        if (!cancelled) setTrace(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [selection?.anchor.kind, selection?.anchor.value, profile?.id, runtimeScope]);

  if (!selection) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="home-trace-summary">
        Select an issue, change or cluster to trace it end to end.
      </p>
    );
  }

  const counts = new Map<string, number>();
  for (const node of trace?.nodes ?? []) {
    const stage = stageOf(node.kind);
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col" data-testid="home-trace-summary">
      <p className="truncate px-4 pt-2 text-xs font-medium">
        <span className="text-muted-foreground">{selection.source} · </span>
        {selection.title}
      </p>
      {error ? (
        <WidgetState kind="error" text={`Trace unavailable: ${error}`} />
      ) : trace === null ? (
        <WidgetState kind="loading" text="Resolving the chain…" />
      ) : (
        <>
          <div className="widget-metrics" role="list" aria-label="Delivery chain">
            {STAGES.map((stage) => (
              <div className="widget-metric" role="listitem" key={stage.key}>
                <p className="widget-metric__label">{stage.label}</p>
                <p
                  className="widget-metric__value tabular-nums"
                  data-testid={`trace-stage-${stage.key}`}
                  data-empty={counts.get(stage.key) ? "false" : "true"}
                >
                  {counts.get(stage.key) ?? 0}
                </p>
              </div>
            ))}
          </div>
          {trace.sourceErrors.length > 0 ? (
            <p className="px-4 py-1.5 text-[11px] text-muted-foreground" role="status">
              {trace.partial ? "Partial chain — " : ""}
              {trace.sourceErrors.length} source{trace.sourceErrors.length === 1 ? "" : "s"} did not
              answer: {trace.sourceErrors.map((err) => err.source).join(", ")}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
