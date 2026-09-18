import { describe, expect, it } from "vitest";
import { draftFromContour, profileFor } from "./DevOpsSettingsSection";

const blankTls = { allowInsecure: false, caBundlePath: "" };

describe("profileFor", () => {
  it("keeps the configured GitLab projects as explicit trace scope", () => {
    const profile = profileFor({
      id: "appfarm",
      label: "AppFarm",
      jiraUrl: "https://jira.example.test",
      gitlabUrl: "https://gitlab.example.test",
      gitlabProjects: "appfarm/platform, appfarm/infra\ngroup/api",
      bitbucketUrl: "",
      bitbucketProjects: "",
      jenkinsUrl: "",
      jenkinsJobs: "",
      ...blankTls,
    });

    expect(profile.providers.find((provider) => provider.provider === "gitlab")?.projectFilters)
      .toEqual(["appfarm/platform", "appfarm/infra", "group/api"]);
    expect(profile.tls).toBeUndefined();
  });

  it("wires Bitbucket projects and Jenkins job prefixes from draft fields", () => {
    const profile = profileFor({
      id: "komus",
      label: "Komus",
      jiraUrl: "",
      gitlabUrl: "",
      gitlabProjects: "",
      bitbucketUrl: "https://bitbucket.example.test",
      bitbucketProjects: "CORP, TEAM\nother",
      jenkinsUrl: "https://jenkins.example.test",
      jenkinsJobs: "payments/\napi/build",
      ...blankTls,
    });

    expect(profile.providers.find((p) => p.provider === "bitbucketDc")?.projectFilters)
      .toEqual(["CORP", "TEAM", "other"]);
    expect(profile.providers.find((p) => p.provider === "jenkins")?.projectFilters)
      .toEqual(["payments/", "api/build"]);
  });

  it("builds AppFarm contour with Jira session and GitLab token auth", () => {
    const profile = profileFor(draftFromContour("appfarm"));
    expect(profile.id).toBe("appfarm");
    expect(profile.providers.map((p) => p.provider)).toEqual(["jira", "gitlab"]);
    expect(profile.providers.find((p) => p.provider === "jira")?.baseUrl).toContain("rshbank");
    expect(profile.providers.find((p) => p.provider === "gitlab")?.authMethod).toBe("accessToken");
    expect(profile.providers.find((p) => p.provider === "gitlab")?.projectFilters).toEqual([]);
    expect(profile.tls?.allowInsecure).toBe(true);
  });

  it("builds Komus contour without Jira as delivery root and seeds Bitbucket CORP", () => {
    const draft = draftFromContour("komus");
    expect(draft.bitbucketProjects).toBe("CORP");
    expect(draft.jenkinsJobs).toBe("");
    expect(draft.allowInsecure).toBe(true);
    const profile = profileFor(draft);
    expect(profile.providers.map((p) => p.provider)).toEqual(["bitbucketDc", "jenkins"]);
    expect(profile.providers.some((p) => p.provider === "jira")).toBe(false);
    expect(profile.providers.find((p) => p.provider === "bitbucketDc")?.projectFilters).toEqual(["CORP"]);
    expect(profile.providers.find((p) => p.provider === "jenkins")?.projectFilters).toEqual([]);
    expect(profile.tls?.allowInsecure).toBe(true);
  });

  it("records corporate CA path without forcing insecure", () => {
    const profile = profileFor({
      id: "custom",
      label: "Custom",
      jiraUrl: "https://jira.example.test",
      gitlabUrl: "",
      gitlabProjects: "",
      bitbucketUrl: "",
      bitbucketProjects: "",
      jenkinsUrl: "",
      jenkinsJobs: "",
      allowInsecure: false,
      caBundlePath: "/etc/ssl/corp-ca.pem",
    });
    expect(profile.tls).toEqual({ allowInsecure: false, caBundlePath: "/etc/ssl/corp-ca.pem" });
  });

  it("AppFarm/Komus drafts never embed credential file paths or secret fields", () => {
    for (const id of ["appfarm", "komus"] as const) {
      const profile = profileFor(draftFromContour(id));
      expect(JSON.stringify(profile)).not.toMatch(/credentialEnvFile|\.env"|password|username/i);
      expect(profile.tls?.allowInsecure).toBe(true);
      expect(profile.tls?.caBundlePath).toBeUndefined();
    }
  });
});
