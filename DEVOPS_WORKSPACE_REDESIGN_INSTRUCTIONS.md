# DevOps Workspace Redesign — Agent Instructions

## Status

This document is the primary instruction for the next redesign iteration of the repository.

It supersedes product/UI assumptions in the current DevOps Cockpit documents where they conflict with the decisions below, especially assumptions that preserve the SRE Lens cluster-first shell, cluster hotbar, resource-first navigation, or `DevOpsMissionControl` as just another SRE Lens screen.

Do not treat this as a cosmetic redesign task. The goal is to separate the existing technical foundation from the inherited SRE Lens product shell and turn the project into a standalone DevOps workspace.

---

# 1. Product goal

Build a standalone polished macOS DevOps workspace for the daily engineering flow:

```text
work item
  → branch / pull request / merge request
  → commit
  → CI/CD build
  → artifact / container image
  → deployment
  → Kubernetes runtime
```

Primary real-world contours:

### AppFarm

```text
Jira Data Center
  → GitLab CE
  → GitLab CI
  → artifact
  → Kubernetes
```

### Komus

```text
Bitbucket Data Center
  → Jenkins
  → artifact
  → Kubernetes
```

The product must answer questions such as:

- Where is this work now?
- Is it waiting for review?
- Did CI succeed?
- Which artifact was produced?
- Is that artifact deployed?
- Which environment/cluster is running it?
- Is the runtime healthy enough to inspect further?
- What evidence connects each step?

The product is not primarily a Kubernetes IDE.

Kubernetes is a major technical capability and a secondary investigation mode.

---

# 2. Product references

## 2.1. Salience

Use this exact product as the conceptual product reference:

- Repository: https://github.com/clegginabox/salience-macos
- Documentation: https://clegginabox.github.io/salience-macos/docs/concepts
- Map: https://clegginabox.github.io/salience-macos/docs/map
- My Work: https://clegginabox.github.io/salience-macos/docs/my-work
- MCP: https://clegginabox.github.io/salience-macos/docs/mcp

Do not confuse it with unrelated products named Salience.

Use Salience only for product concepts:

- work as the primary interface unit;
- correlation between entities from different tools;
- attention/situations instead of a wall of metrics;
- joined engineering context;
- My Work / delivery-oriented views;
- command palette;
- the same normalized context being useful to both UI and agents.

Do not copy:

- branding;
- visual assets;
- exact layout;
- product-specific terminology that does not fit this repository;
- implementation assumptions not visible in public sources.

## 2.2. SRE Lens

Technical reference:

- https://github.com/srelens/srelens
- branch/reference baseline currently documented in this repository:
  `dev` at `01f2f56885e1a46182246bc47cc787e1245db2a9`

Use SRE Lens as a backend/platform foundation reference.

Do not use the current SRE Lens UI/IA as the target product reference.

---

# 3. Verified current state of this repository

The current repository is still structurally an SRE Lens fork with a DevOps vertical added to it.

This is not a criticism of the backend work. It is an architectural observation that determines the next step.

## 3.1. Existing SRE Lens platform layers worth retaining

The repository already contains useful separated layers:

```text
crates/capability
crates/kube
crates/streams
crates/registry
crates/mcp
crates/server
apps/desktop/src-tauri
packages/core
```

Important existing properties:

- Rust capability registry as the common backend contract;
- backend capabilities shared across desktop/web/MCP;
- Kubernetes connectivity and resource operations;
- client/cache/auth/OIDC infrastructure;
- logs;
- exec;
- local terminal/PTTY;
- watches;
- port-forwarding;
- Helm;
- metrics;
- CRDs;
- RBAC-related behavior;
- Tauri 2 desktop host;
- encrypted vault;
- MCP consent/safety annotations.

The capability registry is especially important.

Do not replace it with a new ad-hoc frontend API.

## 3.2. Existing DevOps-specific work worth retaining

Current repository already contains:

