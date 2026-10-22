import { invokeCapability, type Invoker } from "../transport/transport";

/**
 * Provider entity as the adapters return it (`crates/devops-model::Entity`).
 * Attributes are provider-shaped: never assume a key exists.
 */
export type ProviderEntity = {
  id: string;
  kind: string;
  source: string;
  title: string;
  url?: string | null;
  attributes?: Record<string, unknown>;
};

export type IssueSearchOutcome = { issues: ProviderEntity[] };

export type MergeRequestOutcome = {
  mergeRequests: ProviderEntity[];
  projects: string[];
};

export type PullRequestOutcome = {
  pullRequests: ProviderEntity[];
  projects: string[];
  truncated?: boolean;
};

export type ProjectEntityOutcome = {
  entities: ProviderEntity[];
  projects: string[];
};

export type BuildListOutcome = {
  builds: ProviderEntity[];
  jobs: string[];
};

/**
 * Board reads over the registered provider capabilities. Each capability uses
 * the *active* DevOps profile on the backend; the caller's profile id only
 * partitions caches. A profile that is unconfigured fails with that reason and
 * must be rendered as unavailable, not as an empty list.
 */
export function jiraSearchIssues(
  input: { issueKeys?: string[]; limit?: number } = {},
  invoke: Invoker = invokeCapability,
): Promise<IssueSearchOutcome> {
  return invoke<IssueSearchOutcome>("jira.searchIssues", input);
}

export function gitlabListMergeRequests(
  projectFilters: string[] = [],
  invoke: Invoker = invokeCapability,
): Promise<MergeRequestOutcome> {
  return invoke<MergeRequestOutcome>("gitlab.listMergeRequests", { projectFilters });
}

export function gitlabListPipelines(
  projectFilters: string[] = [],
  invoke: Invoker = invokeCapability,
): Promise<ProjectEntityOutcome> {
  return invoke<ProjectEntityOutcome>("gitlab.listPipelines", { projectFilters });
}

export function bitbucketListPullRequests(
  projectFilters: string[] = [],
  invoke: Invoker = invokeCapability,
): Promise<PullRequestOutcome> {
  return invoke<PullRequestOutcome>("bitbucket.listPullRequests", { projectFilters });
}

export function jenkinsListBuilds(
  projectFilters: string[] = [],
  invoke: Invoker = invokeCapability,
): Promise<BuildListOutcome> {
  return invoke<BuildListOutcome>("jenkins.listBuilds", { projectFilters });
}
