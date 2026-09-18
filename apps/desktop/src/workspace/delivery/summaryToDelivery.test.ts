import { describe, expect, it } from "vitest";
import { summaryToDelivery } from "./summaryToDelivery";

describe("summaryToDelivery", () => {
  it("maps provider summary fields without inventing trace nodes", () => {
    const row = summaryToDelivery(
      {
        id: "gitlab:mr:721",
        anchor: { kind: "pullRequest", value: "!721", source: "gitlab" },
        title: "Fix checkout",
        workId: "OPS-142",
        stage: "attention",
        stageLabel: "Build failed",
        updated: "2h ago",
        situations: [{ level: "loud", label: "MR merged but pipeline failed" }],
        verdict: { summary: "MR merged but pipeline failed", severity: "loud" },
        partial: true,
        sourceErrors: [{ source: "jenkins", message: "timeout" }],
      },
      "AppFarm",
    );

    expect(row.id).toBe("gitlab:mr:721");
    expect(row.workId).toBe("OPS-142");
    expect(row.stage).toBe("attention");
    expect(row.situations[0]?.level).toBe("loud");
    expect(row.verdict?.summary).toMatch(/pipeline failed/);
    expect(row.nodes).toEqual([]);
    expect(row.anchor?.kind).toBe("pullRequest");
    expect(row.sourceErrors[0]?.message).toBe("timeout");
  });

  it("falls back workId to anchor value and maps healthy→calm", () => {
    const row = summaryToDelivery({
      id: "x",
      anchor: { kind: "build", value: "build#9" },
      title: "Build",
      stage: "unknown",
      stageLabel: "Building",
      situations: [{ level: "healthy", label: "In production" }],
      partial: false,
      sourceErrors: [],
    });
    expect(row.workId).toBe("build#9");
    expect(row.stage).toBe("in_progress");
    expect(row.situations[0]?.level).toBe("calm");
  });
});