```text
crates/devops-model
crates/devops-profiles
crates/correlation
crates/jira
crates/gitlab
crates/bitbucket
crates/jenkins
apps/desktop/src-tauri/src/devops_credentials.rs
packages/core/src/lib/devops.ts
apps/desktop/src/components/DevOpsMissionControl.tsx
apps/desktop/src/components/DevOpsSettingsSection.tsx
docs/devops-cockpit/*
prototypes/devops-cockpit/*
```

The provider-neutral model is directionally correct.

Current model already includes concepts such as:

```text
Entity
Evidence
Edge
Trace
Situation
Confidence
SourceError
```

Current entity kinds include:

```text
Project
Issue
PullRequest
Commit
Build
Artifact
Workload
```

Current relations include:

```text
Implements
Contains
BuiltBy
Produces
DeployedTo
```

Current confidence semantics:

```text
Exact
Strong
Heuristic
```

Preserve the evidence/confidence model.

Preserve the rule that a provider failure must be represented as a partial result/source error rather than silently interpreted as “no data”.

## 3.3. Current product-shell problem

The current application state and navigation are still fundamentally cluster-first.

The existing `App` is organized around tabs that represent `(cluster, resource-kind)` views.

`DevOpsMissionControl` is currently rendered as another `activeKind` next to Kubernetes/resource screens.

That is the main architectural product problem.

Do not solve it by adding more DevOps routes to the current SRE Lens sidebar.

---

# 4. Non-negotiable product decision

The product hierarchy must change from:

```text
cluster
  → resource kind
  → resource
```

to:

```text
work / delivery
  → change
  → build
  → artifact
  → deployment
  → runtime
```

Kubernetes becomes one of the downstream surfaces.

The user must be able to understand the state of a delivery without selecting a Kubernetes cluster first.

There must be no global product assumption that a cluster is selected before useful work can happen.

---

# 5. Root domain model

Do not make `Jira Issue` the universal root entity.

AppFarm can start from Jira, but Komus may not have the same issue-tracker flow.

The root product concept should be provider-neutral.

Recommended concept name:

```text
Delivery
```

or:

```text
Work Context
```

The implementation may choose a better internal name, but it must support multiple anchors.

A delivery/work context should be discoverable from any of:

```text
issue key
branch
PR/MR
commit SHA
build
artifact digest/tag
deployment
Kubernetes workload
```

The final domain model should make these first-class where useful:

```text
Contour / Profile
WorkItem
Change
Branch
PullRequest
Commit
Build
Artifact
Environment
Deployment
Runtime / Workload
Evidence
Situation
```

`Deployment` and `Environment` should not remain implicit metadata if they are needed to represent the user flow.

---

# 6. Correlation architecture

Correlation belongs below the UI.

Do not make React the long-term orchestration/correlation engine.

Current `packages/core/src/lib/devops.ts` already performs some client-side joining of Jira/GitLab results. Treat that as transitional.

Target architecture:

```text
provider adapters
      ↓
normalized entities
      ↓
correlation/domain service
      ↓
DeliveryTrace / WorkContext
      ↓
capability registry
      ↓
React UI / MCP / future surfaces
```

The UI should request a normalized trace/context and render it.

It should not know provider-specific joining rules.

Recommended source-of-truth ordering for correlations:

1. exact artifact/image digest;
2. full commit SHA from CI/OCI metadata;
3. explicit deployment/workload revision metadata;
4. exact issue key in branch/PR/build metadata;
5. short SHA/tag parsing only as heuristic fallback.

Never upgrade heuristic evidence to exact evidence.

When evidence conflicts, preserve alternatives instead of silently overwriting them.

---

# 7. New product information architecture

The new global navigation should be product-oriented.

Recommended MVP navigation:

```text
Home
Deliveries
Kubernetes

────────────
Connections
Settings
```

Possible later additions:

```text
My Work
Search
Activity
```

Do not create top-level global navigation for providers:

```text
Jira
GitLab
Bitbucket
Jenkins
```

Those are integrations/sources, not the user's primary mental model.

Do not expose the old global Kubernetes resource taxonomy as the whole-app navigation.

---

# 8. Screen requirements

## 8.1. First-run / empty state

The first-run experience must not start with “select a kubeconfig context”.

