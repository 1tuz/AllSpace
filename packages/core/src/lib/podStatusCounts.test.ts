import { describe, it, expect, vi } from "vitest";
import { podStatusCounts } from "./podStatusCounts";

describe("podStatusCounts", () => {
  it("passes the context through and returns phase counts", async () => {
    const payload = {
      pending: 2,
      running: 10,
      succeeded: 1,
      failed: 0,
      unknown: 0,
      other: 0,
    };
    const invoke = vi.fn().mockResolvedValue(payload);
    const outcome = await podStatusCounts("prod-eu", invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.podStatusCounts", { context: "prod-eu" });
    expect(outcome.error).toBeUndefined();
    expect(outcome.counts).toEqual(payload);
  });

  it("passes through an empty cluster's zero counts", async () => {
    const zeros = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      unknown: 0,
      other: 0,
    };
    const invoke = vi.fn().mockResolvedValue(zeros);
    const outcome = await podStatusCounts("empty-cluster", invoke);
    expect(outcome.error).toBeUndefined();
    expect(outcome.counts).toEqual(zeros);
  });

  it("reports a timeout as an error, never as a zero count", async () => {
    const outcome = await podStatusCounts("prod-eu", () =>
      Promise.reject(new Error("pod status counts timed out")),
    );
    expect(outcome.counts).toBeUndefined();
    expect(outcome.error).toContain("timed out");
  });

  it("normalises any transport failure into an error outcome", async () => {
    const outcome = await podStatusCounts("prod-eu", () =>
      Promise.reject(new Error("ipc unavailable")),
    );
    expect(outcome.counts).toBeUndefined();
    expect(outcome.error).toContain("ipc unavailable");
  });
});
