import { describe, expect, it } from "vitest";
import { applyLiveTrace } from "./liveTrace";
import { APPFARM_DELIVERY } from "./fixtures";
import type { DevOpsTrace } from "@srelens/core";

describe("applyLiveTrace", () => {
  it("keeps the fixture when live returns no nodes", () => {
    const live: DevOpsTrace = {
      nodes: [],
      edges: [],
      situations: [],
      partial: true,
      sourceErrors: [{ source: "jira", message: "no profile" }],
    };
    const next = applyLiveTrace(APPFARM_DELIVERY, live);
    expect(next.nodes).toEqual(APPFARM_DELIVERY.nodes);
    expect(next.partial).toBe(true);
    expect(next.sourceErrors[0]?.message).toBe("no profile");
  });

  it("replaces fixture nodes when live returns a graph", () => {
    const live: DevOpsTrace = {
      nodes: [
        {
          id: "jira:issue:OPS-142",
          kind: "issue",
          source: "jira",
          title: "Live retry",
          url: null,
          attributes: { status: "In Progress" },
        },
      ],
      edges: [],
      situations: [],
      partial: false,
      sourceErrors: [],
    };
    const next = applyLiveTrace(APPFARM_DELIVERY, live);
    expect(next.nodes).toHaveLength(1);
    expect(next.nodes[0]?.title).toBe("Live retry");
    expect(next.nodes[0]?.stage).toBe("work");
  });
});