It should start with the engineering workflow.

Recommended structure:

```text
Set up your engineering workspace

Connect the systems that move code into production.

AppFarm
Jira · GitLab · Kubernetes

Komus
Bitbucket · Jenkins · Kubernetes

Custom
Configure another contour
```

Then guide the user through provider configuration.

Requirements:

- public configuration and secrets remain separate;
- credentials stay local;
- never read stored secret values back into React;
- show explicit provider connection status;
- show errors as errors, not as empty data.

## 8.2. Home

Home is an attention/work dashboard.

It must answer:

```text
What needs my attention?
What is currently moving?
What is waiting?
What was recently delivered?
```

Recommended sections:

```text
Needs attention
In progress
In review
Building / deploying
Recently delivered
```

A row represents one delivery/work context.

A row should summarize the chain, not only one provider:

```text
OPS-142  Retry worker
AppFarm · payments-api

MR !721 merged
Pipeline #9182 failed
Previous production revision still running
Updated 4m ago
```

Avoid “dashboard of metrics” design.

Situations should represent joined knowledge, for example:

```text
PR merged but ticket still open
Build succeeded but deployment did not update
Production runs an older artifact
Rollout is incomplete
Review is stale
```

## 8.3. Deliveries list

Provide a dense, keyboard-friendly list/table.

Useful fields:

```text
Work / ID
Title
Contour
Service/project
Current stage
Situation
Last update
```

Filtering should support:

```text
all
my work
needs attention
in progress
in review
delivered
contour
service/project
```

Use virtualization if required.

## 8.4. Delivery detail / trace

This is the core investigation view.

Visual hierarchy should communicate:

```text
WORK
  ↓
CHANGE
  ↓
BUILD
  ↓
ARTIFACT
  ↓
DEPLOYMENT
  ↓
RUNTIME
```

It does not have to be a literal horizontal graph at every window size.

Each step must expose:

- source/provider;
- entity identity;
- status;
- timestamp;
- link to source where available;
- evidence;
- confidence.

Each edge must allow inspection of “why are these connected?”

Example:

```text
Commit → Build
Exact

Evidence:
full SHA match
92ac41f7d2ab...
```

Heuristic example:

```text
Artifact → Runtime
Heuristic

Evidence:
image tag contains short SHA
92ac41f
```

The user must be able to distinguish exact, strong and heuristic correlation without relying only on color.

## 8.5. Kubernetes Explorer

Kubernetes is a secondary mode.

Two valid entry paths:

```text
Global:
Kubernetes
```

and:

```text
Delivery
  → Runtime
  → Explore in Kubernetes
```

The contextual path should carry:

```text
cluster
namespace
workload
container where relevant
```

Only inside Kubernetes mode should resource-centric navigation appear:

```text
Overview
Workloads
Pods
Network
Config
Storage
Helm
CRDs
```

Do not restore a global cluster hotbar for the entire application.

Use a cluster selector inside the Kubernetes surface.

## 8.6. Runtime detail

Reuse existing technical capabilities.

From a runtime/workload detail provide access to:

```text
Logs
Shell
Port forward
YAML
Events
Metrics
Scale / restart / other supported actions
```

Mutation behavior must retain existing confirmation and RBAC rules.

## 8.7. Command palette / global search

Command palette is a first-class fast path.

It should search across:

```text
deliveries
issues
PRs/MRs
commits
builds
artifacts
workloads
commands
```

Do not require users to know which provider owns an entity.

---

# 9. Visual direction

Do not copy the existing SRE Lens visual shell.

Do not perform a cosmetic reskin of the current sidebar/hotbar.

Target:

- macOS productivity application;
- dense engineering information;
- clear hierarchy;
- compact rows;
- good keyboard navigation;
- readable monospaced technical data;
- restrained decoration;
- minimal visual noise;
- high contrast where logs/tables/terminals are involved.

## 9.1. macOS / Liquid Glass

Use modern macOS materials only where they make structural sense:

- titlebar;
- toolbar;
- sidebar/navigation chrome;
- selected high-level controls.

