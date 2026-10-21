import { describe, expect, it, beforeEach } from "vitest";
import {
  RUNTIME_HANDOFF_KEY,
  explorePaletteLabel,
  resolveRuntimeScope,
  runtimeHandoffFromAttrs,
  runtimeHandoffKey,
  runtimeHandoffsFromNodes,
  runtimeScopeFromHandoff,
  saveRuntimeHandoff,
  takeRuntimeHandoff,
} from "./runtimeHandoff";

beforeEach(() => {
  sessionStorage.removeItem(RUNTIME_HANDOFF_KEY);
});

describe("runtimeHandoff", () => {
  it("ignores non-string trace attributes", () => {
    expect(runtimeHandoffFromAttrs({ cluster: 42, name: "web" })).toBeNull();
    expect(resolveRuntimeScope(undefined, [
      { attributes: { cluster: 42 } },
      { attributes: { cluster: " dev ", namespace: 42 } },
    ])).toEqual({ kubeContext: "dev" });
  });

  it("maps deployment attributes to a classic focus target", () => {
    expect(
      runtimeHandoffFromAttrs({
        cluster: "prod-eu",
        namespace: "payments",
        kind: "Deployment",
        name: "payments-api",
      }),
    ).toEqual({
      context: "prod-eu",
      kind: "deployments",
      namespace: "payments",
      name: "payments-api",
    });
  });

  it("save then take clears the slot", () => {
    saveRuntimeHandoff({
      context: "prod-eu",
      kind: "deployments",
      namespace: "payments",
      name: "payments-api",
    });
    expect(takeRuntimeHandoff()?.name).toBe("payments-api");
    expect(takeRuntimeHandoff()).toBeNull();
  });

  it("round-trips profileId with full runtime scope", () => {
    saveRuntimeHandoff({
      context: "prod-eu",
      kind: "deployments",
      namespace: "payments",
      name: "payments-api",
      profileId: "appfarm-prod",
      pod: "payments-api-1",
      container: "api",
    });
    expect(takeRuntimeHandoff()).toEqual({
      context: "prod-eu",
      kind: "deployments",
      namespace: "payments",
      name: "payments-api",
      profileId: "appfarm-prod",
      pod: "payments-api-1",
      container: "api",
    });
  });

  it("passes profileId from param or attrs and optional pod/container", () => {
    expect(
      runtimeHandoffFromAttrs(
        {
          cluster: "prod-eu",
          namespace: "payments",
          kind: "Deployment",
          name: "payments-api",
          pod: "payments-api-1",
          container: "api",
        },
        "deployments",
        "appfarm-prod",
      ),
    ).toEqual({
      context: "prod-eu",
      kind: "deployments",
      namespace: "payments",
      name: "payments-api",
      profileId: "appfarm-prod",
      pod: "payments-api-1",
      container: "api",
    });

    expect(
      runtimeHandoffFromAttrs({
        cluster: "staging",
        namespace: "checkout",
        name: "checkout-api",
        profileId: "komus-staging",
      }),
    ).toMatchObject({ profileId: "komus-staging" });
  });

  it("prefers explicit scope over node attributes", () => {
    expect(
      resolveRuntimeScope(
        { kubeContext: "staging", namespaces: ["checkout"] },
        [{ attributes: { cluster: "prod-eu", namespace: "payments" } }],
      ),
    ).toEqual({ kubeContext: "staging", namespaces: ["checkout"] });
  });

  it("derives scope from first runtime node cluster/namespace", () => {
    expect(
      resolveRuntimeScope(null, [
        { attributes: { environment: "production" } },
        { attributes: { cluster: "prod-eu", namespace: "payments" } },
      ]),
    ).toEqual({ kubeContext: "prod-eu", namespaces: ["payments"] });
  });

  it("builds scope from a handoff and a stable handoff key", () => {
    const handoff = {
      context: "prod-eu",
      kind: "deployments",
      namespace: "payments",
      name: "payments-api",
      pod: "payments-api-1",
      container: "api",
    };
    expect(runtimeScopeFromHandoff(handoff)).toEqual({
      kubeContext: "prod-eu",
      namespaces: ["payments"],
    });
    expect(runtimeHandoffKey(handoff)).toContain("payments-api-1");
  });

  it("collects unique Explore handoffs from delivery nodes", () => {
    expect(
      runtimeHandoffsFromNodes(
        [
          { attributes: { environment: "prod" } },
          {
            attributes: {
              cluster: "prod-eu",
              namespace: "payments",
              kind: "Deployment",
              name: "payments-api",
            },
          },
          {
            attributes: {
              cluster: "prod-eu",
              namespace: "payments",
              kind: "Deployment",
              name: "payments-api",
            },
          },
          {
            attributes: {
              cluster: "staging",
              namespace: "checkout",
              name: "checkout-api",
            },
          },
        ],
        "appfarm",
      ),
    ).toEqual([
      {
        context: "prod-eu",
        kind: "deployments",
        namespace: "payments",
        name: "payments-api",
        profileId: "appfarm",
      },
      {
        context: "staging",
        kind: "deployments",
        namespace: "checkout",
        name: "checkout-api",
        profileId: "appfarm",
      },
    ]);
  });

  it("labels Explore actions for the palette", () => {
    expect(
      explorePaletteLabel({
        context: "prod-eu",
        kind: "deployments",
        namespace: "payments",
        name: "payments-api",
      }),
    ).toBe("Explore deployments payments/payments-api");
    expect(
      explorePaletteLabel({
        context: "prod-eu",
        kind: "pods",
        namespace: "",
        name: "payments-api-1",
      }),
    ).toBe("Explore pods payments-api-1");
  });
});
