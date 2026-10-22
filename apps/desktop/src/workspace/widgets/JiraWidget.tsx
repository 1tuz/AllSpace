import { jiraSearchIssues } from "@srelens/core";
import { useWidgetQuery } from "./useWidgetQuery";
import { entityAttribute, EntityRow, WidgetMetric, WidgetMetrics, WidgetState } from "./WidgetParts";
import type { BoardSelection, WidgetSourceProps } from "./types";
import { hasProvider } from "./providers";

const COMPACT_ROWS = 3;

function issueKey(entityId: string, attributes?: Record<string, unknown>): string {
  const key = attributes?.key;
  if (typeof key === "string" && key) return key;
  return entityId.replace(/^jira:issue:/, "");
}

/**
 * Jira widget: the profile's recently updated issues. Compact shows the load
 * and three rows; expanded shows status, assignee and project for each.
 */
export function JiraWidget({
  profile,
  profileId,
  selection,
  onSelect,
  variant = "compact",
}: WidgetSourceProps) {
  const configured = hasProvider(profile, "jira");
  const query = useWidgetQuery({
    key: "jira.recent.20",
    profileId,
    enabled: configured,
    load: () => jiraSearchIssues({ limit: 20 }),
  });

  if (!configured) {
    return (
      <WidgetState
        kind="unavailable"
        text="Jira is not configured in this profile. Add a connection to see issues here."
      />
    );
  }
  if (query.loading) return <WidgetState kind="loading" text="Loading Jira issues…" />;
  if (query.error) {
    return <WidgetState kind="error" text={`Jira did not answer: ${query.error}`} />;
  }

  const issues = query.data?.issues ?? [];
  if (issues.length === 0) {
    return <WidgetState kind="empty" text="Jira answered with no recent issues." />;
  }

  const unassigned = issues.filter((issue) => !entityAttribute(issue, "assignee")).length;
  const projects = new Set(
    issues.map((issue) => entityAttribute(issue, "projectKey")).filter(Boolean) as string[],
  );

  const row = (issue: (typeof issues)[number], verbose: boolean) => {
    const key = issueKey(issue.id, issue.attributes);
    const assignee = entityAttribute(issue, "assignee");
    const selected = selection?.anchor.kind === "issue" && selection.anchor.value === key;
    const next: BoardSelection = {
      anchor: { kind: "issue", value: key, source: "jira" },
      title: issue.title,
      source: "Jira",
    };
    const meta = verbose
      ? [entityAttribute(issue, "projectKey"), assignee, key].filter(Boolean).join(" · ")
      : [assignee, key].filter(Boolean).join(" · ");
    return (
      <EntityRow
        key={issue.id}
        entity={issue}
        status={entityAttribute(issue, "status")}
        meta={meta}
        selected={selected}
        onSelect={() => onSelect(next)}
      />
    );
  };

  return (
    <div className="widget-body" data-widget-variant={variant}>
      <WidgetMetrics>
        <WidgetMetric label="Recent" value={issues.length} />
        <WidgetMetric
          label="Unassigned"
          value={unassigned}
          tone={unassigned > 0 ? "notable" : "default"}
        />
        <WidgetMetric label="Projects" value={projects.size} />
      </WidgetMetrics>
      <div className={variant === "detail" ? "widget-detail-rows" : "widget-compact-rows"}>
        {(variant === "detail" ? issues : issues.slice(0, COMPACT_ROWS)).map((issue) =>
          row(issue, variant === "detail"),
        )}
      </div>
    </div>
  );
}
