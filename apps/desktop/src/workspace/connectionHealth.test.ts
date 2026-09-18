import { describe, expect, it, vi } from "vitest";
import {
  classifyProviderError,
  detailForKind,
  healthKindLabel,
  loadConnectionHealth,
} from "./connectionHealth";
import type { DevOpsProfile } from "@srelens/core";

const APPFARM: DevOpsProfile = {
  id: "appfarm",
  label: "AppFarm",
  providers: [
    {
      provider: "jira",
      baseUrl: "https://jira.example.test",
      authMethod: "session",
      projectFilters: [],
    },
    {
      provider: "gitlab",
      baseUrl: "https://gitlab.example.test",
      authMethod: "accessToken",
      projectFilters: [],
    },
  ],
};

describe("classifyProviderError", () => {
  it("distinguishes auth, authorization, TLS, and reachability", () => {
    expect(classifyProviderError("Unauthorized 401")).toBe("auth_failure");
    expect(classifyProviderError("invalid bearer token")).toBe("auth_failure");
    expect(classifyProviderError("forbidden: 403")).toBe("authorization");
    expect(classifyProviderError("x509: certificate signed by unknown authority")).toBe("tls");
    expect(classifyProviderError("tcp connect error: connection refused")).toBe("reachability");
    expect(classifyProviderError("failed to lookup address information: no such host")).toBe(
      "reachability",
    );
    expect(classifyProviderError("request timed out")).toBe("reachability");
  });

  it("maps missing credential errors instead of empty success", () => {
    expect(classifyProviderError("no credential is stored for appfarm/jira")).toBe(
      "credential_missing",
    );
  });
});

describe("TLS / CA actionable copy", () => {
  it("tells the reader to set a CA PEM or explicit insecure TLS", () => {
    const fallback = detailForKind("tls");
    expect(fallback).toMatch(/corporate CA PEM/i);
    expect(fallback).toMatch(/Allow insecure TLS/i);
    expect(fallback).toMatch(/Settings → DevOps/);

    const withRaw = detailForKind("tls", "x509: certificate signed by unknown authority");
    expect(withRaw).toMatch(/unknown authority/i);
    expect(withRaw).toMatch(/corporate CA PEM/i);
    expect(withRaw).toMatch(/Allow insecure TLS/i);
  });
});

describe("healthKindLabel", () => {
  it("never uses empty-success wording for failures", () => {
    expect(healthKindLabel("auth_failure")).toMatch(/Authentication/i);
    expect(healthKindLabel("valid_empty")).toMatch(/empty/i);
    expect(healthKindLabel("credential_missing")).toMatch(/missing/i);
    expect(detailForKind("valid_empty")).toMatch(/valid empty/i);
  });
});

describe("loadConnectionHealth", () => {
  it("marks missing credentials without probing", async () => {
    const probe = vi.fn();
    const out = await loadConnectionHealth({
      listProfiles: async () => ({ profiles: [APPFARM], activeProfileId: "appfarm" }),
      credentialStatus: async () => [],
      probe,
    });
    expect(probe).not.toHaveBeenCalled();
    expect(out.statusError).toBeNull();
    expect(out.rows).toHaveLength(2);
    expect(out.rows.every((r) => r.kind === "credential_missing")).toBe(true);
  });

  it("probes only the active profile; inactive stays credential_configured", async () => {
    const komus: DevOpsProfile = {
      id: "komus",
      label: "Komus",
      providers: [
        {
          provider: "jenkins",
          baseUrl: "https://jenkins.example.test",
          authMethod: "basic",
          projectFilters: [],
        },
      ],
    };
    const probe = vi
      .fn()
      .mockResolvedValueOnce({ kind: "valid_empty", detail: detailForKind("valid_empty") })
      .mockResolvedValueOnce({ kind: "auth_failure", detail: detailForKind("auth_failure") });

    const out = await loadConnectionHealth({
      listProfiles: async () => ({
        profiles: [APPFARM, komus],
        activeProfileId: "appfarm",
      }),
      credentialStatus: async () => [
        { profileId: "appfarm", provider: "jira" },
        { profileId: "appfarm", provider: "gitlab" },
        { profileId: "komus", provider: "jenkins" },
      ],
      probe,
    });

    expect(probe).toHaveBeenCalledTimes(2);
    expect(out.rows.find((r) => r.provider === "jira")?.kind).toBe("valid_empty");
    expect(out.rows.find((r) => r.provider === "gitlab")?.kind).toBe("auth_failure");
    expect(out.rows.find((r) => r.provider === "jira")?.detail).toMatch(/valid empty/i);
    const inactive = out.rows.find((r) => r.profileId === "komus");
    expect(inactive?.kind).toBe("credential_configured");
    expect(inactive?.detail).toMatch(/Select this profile/i);
  });

  it("surfaces status failure instead of an empty connected list", async () => {
    const out = await loadConnectionHealth({
      listProfiles: async () => {
        throw new Error("vault locked");
      },
      credentialStatus: async () => [],
      probe: vi.fn(),
    });
    expect(out.rows).toEqual([]);
    expect(out.statusError).toMatch(/credential status|vault locked/i);
  });
});
