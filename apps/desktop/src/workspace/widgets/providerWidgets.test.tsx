import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jiraSearchIssues = vi.hoisted(() => vi.fn());
const gitlabListMergeRequests = vi.hoisted(() => vi.fn());
const jenkinsListBuilds = vi.hoisted(() => vi.fn());
const bitbucketListPullRequests = vi.hoisted(() => vi.fn());
const gitlabListPipelines = vi.hoisted(() => vi.fn());

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  jiraSearchIssues,
  gitlabListMergeRequests,
  jenkinsListBuilds,
  bitbucketListPullRequests,
  gitlabListPipelines,
}));

import { JiraWidget } from "./JiraWidget";
import { GitWidget } from "./GitWidget";
import { CiWidget } from "./CiWidget";
import { clearWidgetCache } from "./useWidgetQuery";

afterEach(() => {
  cleanup();
  clearWidgetCache();
  vi.clearAllMocks();
});

beforeEach(() => {
  jiraSearchIssues.mockReset();
  gitlabListMergeRequests.mockReset();
  jenkinsListBuilds.mockReset();
});

const noop = () => {};

const appFarm = {
  id: "appfarm",
  label: "AppFarm",
  providers: [
    { provider: "jira" as const, baseUrl: "https://jira.test", authMethod: "session" as const, projectFilters: [] },
    {
      provider: "gitlab" as const,
      baseUrl: "https://gitlab.test",
      authMethod: "accessToken" as const,
      projectFilters: ["group/project"],
    },
  ],
};

describe("JiraWidget", () => {
  it("says the source is unavailable when the profile has no Jira connection", () => {
    render(
      <JiraWidget profile={{ ...appFarm, providers: [] }} profileId="x" selection={null} onSelect={noop} />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/not configured/);
    expect(jiraSearchIssues).not.toHaveBeenCalled();
  });

  it("does not render a failed call as an empty list", async () => {
    jiraSearchIssues.mockRejectedValue(new Error("401 from Jira"));
    render(<JiraWidget profile={appFarm} profileId="appfarm" selection={null} onSelect={noop} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/401 from Jira/);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders a truthful empty answer", async () => {
    jiraSearchIssues.mockResolvedValue({ issues: [] });
    render(<JiraWidget profile={appFarm} profileId="appfarm" selection={null} onSelect={noop} />);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/no recent issues/),
    );
  });

  it("selects an issue by its Jira key", async () => {
    const onSelect = vi.fn();
    jiraSearchIssues.mockResolvedValue({
      issues: [
        {
          id: "jira:issue:SRE-1",
          kind: "issue",
          source: "jira",
          title: "Gateway 502",
          url: "https://jira.test/browse/SRE-1",
          attributes: { key: "SRE-1", status: "In Progress", projectKey: "SRE", assignee: "Ann" },
        },
      ],
    });
    const user = userEvent.setup();
    render(
      <JiraWidget
        profile={appFarm}
        profileId="appfarm"
        selection={null}
        onSelect={onSelect}
        variant="detail"
      />,
    );
    await user.click(await screen.findByRole("button", { name: /Gateway 502/ }));
    expect(onSelect).toHaveBeenCalledWith({
      anchor: { kind: "issue", value: "SRE-1", source: "jira" },
      title: "Gateway 502",
      source: "Jira",
    });
  });
});

describe("GitWidget", () => {
  it("refuses to scan when the connection has no project filter", () => {
    render(
      <GitWidget
        profile={{ ...appFarm, providers: [{ ...appFarm.providers[1], projectFilters: [] }] }}
        profileId="appfarm"
        selection={null}
        onSelect={noop}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/names no projects/);
    expect(gitlabListMergeRequests).not.toHaveBeenCalled();
  });

  it("selects a merge request by iid", async () => {
    const onSelect = vi.fn();
    gitlabListMergeRequests.mockResolvedValue({
      projects: ["group/project"],
      mergeRequests: [
        {
          id: "gitlab:merge-request:1:7",
          kind: "pullRequest",
          source: "gitlab",
          title: "Bump gateway",
          url: null,
          attributes: { iid: 7, state: "opened", sourceBranch: "feat/x", targetBranch: "main" },
        },
      ],
    });
    const user = userEvent.setup();
    render(
      <GitWidget
        profile={appFarm}
        profileId="appfarm"
        selection={null}
        onSelect={onSelect}
        variant="detail"
      />,
    );
    await user.click(await screen.findByRole("button", { name: /Bump gateway/ }));
    expect(onSelect).toHaveBeenCalledWith({
      anchor: { kind: "pullRequest", value: "7", source: "gitlab" },
      title: "Bump gateway",
      source: "GitLab",
    });
  });
});

describe("CiWidget", () => {
  it("only makes a build selectable when it carries a commit", async () => {
    const onSelect = vi.fn();
    jenkinsListBuilds.mockResolvedValue({
      jobs: ["gateway"],
      builds: [
        {
          id: "jenkins:gateway:1",
          kind: "build",
          source: "jenkins",
          title: "gateway #1",
          url: null,
          attributes: { jobPath: "gateway", buildNumber: 1, status: "SUCCESS", sha: "abc123" },
        },
        {
          id: "jenkins:gateway:2",
          kind: "build",
          source: "jenkins",
          title: "gateway #2",
          url: null,
          attributes: { jobPath: "gateway", buildNumber: 2, status: "FAILURE" },
        },
      ],
    });
    const user = userEvent.setup();
    const komus = {
      id: "komus",
      label: "Komus",
      providers: [
        {
          provider: "jenkins" as const,
          baseUrl: "https://jenkins.test",
          authMethod: "basic" as const,
          projectFilters: ["gateway"],
        },
      ],
    };
    render(
      <CiWidget profile={komus} profileId="komus" selection={null} onSelect={onSelect} variant="detail" />,
    );

    await user.click(await screen.findByRole("button", { name: /gateway #1/ }));
    expect(onSelect).toHaveBeenCalledWith({
      anchor: { kind: "commit", value: "abc123", source: "jenkins" },
      title: "gateway #1",
      source: "Jenkins",
    });
    // Build #2 has no revision: it stays readable text, never an invented link.
    expect(screen.queryByRole("button", { name: /gateway #2/ })).toBeNull();
    expect(screen.getByText("gateway #2")).toBeDefined();
  });
});
