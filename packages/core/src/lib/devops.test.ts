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
  devopsTraceDelivery,
  devopsTraceIssue,
  devopsProfilesList,
  devopsProfileSelect,
  devopsProfileUpsert,
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

  it("traces through the backend delivery join with caller-facing camelCase payloads", async () => {
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

    const trace = await devopsTraceIssue("OPS-142");

    expect(invokeCapability).toHaveBeenCalledWith("devops.traceDelivery", { issueKey: "OPS-142" });
    expect(trace.edges.map((edge) => edge.relation)).toEqual(["implements"]);
  });

  it("scopes the optional Kubernetes fan-out and keeps that trace cache separate", async () => {
    vi.mocked(invokeCapability).mockResolvedValue(emptyTrace);
    await devopsTraceDelivery("OPS-142", { kubeContext: "prod-eu", namespaces: ["payments"] });
    await devopsTraceDelivery("OPS-142", { kubeContext: "staging", namespaces: ["payments"] });

    expect(invokeCapability).toHaveBeenCalledWith("devops.traceDelivery", {
      issueKey: "OPS-142",
      kubeContext: "prod-eu",
      namespaces: ["payments"],
    });
    expect(vi.mocked(invokeCapability).mock.calls.filter((call) => call[0] === "devops.traceDelivery")).toHaveLength(2);
  });

  it("falls back to the fixture capability when the live join returns no nodes", async () => {
    vi.mocked(invokeCapability)
      .mockResolvedValueOnce({ nodes: [], edges: [], situations: [], partial: true, sourceErrors: [{ source: "jira", message: "no profile" }] })
      .mockResolvedValueOnce({
        nodes: [{ id: "jira:OPS-142", kind: "issue", source: "jira", title: "Fixture", url: null, attributes: {} }],
        edges: [],
        situations: [],
        partial: false,
        sourceErrors: [],
      });

    const trace = await devopsTraceIssue("OPS-142");

    expect(invokeCapability).toHaveBeenNthCalledWith(1, "devops.traceDelivery", { issueKey: "OPS-142" });
    expect(invokeCapability).toHaveBeenNthCalledWith(2, "devops.traceIssue", { issueKey: "OPS-142" });
    expect(trace.nodes[0]?.id).toBe("jira:OPS-142");
    expect(trace.partial).toBe(true);
    expect(trace.sourceErrors).toEqual([{ source: "jira", message: "no profile" }]);
  });

  it("caches devopsTraceDelivery by issue key and clears on profile switch", async () => {
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
});
