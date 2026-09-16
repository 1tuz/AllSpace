const ISSUE = /\b[A-Z][A-Z0-9]+-\d+\b/g;

export function issueKeys(...values) {
  return [...new Set(values.flatMap((value) => String(value ?? "").match(ISSUE) ?? []))];
}

export function shortSha(value) {
  return value ? value.slice(0, 8) : "unknown";
}

export function correlate(input) {
  const { issues = [], pullRequests = [], builds = [], workloads = [] } = input;
  return issues.map((issue) => {
    const prs = pullRequests.filter((pr) => issueKeys(pr.title, pr.branch, pr.description).includes(issue.key));
    const commits = new Set(prs.flatMap((pr) => [pr.commit, ...(pr.commits ?? [])]).filter(Boolean));
    const relatedBuilds = builds.filter((build) =>
      commits.has(build.commit) || issueKeys(build.branch, build.displayName).includes(issue.key));
    const images = new Set(relatedBuilds.flatMap((build) => build.images ?? []));
    const deployments = workloads.filter((workload) =>
      images.has(workload.image) || commits.has(workload.commit));
    const situation = deriveSituation({ issue, prs, builds: relatedBuilds, deployments });
    return { issue, prs, builds: relatedBuilds, deployments, situation };
  });
}

export function deriveSituation({ issue, prs, builds, deployments }) {
  if (builds.some((item) => item.status === "failed")) return { level: "critical", label: "Build failed" };
  if (deployments.some((item) => item.ready < item.desired)) return { level: "warning", label: "Rollout degraded" };
  if (prs.some((item) => item.state === "open" && item.review === "needs-review")) return { level: "attention", label: "Review needed" };
  if (deployments.some((item) => item.environment === "production" && item.ready === item.desired)) return { level: "healthy", label: "In production" };
  if (issue.status === "Done") return { level: "quiet", label: "Done, not deployed" };
  return { level: "quiet", label: "In progress" };
}
