# Architecture — DevOps Workspace

> Canonical product direction:
> [`DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md`](../../DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md).

Fork of `srelens/srelens` (`dev` @ `01f2f568…`). Two layers stay distinct:

| Layer | Owns |
| --- | --- |
| **Product / domain** | Delivery-first workspace shell, traces, situations, contour presets |
| **Platform / runtime** | Capability registry, Kubernetes, streams, vault, MCP, Tauri host |

The product shell is **not** derived from cluster / resource-kind navigation.

---

## Diagrams

Three editorial diagrams (diagram-design · Lens teal `#00a7a0`). Open the HTML in a browser for the full SVG.

| # | File | What it shows |
| --- | --- | --- |
| 1 | [`diagrams/01-ui-shell.html`](diagrams/01-ui-shell.html) | How the UI is composed: AppGate → Workspace shell → screens → Classic escape |
| 2 | [`diagrams/02-screen-flows.html`](diagrams/02-screen-flows.html) | How screens connect: First-run, Home, Deliveries, Trace, Explore, Settings |
| 3 | [`diagrams/03-backend.html`](diagrams/03-backend.html) | Backend stack: surfaces → registry → correlation → adapters → vault → externals |

```text
docs/devops-cockpit/diagrams/
  01-ui-shell.html      ← UI composition
  02-screen-flows.html  ← navigation / handoffs
  03-backend.html       ← crates + capabilities
```

---

## 1. UI organization

### Entry

`AppGate` (`apps/desktop/src/AppGate.tsx`) is the root after auth:

- Default surface: **workspace** (`localStorage srelens.productSurface`).
- Escape hatch: **classic** Kubernetes IDE (`App.tsx`).
- Desktop workspace always mounts `VaultGate` so Settings → DevOps can write connector secrets into `secrets.enc`.

### Workspace shell

`WorkspaceApp` (`apps/desktop/src/workspace/WorkspaceApp.tsx`):

```text
┌──────────┬────────────────────────────────────────────┐
│ Rail     │  Active screen (route-driven)              │
│ Home     │                                            │
│ Deliveries│  First-run | Home | Deliveries | Trace    │
│ Kubernetes│  Connections | Settings | K8s Explorer    │
│ ──────── │                                            │
│ Connections│  ⌘K palette overlays any screen          │
│ Settings │                                            │
└──────────┴────────────────────────────────────────────┘
```

Routes (`workspace/nav.ts`):

| Route | Screen | Role |
| --- | --- | --- |
| `first-run` | First-run | Contour presets; skip → Home |
| `home` | Home | Situation sections → open delivery by id |
| `deliveries` | Deliveries | Filterable list |
| `delivery` + `id` | Delivery Trace | Fixture + live `devops.traceDelivery` overlay |
| `connections` | Connections | Status + shared DevOps settings form |
| `settings` | Settings | Contours, vault credentials, classic escape |
| `kubernetes` | Kubernetes Explorer | Local context picker; classic for deep ops |

**Command palette** (`WorkspacePalette`): ⌘K / Ctrl+K → nav routes + fixture deliveries.

**Mission Control** (`activeKind = "devops"`) is **removed**. DevOps configuration lives under Settings → DevOps (`DevOpsSettingsSection`).

### Classic IDE (escape)

Still: ClusterHotbar, Sidebar, resource tabs, Dock (logs / shell / forwards). Used when Delivery Trace → **Explore in Kubernetes** saves a `runtimeHandoff` and flips surface to classic focused on `cluster / kind / namespace / name`.

---

## 2. Screen relationships

Primary happy path:

```text
First-run
  ├─ Continue → Connections (apply AppFarm / Komus endpoints + vault secrets)
  └─ Skip     → Home (fixtures)

Home / Deliveries
  └─ open delivery id → Delivery Trace
        ├─ live overlay via devops.traceDelivery(workId)
        ├─ empty live → keep fixture nodes; show sourceErrors if any
        └─ Explore in Kubernetes
              ├─ attrs present → runtimeHandoff → Classic IDE (resource focus)
              └─ else → Kubernetes Explorer (context picker only)
```

Cross-cutting:

- **Settings ↔ Connections** — same `DevOpsSettingsSection` (profiles, filters, credentials).
- **Workspace ↔ Classic** — `productSurface` toggle; handoff is one-shot `sessionStorage`.
- **Palette** — jump to any primary/secondary route or a known delivery without walking Home.

Contour presets (`workspace/contours.ts`) seed public URLs + optional `projectFilters` (e.g. Bitbucket `CORP`). Secrets never live in presets.

---

## 3. Backend organization

### Request path

```text
React / CLI / MCP
  → invokeCapability | Tauri command
  → crates/registry (single Registry)
  → domain capability handler
  → adapter HTTP (spawn_blocking) | kube ClientCache | vault resolve
  → Entity / Trace (camelCase on the wire)
```

Same registry feeds desktop WebView, `srelens devops …` CLI, and MCP. Credentials never appear in capability outputs.

### Capability map (DevOps-relevant)

| Capability | Crate | Role |
| --- | --- | --- |
| `devops.traceDelivery` | correlation + registry wiring | Live join across sources; partial + `sourceErrors` |
| `devops.traceIssue` | correlation | Fixture graph (offline demos) |
| `devops.profiles.*` | devops-profiles | Public profile CRUD |
| `jira.searchIssues` | jira | Issue entities |
| `gitlab.listMergeRequests` / `listCommits` / `listPipelines` | gitlab | Change + build entities |
| `bitbucket.listPullRequests` / `listCommits` | bitbucket | Change + commit entities |
| `jenkins.listBuilds` | jenkins | Build entities (`sha` / `scmRevision`) |
| `k8s.*` | kube | Runtime explorer / classic IDE |

Desktop-only commands (not MCP-echoed secrets): `devops_credential_set` / `clear` / `status`.

### Correlation

`crates/correlation`:

- `join_delivery_trace` — pure join: issue → change → commit → build → (synthesized) artifact → workload.
- Evidence ladder: Exact digest → Strong full tag → Heuristic short SHA; never upgrade heuristic to exact.
- Provider failure → `partial: true` + `SourceError`, not an empty “success”.

`packages/core/src/lib/devops.ts` is a **thin** client: prefers `devops.traceDelivery`, falls back to fixture; TTL cache cleared on profile select/upsert.

### Crates to keep

```text
crates/
  devops-model/       Entity, Evidence, Edge, Trace, Situation, Confidence
  devops-profiles/    profiles + CredentialRef resolution
  jira/ gitlab/ bitbucket/ jenkins/   adapters + normalize_*
  correlation/        fixture + join + traceDelivery orchestration types
  registry/           registers everything once
  capability/ kube/ streams/ mcp/     platform
apps/desktop/src-tauri/               vault, CLI, MCP host
packages/core/                        transport + devops wrappers
apps/desktop/src/workspace/           product shell
```

### Auth boundary

Profile = durable public config (URLs, auth method, projectFilters).  
Credential = vault / session store only.  
Adapters receive resolved username/secret inside `spawn_blocking`; UI never reads secrets back.

---

## 4. Related docs

- [`PRODUCT.md`](PRODUCT.md) — IA and salience
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — stages
- [`CONTOURS.md`](CONTOURS.md) — AppFarm / Komus endpoints
- [`CMD_AGENT_HANDOFF.md`](CMD_AGENT_HANDOFF.md) — agent entry
- [`TODO.md`](../../TODO.md) — checklist
