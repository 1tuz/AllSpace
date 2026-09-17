/** Fixture deliveries for Stage 1 — no live provider calls. */

export type Confidence = "exact" | "strong" | "heuristic";

export type DeliveryStage =
  | "attention"
  | "in_progress"
  | "in_review"
  | "building"
  | "deploying"
  | "delivered";

export interface TraceEvidence {
  kind: string;
  detail: string;
}

export interface TraceEdge {
  from: string;
  to: string;
  relation: string;
  confidence: Confidence;
  evidence: TraceEvidence[];
}

export interface TraceNode {
  id: string;
  stage: "work" | "change" | "build" | "artifact" | "deployment" | "runtime";
  kind: string;
  source: string;
  title: string;
  status: string;
  timestamp: string;
  url: string | null;
  attributes: Record<string, string>;
}

export interface DeliverySituation {
  level: "calm" | "notable" | "loud";
  label: string;
}

export interface Delivery {
  id: string;
  workId: string;
  title: string;
  contour: "AppFarm" | "Komus" | "Custom";
  service: string;
  stage: DeliveryStage;
  stageLabel: string;
  updated: string;
  situations: DeliverySituation[];
  nodes: TraceNode[];
  edges: TraceEdge[];
  partial: boolean;
  sourceErrors: { source: string; message: string }[];
}

export interface ConnectionStatus {
  contour: "AppFarm" | "Komus" | "Custom";
  provider: string;
  status: "connected" | "missing" | "error";
  detail: string;
}

/** AppFarm: Jira → GitLab MR → pipeline → artifact → deployment → runtime. */
export const APPFARM_DELIVERY: Delivery = {
  id: "appfarm-ops-142",
  workId: "OPS-142",
  title: "Retry worker",
  contour: "AppFarm",
  service: "payments-api",
  stage: "attention",
  stageLabel: "Pipeline failed",
  updated: "4m ago",
  situations: [
    { level: "loud", label: "MR merged but pipeline failed" },
    { level: "notable", label: "Previous production revision still running" },
  ],
  partial: false,
  sourceErrors: [],
  nodes: [
    {
      id: "jira:OPS-142",
      stage: "work",
      kind: "Issue",
      source: "jira",
      title: "OPS-142 · Retry worker",
      status: "In Progress",
      timestamp: "2h ago",
      url: "https://jira.example/browse/OPS-142",
      attributes: { project: "payments" },
    },
    {
      id: "gitlab:mr:721",
      stage: "change",
      kind: "MergeRequest",
      source: "gitlab",
      title: "MR !721 merged",
      status: "merged",
      timestamp: "38m ago",
      url: "https://gitlab.example/payments-api/-/merge_requests/721",
      attributes: { branch: "feature/OPS-142-retry-worker", sha: "92ac41f7d2ab9e3c4f5a6b7c8d9e0f1a2b3c4d5e" },
    },
    {
      id: "gitlab:pipeline:9182",
      stage: "build",
      kind: "Pipeline",
      source: "gitlab",
      title: "Pipeline #9182",
      status: "failed",
      timestamp: "12m ago",
      url: "https://gitlab.example/payments-api/-/pipelines/9182",
      attributes: { sha: "92ac41f7d2ab9e3c4f5a6b7c8d9e0f1a2b3c4d5e" },
    },
    {
      id: "artifact:payments-api@sha256:deadbeef",
      stage: "artifact",
      kind: "Artifact",
      source: "gitlab",
      title: "registry.local/payments-api@sha256:deadbeef…",
      status: "previous success",
      timestamp: "yesterday",
      url: null,
      attributes: { digest: "sha256:deadbeefcafebabe0123456789abcdef0123456789abcdef0123456789abcdef" },
    },
    {
      id: "deploy:prod-eu/payments/payments-api",
      stage: "deployment",
      kind: "Deployment",
      source: "kubernetes",
      title: "prod-eu · payments/payments-api",
      status: "available",
      timestamp: "yesterday",
      url: null,
      attributes: { environment: "production", revision: "84" },
    },
    {
      id: "runtime:prod-eu/payments/payments-api",
      stage: "runtime",
      kind: "Workload",
      source: "kubernetes",
      title: "5/5 ready · image tag 91f3aa1",
      status: "Running",
      timestamp: "3m ago",
      url: null,
      attributes: {
        cluster: "prod-eu",
        namespace: "payments",
        kind: "Deployment",
        name: "payments-api",
        image: "registry.local/payments-api:91f3aa1",
      },
    },
  ],
  edges: [
    {
      from: "jira:OPS-142",
      to: "gitlab:mr:721",
      relation: "Implements",
      confidence: "exact",
      evidence: [{ kind: "issue_key", detail: "OPS-142 in MR title and branch" }],
    },
    {
      from: "gitlab:mr:721",
      to: "gitlab:pipeline:9182",
      relation: "BuiltBy",
      confidence: "exact",
      evidence: [{ kind: "full_sha", detail: "92ac41f7d2ab9e3c4f5a6b7c8d9e0f1a2b3c4d5e" }],
    },
    {
      from: "gitlab:pipeline:9182",
      to: "artifact:payments-api@sha256:deadbeef",
      relation: "Produces",
      confidence: "strong",
      evidence: [{ kind: "prior_pipeline_artifact", detail: "last green pipeline digest retained" }],
    },
    {
      from: "artifact:payments-api@sha256:deadbeef",
      to: "deploy:prod-eu/payments/payments-api",
      relation: "DeployedTo",
      confidence: "exact",
      evidence: [{ kind: "image_digest", detail: "sha256:deadbeefcafebabe0123456789abcdef0123456789abcdef0123456789abcdef" }],
    },
    {
      from: "deploy:prod-eu/payments/payments-api",
      to: "runtime:prod-eu/payments/payments-api",
      relation: "Runs",
      confidence: "heuristic",
      evidence: [{ kind: "image_tag_short_sha", detail: "tag 91f3aa1 is not the failed pipeline SHA" }],
    },
  ],
};