Do not use glass as the content background for:

- tables;
- logs;
- terminal;
- code;
- dense trace evidence;
- long lists.

Respect macOS accessibility preferences such as reduced transparency and increased contrast.

Do not make the application depend on a visual effect that fails on older supported macOS versions.

---

# 10. UI stack decision

Preferred stack for the next iteration:

```text
Tauri 2
Rust backend/core
React 19
existing @srelens/core transport where still useful
Radix-style accessible primitives
TanStack Table / Virtual for dense lists
existing terminal/editor engines where practical
thin macOS-specific AppKit bridge only where native window/material behavior is needed
```

Rationale:

- preserves current Rust backend investment;
- preserves working Tauri bridge;
- avoids rewriting Kubernetes/streams;
- web UI ecosystem is stronger for dense tables, logs, terminals and editors;
- macOS polish can be added at the shell/window layer;
- leaves Windows/Linux possible later.

Do not migrate the whole UI to GPUI, Slint, Iced, Dioxus, Leptos or egui just to obtain a new look.

Those frameworks may be reconsidered later only if a concrete blocker is demonstrated.

Fallback architecture, only if required by product constraints:

```text
SwiftUI/AppKit shell
+
existing Rust core through a defined bridge
```

Use this only if macOS-native UI/App Store requirements outweigh implementation cost and cross-platform reuse.

---

# 11. Code boundaries to preserve

Keep these concepts independent from React:

```text
credentials
provider HTTP clients
normalization
correlation
Kubernetes operations
mutation safety
MCP policy
streams
```

React may own:

```text
view state
selection state
filters
presentation
local transient UI state
navigation
```

React must not own:

```text
provider secrets
provider-specific correlation rules
source-of-truth delivery state
Kubernetes auth
destructive-action authorization
```

---

# 12. Legacy UI treatment

The current classic/UI-next SRE Lens UI should be treated as a source of reusable implementation pieces, not as the target shell.

Reuse selectively:

- table logic where generic;
- log rendering;
- terminal integration;
- YAML/editor integration;
- dialogs;
- keyboard/focus utilities;
- accessibility utilities;
- notifications;
- generic buttons/inputs where appropriate.

Do not preserve merely for compatibility:

- cluster hotbar;
- whole-app resource sidebar;
- `(cluster, resource-kind)` root tab identity;
- global namespace assumptions;
- cluster-first landing page;
- DevOps as `activeKind = "devops"`.

The new shell should have its own root navigation/state model.

---

# 13. Documentation that must be corrected

Before or together with implementation, update the documentation so future agents do not reintroduce the old product assumptions.

At minimum inspect and rewrite:

```text
docs/devops-cockpit/PRODUCT.md
docs/devops-cockpit/ARCHITECTURE.md
docs/devops-cockpit/IMPLEMENTATION_PLAN.md
docs/devops-cockpit/RESEARCH.md
docs/devops-cockpit/CMD_AGENT_HANDOFF.md
TODO.md
README.md
docs/USAGE.md
docs/DEVELOPMENT.md
```

Only change README/USAGE/DEVELOPMENT where the repository's actual behavior or target architecture requires it.

## 13.1. PRODUCT.md

Remove/supersede statements that preserve:

- cluster hotbar as a global product primitive;
- resource navigation as the global IA;
- Kubernetes-first mental model.

Rewrite around:

- delivery/work context;
- attention-first Home;
- multi-anchor trace;
- AppFarm and Komus;
- contextual Kubernetes drill-down.

## 13.2. ARCHITECTURE.md

Document two clear layers:

```text
Product/domain layer
Platform/runtime layer
```

Suggested shape:

```text
Product shell
  ↓
Delivery/domain capabilities
  ↓
Correlation
  ↓
Provider adapters
  ↓
Capability registry
  ↓
Platform foundations
      ├ Kubernetes
      ├ streams
      ├ vault
      ├ MCP
      └ Tauri host
```

Explicitly state that the new product shell is not derived from cluster/resource navigation.

## 13.3. IMPLEMENTATION_PLAN.md

