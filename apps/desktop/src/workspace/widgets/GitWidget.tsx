import { bitbucketListPullRequests, gitlabListMergeRequests, type ProviderEntity } from "@srelens/core";
import { useWidgetQuery } from "./useWidgetQuery";
import { entityAttribute, EntityRow, WidgetMetric, WidgetMetrics, WidgetState } from "./WidgetParts";
import type { BoardSelection, WidgetSourceProps } from "./types";
import { filtersFor, gitSource, providerLabel } from "./providers";

const COMPACT_ROWS = 3;

function isOpen(state: string | null): boolean {
  const value = state?.toLowerCase() ?? "";
  return value === "opened" || value === "open";
}

function isMerged(state: string | null): boolean {
  return (state?.toLowerCase() ?? "") === "merged";
}

/**
 * Git widget: merge/pull requests for the projects the profile names. No
 * project filter is not "all projects" — that would scan a whole server.
 */
export function GitWidget({
  profile,
  profileId,
  selection,
  onSelect,
  variant = "compact",
}: WidgetSourceProps) {
  const source = gitSource(profile);
  const filters = source ? filtersFor(profile, source) : [];
  const query = useWidgetQuery({
    key: `${source ?? "none"}.requests`,
    profileId,
    enabled: source !== null && filters.length > 0,
    load: async (): Promise<{ requests: ProviderEntity[]; projects: string[] }> => {
      if (source === "gitlab") {
        const result = await gitlabListMergeRequests(filters);
        return { requests: result.mergeRequests, projects: result.projects };
      }
      const result = await bitbucketListPullRequests(filters);
      return { requests: result.pullRequests, projects: result.projects };
    },
  });

  if (!source) {
    return (
      <WidgetState
        kind="unavailable"
        text="No Git connection in this profile. Add GitLab or Bitbucket to see changes here."
      />
    );
  }
  if (filters.length === 0) {
    return (
      <WidgetState
        kind="unavailable"
        text={`${providerLabel(source)} is connected but this profile names no projects. Set a project filter in Settings.`}
      />
    );
  }
  if (query.loading) return <WidgetState kind="loading" text="Loading merge requests…" />;
  if (query.error) {
    return <WidgetState kind="error" text={`${providerLabel(source)} did not answer: ${query.error}`} />;
  }

  const requests = query.data?.requests ?? [];
  if (requests.length === 0) {
    return (
      <WidgetState
        kind="empty"
        text={`${providerLabel(source)} answered with no merge requests for ${filters.join(", ")}.`}
      />
    );
  }

  const open = requests.filter((request) => isOpen(entityAttribute(request, "state"))).length;
  const merged = requests.filter((request) => isMerged(entityAttribute(request, "state"))).length;
  const label = source === "gitlab" ? "MR" : "PR";

  const row = (request: ProviderEntity, verbose: boolean) => {
    const number =
      entityAttribute(request, "iid") ?? entityAttribute(request, "pullRequestId") ?? request.id;
    const state = entityAttribute(request, "state");
    const from = entityAttribute(request, "sourceBranch") ?? entityAttribute(request, "fromBranch");
    const to = entityAttribute(request, "targetBranch") ?? entityAttribute(request, "toBranch");
    const project = entityAttribute(request, "projectKey");
    const selected =
      selection?.anchor.kind === "pullRequest" && selection.anchor.value === number;
    const next: BoardSelection = {
      anchor: { kind: "pullRequest", value: number, source },
      title: request.title,
      source: providerLabel(source),
    };
    const meta = [verbose ? project : null, from && to ? `${from} → ${to}` : (from ?? to), `${label} ${number}`]
      .filter(Boolean)
      .join(" · ");
    return (
      <EntityRow
        key={request.id}
        entity={request}
        status={state}
        meta={meta}
        selected={selected}
        onSelect={() => onSelect(next)}
      />
    );
  };

  return (
    <div className="widget-body" data-widget-variant={variant}>
      <WidgetMetrics>
        <WidgetMetric label="Open" value={open} tone={open > 0 ? "notable" : "default"} />
        <WidgetMetric label="Merged" value={merged} />
        <WidgetMetric label="Projects" value={query.data?.projects.length ?? 0} />
      </WidgetMetrics>
      <div className={variant === "detail" ? "widget-detail-rows" : "widget-compact-rows"}>
        {(variant === "detail" ? requests : requests.slice(0, COMPACT_ROWS)).map((request) =>
          row(request, variant === "detail"),
        )}
      </div>
    </div>
  );
}
