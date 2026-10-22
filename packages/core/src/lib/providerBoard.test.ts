import { describe, expect, it, vi } from "vitest";
import {
  bitbucketListPullRequests,
  gitlabListMergeRequests,
  gitlabListPipelines,
  jenkinsListBuilds,
  jiraSearchIssues,
} from "./providerBoard";

/** The board speaks the capability wire contract: camelCase in, camelCase out. */
describe("provider board wrappers", () => {
  it("searches recent Jira issues with the caller's limit", async () => {
    const invoke = vi.fn().mockResolvedValue({ issues: [] });
    await jiraSearchIssues({ limit: 20 }, invoke);
    expect(invoke).toHaveBeenCalledWith("jira.searchIssues", { limit: 20 });
  });

  it("names project filters in camelCase for each provider", async () => {
    const invoke = vi.fn().mockResolvedValue({});
    await gitlabListMergeRequests(["group/project"], invoke);
    await gitlabListPipelines(["group/project"], invoke);
    await bitbucketListPullRequests(["CORP"], invoke);
    await jenkinsListBuilds(["folder/job"], invoke);
    expect(invoke.mock.calls).toEqual([
      ["gitlab.listMergeRequests", { projectFilters: ["group/project"] }],
      ["gitlab.listPipelines", { projectFilters: ["group/project"] }],
      ["bitbucket.listPullRequests", { projectFilters: ["CORP"] }],
      ["jenkins.listBuilds", { projectFilters: ["folder/job"] }],
    ]);
  });
});
