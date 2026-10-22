# DevOps workspace TODO

Direction: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#devops-workspace-shell-this-prototype). Contours: [`docs/CONTOURS.md`](docs/CONTOURS.md). Migration map (classic / ui-next / workspace): [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#classic-vs-ui-next-vs-workspace-migration-map).

## Done

- [x] Delivery-first shell (`apps/desktop/src/workspace/`) — no cluster-first root nav
- [x] Home, Deliveries, Delivery Trace, Connections, First-run, Kubernetes explorer
- [x] Provider-backed AppFarm + Komus; live trace + contour smoke (VPN, see CONTOURS)
- [x] `devops.traceDelivery`, evidence/confidence, TTL cache, profile switch clears cache
- [x] Provider crates (Jira, GitLab, Bitbucket, Jenkins) + vault credentials
- [x] Command palette (⌘K); Delivery → Explore → runtime handoff
- [x] Removed disconnected Dockview Layout prototype; it had no real selected-delivery source
- [x] Rail materials, reduced-transparency, optional liquid glass

## Programme: unified DevOps board (2026-10)

The product target is one lightweight window: pick a working profile, then see
Jira, Git, CI/CD, Kubernetes and (optionally) Docker as **compact widgets on one
board**, each expanding on hover and staying open when pinned. A selection in
one widget becomes the shared context for its neighbours, and Delivery Trace
remains the join across Jira → Git → CI → artifact → Kubernetes.

This supersedes one earlier rule: the board used to be a **fixed**
Summary / Inbox / Trace mosaic with no composition. The fixed mosaic is now the
**default layout**, not the only one — order and width are per profile, and the
default needs no setup.

Legend — state: `done` · `active` · `todo` · `blocked`.

### P0 — the board exists and is truthful

| # | Task | State | Depends | Done when | Verify |
| --- | --- | --- | --- | --- | --- |
| P0.1 | Actualise README, developer guide, contour notes, this file for the board target | done | — | Docs describe widgets, profile layout, optional Docker, and drop the fixed-mosaic prohibition | Read the diff; no doc claims a capability that does not exist |
| P0.2 | Widget kernel: `compact` → `hover` → `pinned` → `expanded`, one state machine | done | P0.1 | Hover expands after an intent delay and collapses on leave; click pins/unpins; Escape unpins; keyboard reaches every state; `prefers-reduced-motion` removes motion; a body that was opened stays mounted so scroll and in-flight work survive | `pnpm --filter @srelens/desktop test -- WidgetFrame`, manual hover sweep |
| P0.3 | Board layout replacing the three-slot mosaic, default layout ready on first launch | done | P0.2 | Widgets: Summary, Delivery Trace, Jira, Git, CI/CD, Kubernetes; no duplicate titles or frames; default layout needs zero configuration | `pnpm --filter @srelens/desktop test -- HomeScreen WidgetBoard`, screenshot pass |
| P0.4 | Provider widget data through existing capabilities | done | P0.3 | `@srelens/core` gains typed wrappers for `jira.searchIssues`, `gitlab.listMergeRequests`, `gitlab.listPipelines`, `bitbucket.listPullRequests`, `jenkins.listBuilds`; widgets never call `invoke` directly; each widget keeps loading / empty / unavailable / partial / error distinct | Unit tests over a stubbed transport per state |
| P0.5 | Shared selection context | done | P0.3 | Selecting a Jira issue, MR/PR, build or Kubernetes resource updates the board context and the Trace widget; nothing invents a missing link | Interaction test: row click → Trace anchor; missing provider → source error, not a false chain |
| P0.6 | Per-profile layout persistence and reordering | done | P0.3 | Layout keyed by profile id, saved through `settingsStorage`; move and resize without drag-only affordances; unknown ids fall back to the default layout | `layout.test.ts` (round-trip, unknown ids, per-profile isolation) |
| P0.7 | Profile switch isolation | done | P0.6 | Switching profile clears selection, cancels in-flight widget calls, partitions caches by profile, swaps layout, and never renders the previous profile's data | Interaction test: switch with an open widget → no cross-contour rows |
| P0.8 | CI coverage for board interaction | todo | P0.7 | Hover, pin, collapse, Escape and profile switch run in the `frontend` job; heavy/visual passes stay off the required path but run nightly | Green `CI` on the pushed commit; `Nightly` workflow dispatched |

### P1 — depth, profiles as a product, optional Docker