Replace the old UI stage that says to put Mission Control into the SRE Lens navigation.

The new implementation order should be:

1. architectural seam;
2. fixture-backed standalone shell;
3. real read-only delivery graph;
4. contextual Kubernetes explorer;
5. macOS polish;
6. only then broader mutation workflows.

## 13.4. RESEARCH.md

Correct the conclusion.

Old conclusion:

```text
SRE Lens is the product foundation and Kubernetes IDE does not need rewriting.
```

New conclusion should distinguish:

```text
SRE Lens backend/platform foundation: retain
SRE Lens product shell / IA: replace
```

Document the exact Salience reference to prevent future ambiguity.

## 13.5. CMD_AGENT_HANDOFF.md

Rewrite it so the next agent does not continue the old strategy.

It must instruct the agent to:

- read this file first;
- treat cluster-first UI assumptions as legacy;
- avoid adding new DevOps screens to the old shell;
- work in small verifiable stages;
- preserve backend contracts and tests.

---

# 14. Migration stages

## Stage 1 — Establish the architectural seam

Goal:

Build a minimal new shell that does not depend on the old root navigation model.

Requirements:

- no global cluster selection;
- no `ResourceKind` as root route identity;
- no dependency on the old Sidebar/ClusterHotbar for primary navigation;
- new shell can call existing capabilities;
- fixtures can render a delivery;
- Kubernetes backend remains untouched unless an API seam is needed.

Exit criteria:

```text
new shell launches
Home exists
fixture Delivery Trace opens
Connections exists
Kubernetes capability can be reached through a neutral platform API
```

## Stage 2 — Product shell on fixture data

Implement:

```text
First-run / empty state
Home
Deliveries
Delivery detail / trace
Connections
Settings
Command palette / search foundation
```

Required fixture journeys:

### AppFarm fixture

```text
Jira
→ GitLab MR
→ GitLab pipeline
→ artifact
→ Kubernetes deployment/workload
```

### Komus fixture

```text
Bitbucket PR/commit
→ Jenkins build
→ artifact
→ Kubernetes deployment/workload
```

Exit criterion:

A user can understand the state of a delivery without entering Kubernetes mode.

## Stage 3 — Real read-only graph

Connect existing/adapt missing providers.

Complete:

- Jira DC;
- GitLab CE;
- Bitbucket DC;
- Jenkins;
- artifact identity;
- Kubernetes runtime join.

Move correlation into the backend/domain layer.

Every edge must expose evidence and confidence.

Provider failure must produce partial trace/source error.

Do not ask for real AppFarm/Komus credentials during development of the architecture.

Use mocks, fixtures and sanitized data.

## Stage 4 — Kubernetes Explorer and macOS polish

Mount a new Kubernetes Explorer over the retained Kubernetes core.

Add contextual transitions:

```text
Delivery
→ Runtime
→ Explore
→ Workload
→ Logs / Shell / YAML / Forward
```

Then add:

- native titlebar/toolbar behavior;
- sidebar materials;
- translucency only in appropriate shell areas;
- accessibility verification;
- keyboard navigation verification.

---

# 15. Test and verification requirements

Do not perform a big-bang rewrite.

Every stage must be independently buildable and testable.

Preserve existing checks unless they become intentionally obsolete through removal of a legacy surface.

Baseline:

```bash
cargo test --workspace
pnpm test
pnpm build
```

For capability catalog changes:

```bash
UPDATE_CATALOG=1 cargo test -p srelens-registry
```

Add tests for new product behavior.

Minimum important tests:

- provider error renders as partial, not empty;
- exact vs heuristic evidence stays distinguishable;
- no secret is returned to UI;
- profile/contour switching never mixes cached data;
- Komus trace does not require a Jira issue;
- Home works without any Kubernetes context selected;
- Delivery detail works without opening Kubernetes Explorer;
- contextual Kubernetes navigation resolves exact cluster/namespace/workload;
- keyboard navigation reaches all primary actions;
- reduced-transparency mode remains usable.

---

# 16. Constraints

Do not:

