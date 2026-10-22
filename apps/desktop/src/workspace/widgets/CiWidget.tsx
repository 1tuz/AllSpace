import { gitlabListPipelines, jenkinsListBuilds, type ProviderEntity } from "@srelens/core";
import { useWidgetQuery } from "./useWidgetQuery";
import { entityAttribute, EntityRow, WidgetMetric, WidgetMetrics, WidgetState } from "./WidgetParts";
import type { BoardSelection, WidgetSourceProps } from "./types";
import { ciSource, filtersFor, providerLabel } from "./providers";

const COMPACT_ROWS = 3;

const RUNNING = new Set(["building", "running", "pending", "created", "queued", "in_progress"]);
const FAILED = new Set(["failure", "failed", "error", "canceled", "cancelled", "aborted"]);
const PASSED = new Set(["success", "succeeded", "passed"]);

function group(status: string | null): "running" | "failed" | "passed" | "other" {
  const value = status?.toLowerCase() ?? "";
  if (RUNNING.has(value)) return "running";
  if (FAILED.has(value)) return "failed";
  if (PASSED.has(value)) return "passed";
  return "other";
}

function stamp(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const millis = Number(timestamp);
  if (!Number.isFinite(millis) || millis <= 0) return timestamp;
  const ageMinutes = Math.round((Date.now() - millis) / 60_000);
  if (ageMinutes < 1) return "just now";
  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  const hours = Math.round(ageMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * CI/CD widget: Jenkins builds or GitLab pipelines, whichever the profile
 * connects. A row becomes a shared selection only when it carries a commit —
 * a build with no revision would be an invented link.
 */
export function CiWidget({
  profile,
  profileId,
  selection,
  onSelect,
  variant = "compact",
}: WidgetSourceProps) {
  const source = ciSource(profile);
  const filters = source ? filtersFor(profile, source) : [];
  const query = useWidgetQuery({
    key: `${source ?? "none"}.runs`,
    profileId,
    enabled: source !== null && filters.length > 0,
    load: async (): Promise<ProviderEntity[]> => {
      if (source === "jenkins") {
        return (await jenkinsListBuilds(filters)).builds;
      }
      return (await gitlabListPipelines(filters)).entities;
    },
  });

  if (!source) {
    return (
      <WidgetState
        kind="unavailable"
        text="No CI connection in this profile. Add Jenkins or GitLab to see builds here."
      />
    );
  }
  if (filters.length === 0) {
    return (
      <WidgetState
        kind="unavailable"
        text={`${providerLabel(source)} is connected but this profile names no jobs or projects. Set a filter in Settings.`}
      />
    );
  }
  if (query.loading) return <WidgetState kind="loading" text="Loading builds…" />;
  if (query.error) {
    return <WidgetState kind="error" text={`${providerLabel(source)} did not answer: ${query.error}`} />;
  }

  const runs = query.data ?? [];
  if (runs.length === 0) {
    return (
      <WidgetState
        kind="empty"
        text={`${providerLabel(source)} answered with no builds for ${filters.join(", ")}.`}
      />
    );
  }

  const running = runs.filter((run) => group(entityAttribute(run, "status")) === "running").length;
  const failed = runs.filter((run) => group(entityAttribute(run, "status")) === "failed").length;

  const row = (run: ProviderEntity, verbose: boolean) => {
    const status = entityAttribute(run, "status");
    const sha = entityAttribute(run, "sha") ?? entityAttribute(run, "scmRevision");
    const job = entityAttribute(run, "jobPath");
    const number = entityAttribute(run, "buildNumber") ?? entityAttribute(run, "pipelineId");
    const ref = entityAttribute(run, "ref");
    const when = stamp(entityAttribute(run, "timestamp"));
    const next: BoardSelection | null = sha
      ? {
          anchor: { kind: "commit", value: sha, source },
          title: run.title,
          source: providerLabel(source),
        }
      : null;
    const selected =
      !!sha && selection?.anchor.kind === "commit" && selection.anchor.value === sha;
    const meta = [verbose ? job : null, ref, number ? `#${number}` : null, when]
      .filter(Boolean)
      .join(" · ");
    return (
      <EntityRow
        key={run.id}
        entity={run}
        status={status}
        meta={meta}
        selected={selected}
        onSelect={next ? () => onSelect(next) : undefined}
      />
    );
  };

  return (
    <div className="widget-body" data-widget-variant={variant}>
      <WidgetMetrics>
        <WidgetMetric label="Running" value={running} tone={running > 0 ? "notable" : "default"} />
        <WidgetMetric label="Failed" value={failed} tone={failed > 0 ? "loud" : "default"} />
        <WidgetMetric label="Recent" value={runs.length} />
      </WidgetMetrics>
      <div className={variant === "detail" ? "widget-detail-rows" : "widget-compact-rows"}>
        {(variant === "detail" ? runs : runs.slice(0, COMPACT_ROWS)).map((run) =>
          row(run, variant === "detail"),
        )}
      </div>
    </div>
  );
}