| # | Task | State | Depends | Done when | Verify |
| --- | --- | --- | --- | --- | --- |
| P1.1 | Profile CRUD: create, rename, duplicate, delete | todo | P0.7 | The UI can do all four; deleting a profile also clears its stored credentials, layout and selection; deleting the active profile selects a remaining one | Component test + Rust test for the delete capability |
| P1.2 | `devops.profiles.delete` capability | todo | P1.1 | Registered read/write-annotated, catalog regenerated, e2e case added, credentials for that profile dropped | `cargo test -p srelens-devops-profiles`, catalog sync test |
| P1.3 | Widget deep-links into the Kubernetes explorer | todo | P0.5 | Kubernetes widget opens namespaced resources, logs, YAML, events, shell, port-forward and Helm in `KubernetesExplorerScreen` with the same context and profile-scoped kubeconfig | Handoff test + manual drill |
| P1.4 | Docker read-only module | todo | P0.4 | Existing local containers, images and Compose projects are listed from the local engine socket (Docker Desktop, colima, podman socket) with no agent installed and no mutating action on hover; an absent engine renders **unavailable**, never an empty list | Rust unit tests over a fake socket; widget state test |
| P1.5 | Docker actions behind confirmation | todo | P1.4 | Start/stop/restart only after explicit confirmation, capability annotated `requires_confirm`, never triggered by hover | Rust gating test + UI confirm test |
| P1.6 | Board performance budget | todo | P0.7 | Hidden widgets stop polling; visible ones refresh on interval/event; startup time, memory and bundle delta measured and recorded; no new dependency without a stated reason | Perf script output in the PR/commit note |
| P1.7 | Theme and density parity in the board | todo | P0.3 | Light / dark / system all verified on the board; no translucent surface behind dense data; edge-to-edge rule holds | Screenshot pass per theme |

### P2 — Kubernetes IDE inside the workspace

| # | Task | State | Depends | Done when | Verify |
| --- | --- | --- | --- | --- | --- |
| P2.1 | Workspace-native explorer | blocked | P1.3 | Resource browser, YAML editor, logs, terminals, Helm and metrics are reachable inside the workspace without opening classic `App.tsx`; classic stays the escape hatch until parity is checked | Side-by-side checklist vs classic + manual drill |
| P2.2 | Drop `AppGate` `srelens.productSurface` | blocked | P2.1 | One product surface; classic IDE reachable only while P2.1 parity is unproven | Boot matrix test |
| P2.3 | Visual regression snapshots | todo | P0.8 | Board states captured from the real app in CI artifacts; a broken layout fails a nightly run, not a human's eye | Nightly artifact review |
| P2.4 | Incidents / Drill | blocked | Incident feed | Object-scoped incident feed exists before `DrillCard` is wired | Kit test + feed contract |

### Release truth (unchanged, still open)

- [x] Fix `WorkspaceSidebar.test.tsx` callback typings; `pnpm --filter @srelens/desktop typecheck` passes.
- [ ] Build and install a fresh macOS app after the workspace changes. Verify the installed app has no Demo mode, fixture copy, or stale Dockview chrome.
- [ ] Configure the AppFarm GitLab project filter in the active profile, then verify the board, My Work and Deliveries with live data (corporate VPN).
- [x] When no delivery rows arrive, render **source unavailable** instead of **partial results**; keep partial only when at least one source supplied usable rows.

### Done before the board

