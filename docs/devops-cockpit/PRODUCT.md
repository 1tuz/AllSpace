# Product brief: DevOps Workspace

> Canonical product direction lives in
> [`DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md`](../../DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md).
> This file summarizes the product; when the two conflict, the instruction wins.

## Goal

Standalone macOS DevOps workspace for the daily engineering flow:

```text
work item
  → branch / pull request / merge request
    → commit
      → CI/CD build
        → artifact / container image
          → deployment
            → Kubernetes runtime
```

Primary question:

> Where is this work now — review, CI, artifact, environment, or runtime —
> and what evidence connects each step?

Kubernetes is a major technical capability and a **secondary** investigation
mode. The product is not primarily a Kubernetes IDE.

## Contours

### AppFarm

```text
Jira Data Center → GitLab CE → GitLab CI → artifact → Kubernetes
```

### Komus

```text
Bitbucket Data Center → Jenkins → artifact → Kubernetes
```

Komus must not require a Jira issue as the root entity.

## Root domain concept

Provider-neutral **Delivery** (work context). Discoverable from any of:

```text
issue key · branch · PR/MR · commit SHA · build · artifact · deployment · workload
```

First-class concepts where useful:

```text
Contour / Profile · WorkItem · Change · Branch · PullRequest · Commit
Build · Artifact · Environment · Deployment · Runtime / Workload
Evidence · Situation
```

## Information architecture

Global navigation (MVP):

```text
Home
Deliveries
Kubernetes

────────────
Connections
Settings
```

Providers (Jira, GitLab, Bitbucket, Jenkins) are integrations under
Connections — not top-level navigation.

Do **not** use as global product primitives:

- cluster hotbar for the whole app;
- resource-kind taxonomy as root navigation;
- `(cluster, resource-kind)` as root tab identity;
- DevOps as `activeKind = "devops"` inside the SRE Lens shell.

## Screens

| Screen | Job |
| --- | --- |
| First-run | Connect engineering systems (contour templates), not “pick a kubeconfig” |
| Home | Attention: needs attention, in progress, in review, building/deploying, recently delivered |
| Deliveries | Dense list of delivery contexts |
| Delivery detail | Ordered trace WORK → CHANGE → BUILD → ARTIFACT → DEPLOYMENT → RUNTIME with evidence/confidence |
| Connections | Provider status; public config vs secrets separated |
| Kubernetes Explorer | Secondary mode; cluster selector lives here, not globally |
| Runtime detail | Reuse platform: logs, shell, forward, YAML, events, metrics |

## UX principles (Salience concepts, not branding)

Product reference: [Salience](https://clegginabox.github.io/salience-macos/docs/concepts).

- Work / delivery is the primary UI unit.
- Correlation graph joins entities; situations surface attention.
- Exact vs strong vs heuristic evidence must be distinguishable without color alone.
- Command palette searches across deliveries and entities without requiring provider knowledge.
- Agents (MCP) see the same normalized context as the UI.

## Platform principles retained from SRE Lens

- Capability registry as the backend contract.
- Credentials local; never returned to React.
- Source failure → partial result / `sourceErrors`, never silent “no data”.
- Mutations confirmation-gated and RBAC-checked.
- Dense panes; color never the only status signal.

## Out of MVP

- SSH / Ansible;
- write mutations to Jira / Bitbucket / Jenkins;
- automatic remediation;
- full-text history indexing;
- multi-user orchestration;
- universal adapter for every CI/CD product.

## Readiness for a real contour

- Multi-anchor delivery opens without selecting a cluster first.
- Each edge exposes evidence and confidence.
- Provider errors render as partial, not empty.
- Digests and full SHAs outrank short SHA/tag heuristics; heuristics never upgrade to exact.
- Secrets never appear in settings, vault outputs, MCP audit, or logs.
