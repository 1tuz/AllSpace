import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBuildLog, getJobTrace, getPipelineJobs } from "./cicd";

describe("cicd wrappers", () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
  });

  it("getPipelineJobs sends camelCase projectId and pipelineId", async () => {
    invoke.mockResolvedValue({
      jobs: [{ id: "gitlab:job:7:502", kind: "build", source: "gitlab", title: "test · integration (failed)" }],
      failure: { jobId: 502, jobName: "integration", stage: "test", failureReason: "script_failure" },
      truncated: false,
    });
    const out = await getPipelineJobs(7, 83, invoke);
    expect(invoke).toHaveBeenCalledWith("gitlab.getPipelineJobs", {
      projectId: 7,
      pipelineId: 83,
    });
    expect(out.failure?.jobName).toBe("integration");
  });

  it("getJobTrace sends camelCase ids and optional maxBytes", async () => {
    invoke.mockResolvedValue({ text: "tail", truncated: true, projectId: 7, jobId: 502 });
    await getJobTrace(7, 502, { maxBytes: 2048 }, invoke);
    expect(invoke).toHaveBeenCalledWith("gitlab.getJobTrace", {
      projectId: 7,
      jobId: 502,
      maxBytes: 2048,
    });
  });

  it("getBuildLog sends camelCase jobPath and buildNumber", async () => {
    invoke.mockResolvedValue({
      text: "FAIL",
      truncated: false,
      jobPath: "payments-api/main",
      buildNumber: 9182,
      failureStage: "Integration",
    });
    const out = await getBuildLog("payments-api/main", 9182, {}, invoke);
    expect(invoke).toHaveBeenCalledWith("jenkins.getBuildLog", {
      jobPath: "payments-api/main",
      buildNumber: 9182,
    });
    expect(out.failureStage).toBe("Integration");
  });
});