- [x] Delivery-first shell (`apps/desktop/src/workspace/`) — no cluster-first root nav
- [x] Home, Deliveries, Delivery Trace, Connections, First-run, Kubernetes explorer
- [x] Provider-backed AppFarm + Komus; live trace + contour smoke (VPN, see CONTOURS)
- [x] `devops.traceDelivery`, evidence/confidence, TTL cache, profile switch clears cache
- [x] Provider crates (Jira, GitLab, Bitbucket, Jenkins) + vault credentials
- [x] Command palette (⌘K); Delivery → Explore → runtime handoff
- [x] Removed disconnected Dockview Layout prototype; it had no real selected-delivery source
- [x] Rail materials, reduced-transparency, optional liquid glass
- [x] Fixed Summary / My Work / Trace mosaic with Maximize / Restore (now the board's default layout)
- [x] Home inline selection — row click fills Trace without leaving My Work
- [x] Deliveries master-detail (live list + selected trace preview)
- [x] Trace = joined view; providers as nodes + evidence, not orphan panels
- [x] Partial trace when contour omits a provider (e.g. Komus without Jira)
- [x] Live errors are explicit, never rendered as empty panels

### Polish (manual checks still open)

- [ ] Reduced transparency manual check (OS Accessibility → Display)
  - Reduce transparency ON/OFF × liquid glass on/off → rail opaque, no blur;
    native window not glassy when reduce is on (`syncNativeLiquidGlass` gates).
  - Increased contrast (`prefers-contrast`): **deferred** — no CSS yet.
- [ ] Screenshot pass on the board (human): default layout, hover, pinned, expanded,
  profile switch, ⌘K palette, Kubernetes drill-down.
  Boot: `srelens.design=classic` + `productSurface=workspace`, first-run done.

## Classic to ui-next gap (K8s IDE migration)

Not the delivery workspace backlog above. This tracks parity between the
**classic Kubernetes IDE** (`apps/desktop/src/App.tsx` + `components/`) and the
**new design** (`packages/ui-next`). Preference: `srelens.design` =
`classic` | `next` (`apps/desktop/src/design.ts`). Default remains `classic`.
Source of truth for what already exists in next: `PORTED_SCREENS` in
`design.ts` and `SCREENS` / `screenFor` in `packages/ui-next/src/lib/routes.ts`.
Narrative: [migration map](docs/DEVELOPMENT.md#classic-vs-ui-next-vs-workspace-migration-map).

### Ported in ui-next

- [x] Home, Cluster overview, Workloads, `/k` lists + details, Events
- [x] Logs, Port forwards, Terminals, Helm, Toolbox, Topology
- [x] Connections / Connect, Settings, Agent, App log, Release notes
- [x] Edit / New resource, Extension pages

### Thinner than classic (intentional or MVP)

All listed items are decided: ported to usable depth, explicitly non-ported, or
moved off this checklist. Remaining classic richness stays in the MVP notes;
Drill/Incidents and the explorer embed sit on the workspace backlog above.

- [x] Detail **Metrics** body (`METRICS_BODY` + `MetricsBody`; classic `MetricsPanel` sparklines)
- [x] Detail **Relations** tab (`RelationsBody` — revisions, managed pods, CronJob jobs; navigates like classic)
- [x] Resource **CommandPalette** MVP — Console `/`: resource search + KindActions drill; **Recents** (`paletteRecents` + shared `getRecents`/`pushRecent`); **Go to** built-in kinds + CRDs (`paletteNav` + `listCrds`); mutate-from-palette via Action handoff → ResourceMenu Pending (see checkbox below). Still thinner than classic in places, but the confirm bridge is in.
- [x] **Toolbox** Nav — INVESTIGATE row → `/toolbox` (screen was already ported)
- [x] **ConfigDataEditor** — ConfigMap + Opaque Secret inline edit/save
- [x] **Pod Debug** — ephemeral debug container confirm → attach (classic Zap)
- [x] **OverviewBodies** batch — Ingress, PVC, PV, HPA, NetworkPolicy, ServiceAccount, ResourceQuota, PDB Details bodies
- [x] **OverviewBodies** remainder — Endpoints, EndpointSlice, Role/ClusterRole, RoleBinding/ClusterRoleBinding, PriorityClass, StorageClass, RuntimeClass, IngressClass, LimitRange, Lease, Mutating/ValidatingWebhookConfiguration (classic `KindBody` set complete; inert Kind/name text, no live drills)
- [x] Mutate-from-palette bridge — Console `/` offers Action via `resourceHandoff` → detail `useRowMenu` opens ResourceMenu Pending (delete/evict/suspend/scale/restart). **Caveat:** `trigger` (Run now) still has no Pending on the row menu — palette only navigates; no mutate until the reader clicks Run now on the detail.
- [x] Shell / forward handoff — Console `/` offers via `resourceHandoff` → Terminals/Forwards open dialog prefilled (not auto-start; no remotePort from palette)
- [x] **Node shell** — Overview overflow → `offerNodeShell` → Terminals `NewSessionMenu` (createNodeDebugPod path)
- [x] Skills CRUD — Agent rail Manage skills: list/create/edit/save/delete (+ activeSkills toggle); Generate with AI deferred (TODO in SkillsPanel)
- [x] Remaining **GenericBody** kinds — classic `KindBody` kinds all have `DETAILS_BODY`; leftover GenericBody-only = Namespace, CRDs, and other kinds classic also left as `GenericDetail` (no dedicated KindBody)
- [x] Multi-session bottom **Dock** — **not porting 1:1**; next uses dedicated `/logs` `/terminals` `/forwards` `/helm` screens; bottom chrome is agent Console
- [x] Resource-scoped **Ask** — next `DetailActions` + Console `ask` / scope (not classic `AssistantDrawer`)
- [x] Classic Settings depth: **Layout** → next `WorkspacePane`; **Contexts** logos/names/order → `ClustersPane`; kubeconfig **sources** → `/connections` + `/connect` (not a Settings sub-tab). Web **sign-in** still classic/web Settings only where applicable.
- [x] **Incidents** Nav — removed so `/incidents` is not a dead click (feed + Drill tracked under workspace **Product: Incidents / Drill** above).

Honest leftovers (not unmarked gaps — product / Stage blockers):

- CronJob **Run now** from palette still navigates only (no Pending on row menu)
- Skills **Generate with AI** deferred
- Shell from palette: prefill, not auto-start; forward: no remotePort from palette
- Namespace / CRD Overview stay GenericBody (same as classic GenericDetail)

### Classic-only until ported or deliberately dropped

- [x] `LandingPage` empty-tabs flow — **replaced** by next control-room Home (intentional, not a parity bug)

### Out of scope for K8s IDE migration (workspace delivery product)

Keep on the workspace backlog above; do not treat as ui-next parity items:

- My Work / Deliveries / Trace / First-run / Connections / Workspace DevOps settings
- `KubernetesExplorerScreen` embed + `AppGate` `productSurface` (blocked on workspace-native explorer; not Step 11 until next is the only K8s IDE)
- Object-scoped Drill / incident feed (kit `DrillCard`; not classic parity)

### Step 11 — delete migration scaffolding

When next is the only K8s IDE and classic is gone:

- [ ] Remove `apps/desktop/src/design.ts`, design toggle UI, `PORTED_SCREENS` injection
- [ ] Remove `packages/ui-next/src/shell/Placeholder.tsx` and `ported` / `onSwitchToClassic`
- [ ] Remove classic IDE tree (`App.tsx` Kubernetes surface, classic Settings design toggle)
