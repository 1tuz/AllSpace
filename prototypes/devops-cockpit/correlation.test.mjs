import test from "node:test";
import assert from "node:assert/strict";
import { correlate, issueKeys } from "./correlation.mjs";
import data from "./demo-data.json" with { type: "json" };

test("extracts unique Jira keys from branch and title", () => {
  assert.deepEqual(issueKeys("feature/OPS-142-cache", "OPS-142 deploy", "PLAT-9"), ["OPS-142", "PLAT-9"]);
});

test("traces issue through PR, build, image and workload", () => {
  const [trace] = correlate(data);
  assert.equal(trace.issue.key, "OPS-142");
  assert.equal(trace.prs[0].id, 482);
  assert.equal(trace.builds[0].number, 9182);
  assert.equal(trace.deployments[0].name, "payments-api");
  assert.equal(trace.situation.label, "In production");
});

test("failed build wins over a healthy older deployment", () => {
  const changed = structuredClone(data);
  changed.builds[0].status = "failed";
  assert.equal(correlate(changed)[0].situation.level, "critical");
});