- request real company credentials;
- call private AppFarm/Komus endpoints during implementation unless explicitly authorized later;
- put credentials into MCP/tool payloads;
- log Authorization headers/tokens;
- perform HTTP calls directly from React;
- use short SHA as exact evidence;
- treat source failure as no data;
- duplicate the existing MCP server;
- add SSH/Ansible to MVP;
- rebuild Kubernetes core without a concrete reason;
- rewrite the entire application into another UI framework only for aesthetics;
- keep building the old cluster-first shell;
- describe a framework as “best” without explaining trade-offs.

---

# 17. Agent execution rules

When implementing this instruction:

1. Read the existing repository architecture and tests before changing anything.
2. Treat this document as the source of truth for product direction.
3. Preserve backend/platform behavior unless the redesign requires a clean API seam.
4. Prefer removing product coupling over duplicating implementations.
5. Do not keep two competing product shells indefinitely.
6. Keep migrations small enough to review.
7. Update documentation in the same stage in which architecture changes.
8. If existing docs contradict this instruction, update the docs rather than working around the contradiction.
9. Do not claim an integration works end-to-end until tests prove each relevant correlation step.
10. Clearly separate:
   - code facts;
   - external research facts;
   - architectural conclusions;
   - hypotheses requiring real environment validation.

---

# 18. Required implementation deliverables

For each migration stage, produce:

```text
1. short architectural note
2. list of changed files
3. tests added/updated
4. screenshots or rendered UI states where applicable
5. documentation updates
6. known limitations
7. next-stage blockers
```

For UI work specifically, provide screenshots for at least:

```text
First-run
Home
Deliveries
Delivery trace
Connections
Kubernetes Explorer
Runtime detail
Logs
Terminal
Settings
Command palette
```

Do not consider a screen complete based only on code.

---

# 19. Public sources to keep attached to the redesign decision

## Salience

- https://github.com/clegginabox/salience-macos
- https://clegginabox.github.io/salience-macos/docs/concepts
- https://clegginabox.github.io/salience-macos/docs/map
- https://clegginabox.github.io/salience-macos/docs/my-work
- https://clegginabox.github.io/salience-macos/docs/mcp

## SRE Lens

- https://github.com/srelens/srelens
- https://github.com/srelens/srelens/blob/dev/docs/DEVELOPMENT.md
- https://github.com/srelens/srelens/blob/dev/docs/USAGE.md
- https://github.com/srelens/srelens/blob/dev/docs/MCP.md
- https://github.com/srelens/srelens/tree/dev/docs/extensions

## Tauri

- https://v2.tauri.app/concept/architecture/
- https://v2.tauri.app/reference/config/

## macOS / Apple design

- https://developer.apple.com/design/human-interface-guidelines/materials
- https://developer.apple.com/documentation/appkit/nsglasseffectview

## Supporting UI libraries / alternatives

- https://www.radix-ui.com/primitives/docs/overview/accessibility
- https://tanstack.com/table/latest/docs/framework/react/guide/virtualization
- https://github.com/zed-industries/zed/tree/main/crates/gpui
- https://slint.dev/
- https://github.com/iced-rs/iced
- https://dioxuslabs.com/
- https://leptos.dev/
- https://github.com/emilk/egui

---

# 20. Final decision summary

The repository should evolve as follows:

```text
KEEP
Rust capability registry
Kubernetes core
streams
vault
MCP/security model
provider adapters
normalized DevOps model
evidence/confidence semantics

REPLACE
SRE Lens product shell
cluster-first navigation
global cluster hotbar
resource-kind root routing
DevOpsMissionControl as a nested SRE Lens screen

BUILD
standalone delivery-first macOS workspace
attention-first Home
multi-anchor Delivery model
Delivery Trace
Connections
secondary contextual Kubernetes Explorer
macOS-specific shell polish on top of Tauri
```

First implementation milestone:

```text
New standalone shell
+
fixture AppFarm journey
+
fixture Komus journey
+
Home
+
Delivery Trace
+
Connections
```

Do not connect the redesign to the old SRE Lens global navigation model.

That separation is the first architectural objective.