/** Komus: Bitbucket → Jenkins → artifact → deployment → runtime. No Jira. */
export const KOMUS_DELIVERY: Delivery = {
  id: "komus-bb-8821",
  workId: "PR-8821",
  title: "Checkout cache warm-up",
  contour: "Komus",
  service: "checkout-api",
  stage: "deploying",
  stageLabel: "Rollout in progress",
  updated: "9m ago",
  situations: [{ level: "notable", label: "Rollout is incomplete" }],
  partial: true,
  sourceErrors: [{ source: "jenkins", message: "folder listing timed out; build metadata from last successful poll" }],
  nodes: [
    {
      id: "bitbucket:pr:8821",
      stage: "work",
      kind: "PullRequest",
      source: "bitbucket",
      title: "PR #8821 · Checkout cache warm-up",
      status: "merged",
      timestamp: "1h ago",
      url: "https://bitbucket.example/projects/SHOP/repos/checkout-api/pull-requests/8821",
      attributes: { project: "SHOP", repo: "checkout-api" },
    },
    {
      id: "bitbucket:commit:55f93a0c",
      stage: "change",
      kind: "Commit",
      source: "bitbucket",
      title: "55f93a0ce119…",
      status: "on main",
      timestamp: "55m ago",
      url: null,
      attributes: { sha: "55f93a0ce119aabbccddeeff0011223344556677" },
    },
    {
      id: "jenkins:build:4410",
      stage: "build",
      kind: "Build",
      source: "jenkins",
      title: "checkout-api/main #4410",
      status: "success",
      timestamp: "22m ago",
      url: "https://jenkins.example/job/checkout-api/job/main/4410/",
      attributes: { sha: "55f93a0ce119aabbccddeeff0011223344556677" },
    },
    {
      id: "artifact:checkout-api@sha256:c0ffee",
      stage: "artifact",
      kind: "Artifact",
      source: "jenkins",
      title: "registry.local/checkout-api@sha256:c0ffee…",
      status: "published",
      timestamp: "21m ago",
      url: null,
      attributes: { digest: "sha256:c0ffeecafebabe0123456789abcdef0123456789abcdef0123456789abcdef01" },
    },
    {
      id: "deploy:staging/checkout/checkout-api",
      stage: "deployment",
      kind: "Deployment",
      source: "kubernetes",
      title: "staging · checkout/checkout-api",
      status: "progressing",
      timestamp: "9m ago",
      url: null,
      attributes: { environment: "staging", revision: "210" },
    },
    {
      id: "runtime:staging/checkout/checkout-api",
      stage: "runtime",
      kind: "Workload",
      source: "kubernetes",
      title: "1/2 ready",
      status: "Progressing",
      timestamp: "2m ago",
      url: null,
      attributes: {
        cluster: "staging",
        namespace: "checkout",
        name: "checkout-api",
        image: "registry.local/checkout-api@sha256:c0ffeecafebabe0123456789abcdef0123456789abcdef0123456789abcdef01",
      },
    },
  ],
  edges: [
    {
      from: "bitbucket:pr:8821",
      to: "bitbucket:commit:55f93a0c",
      relation: "Contains",
      confidence: "exact",
      evidence: [{ kind: "merge_commit", detail: "55f93a0ce119aabbccddeeff0011223344556677" }],
    },
    {
      from: "bitbucket:commit:55f93a0c",
      to: "jenkins:build:4410",
      relation: "BuiltBy",
      confidence: "exact",
      evidence: [{ kind: "scm_revision", detail: "lastBuiltRevision equals full SHA" }],
    },
    {
      from: "jenkins:build:4410",
      to: "artifact:checkout-api@sha256:c0ffee",
      relation: "Produces",
      confidence: "exact",
      evidence: [{ kind: "image_digest", detail: "sha256:c0ffeecafebabe0123456789abcdef0123456789abcdef0123456789abcdef01" }],
    },
    {
      from: "artifact:checkout-api@sha256:c0ffee",
      to: "deploy:staging/checkout/checkout-api",
      relation: "DeployedTo",
      confidence: "exact",
      evidence: [{ kind: "image_digest", detail: "deployment pod template digest match" }],
    },
    {
      from: "deploy:staging/checkout/checkout-api",
      to: "runtime:staging/checkout/checkout-api",
      relation: "Runs",
      confidence: "exact",
      evidence: [{ kind: "image_digest", detail: "running pods share published digest" }],
    },
  ],
};

