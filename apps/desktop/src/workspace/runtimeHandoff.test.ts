import { describe, expect, it, beforeEach } from "vitest";
import {
  RUNTIME_HANDOFF_KEY,
  runtimeHandoffFromAttrs,
  saveRuntimeHandoff,
  takeRuntimeHandoff,
} from "./runtimeHandoff";

beforeEach(() => {
  sessionStorage.removeItem(RUNTIME_HANDOFF_KEY);
});

describe("runtimeHandoff", () => {
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
});
