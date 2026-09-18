import { describe, expect, it } from "vitest";
import {
  deliveryPasteLabel,
  parseDeliveryPaste,
} from "./parseDeliveryPaste";

describe("parseDeliveryPaste", () => {
  it("returns null for empty, whitespace, or multi-token noise", () => {
    expect(parseDeliveryPaste("")).toBeNull();
    expect(parseDeliveryPaste("   ")).toBeNull();
    expect(parseDeliveryPaste("OPS-142 extra")).toBeNull();
    expect(parseDeliveryPaste("https://jira.example/browse/OPS-142")).toBeNull();
  });

  it("parses Jira-like issue keys", () => {
    expect(parseDeliveryPaste("PROJ-123")).toEqual({ kind: "issue", value: "PROJ-123" });
    expect(parseDeliveryPaste("ops-142")).toEqual({ kind: "issue", value: "OPS-142" });
    expect(parseDeliveryPaste("A1B2-9")).toEqual({ kind: "issue", value: "A1B2-9" });
  });

  it("parses short and full git SHAs", () => {
    expect(parseDeliveryPaste("abcdef1")).toEqual({ kind: "commit", value: "abcdef1" });
    expect(parseDeliveryPaste("55f93a0")).toEqual({ kind: "commit", value: "55f93a0" });
    expect(parseDeliveryPaste("ABCDEF12")).toEqual({ kind: "commit", value: "abcdef12" });
    expect(parseDeliveryPaste("55f93a0ce119aabbccddeeff0011223344556677")).toEqual({
      kind: "commit",
      value: "55f93a0ce119aabbccddeeff0011223344556677",
    });
    expect(parseDeliveryPaste("abcde")).toBeNull(); // 5 hex — too short
    expect(parseDeliveryPaste("ggggggg")).toBeNull();
  });

  it("parses GitLab MR forms", () => {
    expect(parseDeliveryPaste("!123")).toEqual({ kind: "pullRequest", value: "123" });
    expect(parseDeliveryPaste("payments-api!721")).toEqual({
      kind: "pullRequest",
      value: "payments-api!721",
    });
    expect(parseDeliveryPaste("group/project!9")).toEqual({
      kind: "pullRequest",
      value: "group/project!9",
    });
  });

  it("parses build forms", () => {
    expect(parseDeliveryPaste("#123")).toEqual({ kind: "build", value: "123" });
    expect(parseDeliveryPaste("job#123")).toEqual({ kind: "build", value: "job#123" });
    expect(parseDeliveryPaste("checkout-api/main#4410")).toEqual({
      kind: "build",
      value: "checkout-api/main#4410",
    });
    expect(parseDeliveryPaste("build:9182")).toEqual({ kind: "build", value: "9182" });
    expect(parseDeliveryPaste("build:abc")).toBeNull();
  });

  it("parses unambiguous deploy/ and ns/name workload pastes", () => {
    expect(parseDeliveryPaste("deploy/staging/checkout/checkout-api")).toEqual({
      kind: "deployment",
      value: "staging/checkout/checkout-api",
    });
    expect(parseDeliveryPaste("checkout/checkout-api")).toEqual({
      kind: "workload",
      value: "checkout/checkout-api",
    });
    expect(parseDeliveryPaste("a/b/c")).toBeNull();
    expect(parseDeliveryPaste("deploy/")).toBeNull();
    expect(parseDeliveryPaste("UPPER/Name")).toBeNull();
  });

  it("keeps pasted anchors provider-neutral", () => {
    const appfarm = parseDeliveryPaste("OPS-142");
    expect(appfarm).toEqual({ kind: "issue", value: "OPS-142" });
  });

  it("builds Trace labels for palette actions", () => {
    expect(deliveryPasteLabel({ kind: "issue", value: "PROJ-123" })).toBe("Trace issue PROJ-123");
    expect(deliveryPasteLabel({ kind: "commit", value: "abcdef1" })).toBe("Trace commit abcdef1");
    expect(deliveryPasteLabel({ kind: "pullRequest", value: "123" })).toBe("Trace pull request !123");
    expect(deliveryPasteLabel({ kind: "pullRequest", value: "proj!123" })).toBe(
      "Trace pull request proj!123",
    );
    expect(deliveryPasteLabel({ kind: "build", value: "123" })).toBe("Trace build #123");
    expect(deliveryPasteLabel({ kind: "build", value: "job#123" })).toBe("Trace build job#123");
    expect(deliveryPasteLabel({ kind: "deployment", value: "ns/name" })).toBe(
      "Trace deployment ns/name",
    );
    expect(deliveryPasteLabel({ kind: "workload", value: "ns/name" })).toBe("Trace workload ns/name");
  });
});
