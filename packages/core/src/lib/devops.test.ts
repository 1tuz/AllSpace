import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../transport/transport", () => ({
  invokeCapability: vi.fn(),
  invokeCommand: vi.fn(),
}));

import { invokeCapability, invokeCommand } from "../transport/transport";
import {
  clearDevopsTraceCache,
  devopsCredentialSet,
  devopsCredentialStatus,
  devopsListDeliveries,
  devopsMyWork,
  devopsSearch,
  devopsTraceDelivery,
  devopsProfilesList,
  devopsProfileSelect,
  devopsProfileUpsert,
  jiraGetIssue,
  resolveDelivery,
  type DevOpsProfile,
} from "./devops";

beforeEach(() => {
  clearDevopsTraceCache();
  vi.mocked(invokeCapability).mockReset().mockResolvedValue({});
  vi.mocked(invokeCommand).mockReset().mockResolvedValue(undefined);
});

describe("devops lib", () => {
  const profile: DevOpsProfile = {
    id: "appfarm",
    label: "AppFarm",
    providers: [
      {
        provider: "gitlab",
        baseUrl: "https://gitlab.example.test",
        authMethod: "accessToken",
        projectFilters: [],
      },
    ],
  };

  const emptyTrace = {
    nodes: [],
    edges: [],
    situations: [],
    partial: false,
    sourceErrors: [],
  };

  it("sends public profile configuration through capabilities", async () => {
    await devopsProfilesList();
    expect(invokeCapability).toHaveBeenCalledWith("devops.profiles.list", {});

    await devopsProfileUpsert(profile, true);
    expect(invokeCapability).toHaveBeenCalledWith("devops.profiles.upsert", {
      profile,
      select: true,
    });

    await devopsProfileSelect("appfarm");
    expect(invokeCapability).toHaveBeenCalledWith("devops.profiles.select", { profileId: "appfarm" });
  });

  it("sends the credential only to the desktop command and reads status only", async () => {
    await devopsCredentialSet("appfarm", "gitlab", "", "glpat-test");
    expect(invokeCommand).toHaveBeenCalledWith("devops_credential_set", {
      profileId: "appfarm",
      provider: "gitlab",
      username: "",
      secret: "glpat-test",
    });

    await devopsCredentialStatus();
    expect(invokeCommand).toHaveBeenCalledWith("devops_credential_status");
  });

  it("traces through the live backend delivery join with multi-anchor payload", async () => {
    vi.mocked(invokeCapability).mockResolvedValueOnce({
      nodes: [{ id: "jira:issue:OPS-142", kind: "issue", source: "jira", title: "Retry", url: null, attributes: {} }],
      edges: [
        {
          from: "jira:issue:OPS-142",
          to: "gitlab:mr:1",
          relation: "implements",
          confidence: "exact",
          evidence: [{ kind: "issue_key_in_branch", detail: "feature/OPS-142" }],
        },
      ],
      situations: [],
      partial: false,
      sourceErrors: [],
    });

    const trace = await devopsTraceDelivery("OPS-142");

    expect(invokeCapability).toHaveBeenCalledWith("devops.traceDelivery", {
      anchor: { kind: "issue", value: "OPS-142" },
      issueKey: "OPS-142",
    });
    expect(trace.edges.map((edge) => edge.relation)).toEqual(["implements"]);
  });

  it("scopes the optional Kubernetes fan-out and keeps that trace cache separate", async () => {
    vi.mocked(invokeCapability).mockResolvedValue(emptyTrace);
    await devopsTraceDelivery("OPS-142", { kubeContext: "prod-eu", namespaces: ["payments"] });
    await devopsTraceDelivery("OPS-142", { kubeContext: "staging", namespaces: ["payments"] });

    expect(invokeCapability).toHaveBeenCalledWith("devops.traceDelivery", {
      anchor: { kind: "issue", value: "OPS-142" },
      issueKey: "OPS-142",
      kubeContext: "prod-eu",
      namespaces: ["payments"],
    });
    expect(vi.mocked(invokeCapability).mock.calls.filter((call) => call[0] === "devops.traceDelivery")).toHaveLength(2);
  });

  it("keeps a live empty result instead of substituting data", async () => {
    vi.mocked(invokeCapability).mockResolvedValueOnce({
      nodes: [],
      edges: [],
      situations: [],
      partial: true,
      sourceErrors: [{ source: "jira", message: "no profile" }],
    });

    const trace = await devopsTraceDelivery("OPS-142");

    expect(invokeCapability).toHaveBeenCalledTimes(1);
    expect(invokeCapability).toHaveBeenCalledWith("devops.traceDelivery", {
      anchor: { kind: "issue", value: "OPS-142" },
      issueKey: "OPS-142",
    });
    expect(trace.nodes).toEqual([]);
    expect(trace.sourceErrors).toEqual([{ source: "jira", message: "no profile" }]);
  });

  it("sends pullRequest anchors without a legacy issueKey", async () => {
    vi.mocked(invokeCapability).mockResolvedValue(emptyTrace);
    await devopsTraceDelivery({ kind: "pullRequest", value: "8821", source: "bitbucket" });
    expect(invokeCapability).toHaveBeenCalledWith("devops.traceDelivery", {
      anchor: { kind: "pullRequest", value: "8821", source: "bitbucket" },
    });
  });

  it("caches devopsTraceDelivery by anchor and clears on profile switch", async () => {
    vi.mocked(invokeCapability).mockResolvedValue(emptyTrace);

    await devopsTraceDelivery("OPS-1");
    await devopsTraceDelivery("OPS-1");
    expect(vi.mocked(invokeCapability).mock.calls.filter((c) => c[0] === "devops.traceDelivery")).toHaveLength(1);

    await devopsProfileSelect("appfarm");
    await devopsTraceDelivery("OPS-1");
    expect(vi.mocked(invokeCapability).mock.calls.filter((c) => c[0] === "devops.traceDelivery")).toHaveLength(2);

    await devopsProfileUpsert(profile, true);
    await devopsTraceDelivery("OPS-1");
    expect(vi.mocked(invokeCapability).mock.calls.filter((c) => c[0] === "devops.traceDelivery")).toHaveLength(3);
  });

  it("isolates devopsTraceDelivery cache by profileId without clear", async () => {
    vi.mocked(invokeCapability).mockResolvedValue(emptyTrace);
    const scope = { kubeContext: "prod-eu", namespaces: ["payments"] };

    await devopsTraceDelivery("OPS-1", scope, { profileId: "appfarm" });
    await devopsTraceDelivery("OPS-1", scope, { profileId: "komus" });
    expect(vi.mocked(invokeCapability).mock.calls.filter((c) => c[0] === "devops.traceDelivery")).toHaveLength(2);

    await devopsTraceDelivery("OPS-1", scope, { profileId: "appfarm" });
    expect(vi.mocked(invokeCapability).mock.calls.filter((c) => c[0] === "devops.traceDelivery")).toHaveLength(2);
  });

  it("resolveDelivery aliases devopsTraceDelivery wire capability", async () => {
    vi.mocked(invokeCapability).mockResolvedValue(emptyTrace);
    await resolveDelivery({ kind: "issue", value: "OPS-99" });
    expect(invokeCapability).toHaveBeenCalledWith("devops.traceDelivery", {
      anchor: { kind: "issue", value: "OPS-99" },
      issueKey: "OPS-99",
    });
  });

  it("searches through devops.search with caller camelCase payload", async () => {
    vi.mocked(invokeCapability).mockResolvedValueOnce({
      anchors: [{ kind: "issue", value: "OPS-142", source: "jira" }],
      partial: true,
      sourceErrors: [],
    });

    const result = await devopsSearch("see OPS-142", { profileId: "appfarm" });

    expect(invokeCapability).toHaveBeenCalledWith("devops.search", {
      query: "see OPS-142",
      profileId: "appfarm",
    });
    expect(result.anchors).toEqual([{ kind: "issue", value: "OPS-142", source: "jira" }]);
    expect(result.partial).toBe(true);
  });

  it("lists deliveries through devops.listDeliveries with caller camelCase payload", async () => {
    vi.mocked(invokeCapability).mockResolvedValueOnce({
      deliveries: [
        {
          id: "gitlab:merge-request:7:721",
          anchor: { kind: "pullRequest", value: "721", source: "gitlab" },
          title: "OPS-142 retry worker",
          workId: "OPS-142",
          stage: "in_review",
          stageLabel: "Change in review",
          situations: [],
          partial: true,
          sourceErrors: [],
        },
      ],
      partial: true,
      sourceErrors: [{ source: "workspace", message: "bounded" }],
    });

    const result = await devopsListDeliveries({ profileId: "appfarm", limit: 12 });

    expect(invokeCapability).toHaveBeenCalledWith("devops.listDeliveries", {
      profileId: "appfarm",
      limit: 12,
    });
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]?.workId).toBe("OPS-142");
  });

  it("loads My Work through devops.myWork with caller camelCase payload", async () => {
    vi.mocked(invokeCapability).mockResolvedValueOnce({
      deliveries: [],
      partial: true,
      sourceErrors: [],
    });

    await devopsMyWork({ profileId: "komus", limit: 8 });

    expect(invokeCapability).toHaveBeenCalledWith("devops.myWork", {
      profileId: "komus",
      limit: 8,
    });
  });

  it("isolates listDeliveries / myWork cache by profileId", async () => {
    vi.mocked(invokeCapability).mockResolvedValue({
      deliveries: [],
      partial: true,
      sourceErrors: [],
    });

    await devopsListDeliveries({ profileId: "appfarm", limit: 5 });
    await devopsListDeliveries({ profileId: "komus", limit: 5 });
    expect(vi.mocked(invokeCapability).mock.calls.filter((c) => c[0] === "devops.listDeliveries")).toHaveLength(2);

    await devopsListDeliveries({ profileId: "appfarm", limit: 5 });
    expect(vi.mocked(invokeCapability).mock.calls.filter((c) => c[0] === "devops.listDeliveries")).toHaveLength(2);

    await devopsMyWork({ profileId: "appfarm" });
    await devopsMyWork({ profileId: "komus" });
    expect(vi.mocked(invokeCapability).mock.calls.filter((c) => c[0] === "devops.myWork")).toHaveLength(2);
  });

  it("never leaks profile A deliveries into profile B cache partitions", async () => {
    const delivery = (id: string) => ({
      id,
      anchor: { kind: "issue" as const, value: id },
      title: id,
      stage: "in_progress",
      stageLabel: "In progress",
      situations: [],
      partial: false,
      sourceErrors: [],
    });

    let activeProfile = "";
    let traceInvokeCount = 0;
    vi.mocked(invokeCapability).mockImplementation(async (cap, payload) => {
      if (cap === "devops.profiles.select") {
        activeProfile = (payload as { profileId: string }).profileId;
        return { activeProfileId: activeProfile, profiles: [profile] };
      }
      // Live handlers key on the active connection; profileId is the client cache partition.
      const profileId = (payload as { profileId?: string }).profileId ?? activeProfile;
      if (cap === "devops.listDeliveries" || cap === "devops.myWork") {
        return {
          deliveries: [delivery(`${profileId}-row`)],
          partial: false,
          sourceErrors: [],
        };
      }
      if (cap === "devops.traceDelivery") {
        // Wire payload has no profileId — backend uses the active connection.
        // Client still partitions the TTL cache by options.profileId; prove that
        // by assign-on-invoke order (A then B), then A cache hit skips invoke.
        const id = traceInvokeCount === 0 ? "appfarm" : "komus";
        traceInvokeCount += 1;
        return {
          nodes: [
            {
              id: `${id}:issue`,
              kind: "issue",
              source: "jira",
              title: id,
              url: null,
              attributes: {},
            },
          ],
          edges: [],
          situations: [],
          partial: false,
          sourceErrors: [],
        };
      }
      if (cap === "devops.search") {
        return {
          anchors: [{ kind: "issue", value: `${profileId}-hit`, source: "jira" }],
          partial: true,
          sourceErrors: [],
        };
      }
      return {};
    });

    const listA = await devopsListDeliveries({ profileId: "appfarm", limit: 5 });
    const listB = await devopsListDeliveries({ profileId: "komus", limit: 5 });
    const listAAgain = await devopsListDeliveries({ profileId: "appfarm", limit: 5 });
    expect(listA.deliveries.map((d) => d.id)).toEqual(["appfarm-row"]);
    expect(listB.deliveries.map((d) => d.id)).toEqual(["komus-row"]);
    expect(listAAgain.deliveries.map((d) => d.id)).toEqual(["appfarm-row"]);
    expect(vi.mocked(invokeCapability).mock.calls.filter((c) => c[0] === "devops.listDeliveries")).toHaveLength(2);

    const workA = await devopsMyWork({ profileId: "appfarm" });
    const workB = await devopsMyWork({ profileId: "komus" });
    expect(workA.deliveries[0]?.id).toBe("appfarm-row");
    expect(workB.deliveries[0]?.id).toBe("komus-row");

    const traceA = await devopsTraceDelivery("OPS-1", undefined, { profileId: "appfarm" });
    const traceB = await devopsTraceDelivery("OPS-1", undefined, { profileId: "komus" });
    const traceAAgain = await devopsTraceDelivery("OPS-1", undefined, { profileId: "appfarm" });
    expect(traceA.nodes[0]?.id).toBe("appfarm:issue");
    expect(traceB.nodes[0]?.id).toBe("komus:issue");
    expect(traceAAgain.nodes[0]?.id).toBe("appfarm:issue");
    expect(vi.mocked(invokeCapability).mock.calls.filter((c) => c[0] === "devops.traceDelivery")).toHaveLength(2);

    // Search has no client TTL; still must not share profileId across calls.
    const searchA = await devopsSearch("OPS", { profileId: "appfarm" });
    const searchB = await devopsSearch("OPS", { profileId: "komus" });
    expect(searchA.anchors[0]?.value).toBe("appfarm-hit");
    expect(searchB.anchors[0]?.value).toBe("komus-hit");
    expect(vi.mocked(invokeCapability).mock.calls.filter((c) => c[0] === "devops.search")).toEqual([
      ["devops.search", { query: "OPS", profileId: "appfarm" }],
      ["devops.search", { query: "OPS", profileId: "komus" }],
    ]);

    // Active-profile partition: select clears, then omit profileId uses B only.
    await devopsProfileSelect("komus");
    const afterSelect = await devopsListDeliveries({ limit: 5 });
    expect(afterSelect.deliveries[0]?.id).toBe("komus-row");
    expect(afterSelect.deliveries[0]?.id).not.toBe("appfarm-row");
  });

  it("jiraGetIssue speaks camelCase issueKey", async () => {
    vi.mocked(invokeCapability).mockResolvedValueOnce({
      issue: {
        id: "jira:issue:OPS-142",
        kind: "issue",
        source: "jira",
        title: "Retry",
        url: "https://jira.example.test/browse/OPS-142",
        attributes: { status: "In Progress", assignee: "Ada" },
      },
      links: [{ relation: "blocks", issueKey: "OPS-140" }],
      activity: [{ kind: "comment", summary: "hi", author: "Ada" }],
    });

    const detail = await jiraGetIssue("OPS-142");
    expect(invokeCapability).toHaveBeenCalledWith("jira.getIssue", { issueKey: "OPS-142" });
    expect(detail.issue.attributes.assignee).toBe("Ada");
    expect(detail.links[0]?.issueKey).toBe("OPS-140");
  });
});