export const FIXTURE_DELIVERIES: Delivery[] = [APPFARM_DELIVERY, KOMUS_DELIVERY];

export const FIXTURE_CONNECTIONS: ConnectionStatus[] = [
  { contour: "AppFarm", provider: "Jira Data Center", status: "missing", detail: "Configure in Connections — fixture mode" },
  { contour: "AppFarm", provider: "GitLab CE", status: "missing", detail: "Configure in Connections — fixture mode" },
  { contour: "AppFarm", provider: "Kubernetes", status: "missing", detail: "Select contexts inside Kubernetes Explorer" },
  { contour: "Komus", provider: "Bitbucket Data Center", status: "missing", detail: "Configure in Connections — fixture mode" },
  { contour: "Komus", provider: "Jenkins", status: "error", detail: "Fixture: folder listing timed out" },
  { contour: "Komus", provider: "Kubernetes", status: "missing", detail: "Select contexts inside Kubernetes Explorer" },
];

export function deliveryById(id: string): Delivery | undefined {
  return FIXTURE_DELIVERIES.find((d) => d.id === id);
}

export function homeSections(deliveries: Delivery[] = FIXTURE_DELIVERIES) {
  const needsAttention = deliveries.filter((d) => d.stage === "attention" || d.situations.some((s) => s.level === "loud"));
  const inProgress = deliveries.filter((d) => d.stage === "in_progress");
  const inReview = deliveries.filter((d) => d.stage === "in_review");
  const building = deliveries.filter((d) => d.stage === "building" || d.stage === "deploying");
  const delivered = deliveries.filter((d) => d.stage === "delivered");
  return { needsAttention, inProgress, inReview, building, delivered };
}
