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

## Next

### Release truth

- [x] Fix `WorkspaceSidebar.test.tsx` callback typings; `pnpm --filter @srelens/desktop typecheck` passes.
- [ ] Build and install a fresh macOS app after the workspace changes. Verify the installed app has no Demo mode, fixture copy, or stale Dockview chrome.
- [ ] Configure the AppFarm GitLab project filter in the active profile, then verify My Work and Deliveries with live data.
- [x] When no delivery rows arrive, render **source unavailable** instead of **partial results**; keep partial only when at least one source supplied usable rows.

### Vitrina

- [x] Removed the disconnected Layout prototype from navigation and routing
- [x] Replace developer-only copy in Kubernetes Explorer and Settings with task-oriented guidance; keep operational detail behind help/disclosure.
- [x] Default route stays My Work

### Primary UX

- [x] Home summary strip (attention / review / building / delivered)
- [x] Home widget mosaic (summary / inbox / trace) with Maximize / Restore
- [x] Home inline selection — row click fills Trace without leaving My Work
- [x] Deliveries master-detail (live list + selected trace preview)
- [x] Trace = joined view; providers as nodes + evidence, not orphan panels
- [x] Single header per region (the duplicate panel frame was removed with Layout)
- [x] Situation: label + colour on every row
- [x] Removed unused `workspace/git` lane WIP and orphan exports
### Content

- [x] Partial trace when contour omits a provider (e.g. Komus without Jira)
- [x] Live errors are explicit, never rendered as empty panels
- [x] Removed the unwired Code panel and placeholder copy

### Salience alignment

- [x] Add a compact contextual top bar: active contour/profile, selected Delivery, and back navigation. Do not make the Kubernetes cluster global state.
- [x] Keep the fixed Summary / My Work / Trace mosaic; do not add a generic dashboard composer. Improve the existing Delivery inspector with Overview, Evidence, and Runtime sections.
- [x] Extend the existing command palette with Delivery-linked runtime resources and safe contextual actions.
- [x] Represent Jira issues as Delivery rows and inspector sections. Add Confluence only as a linked Knowledge section in the Delivery inspector, not as a provider-first screen.

### Polish

- [x] Make Liquid Glass status truthful: native glass, vibrancy fallback, or disabled by reduced transparency. Keep glass on chrome, palette, and popovers; keep dense data surfaces opaque.
- [x] Row density + contrast like prototype
- [ ] Reduced transparency manual check (OS Accessibility → Display)
  - Reduce transparency ON/OFF × liquid glass on/off → rail opaque, no blur;
    native window not glassy when reduce is on (`syncNativeLiquidGlass` gates).
  - Increased contrast (`prefers-contrast`): **deferred** — no CSS yet; not part of this checkbox.
- [ ] Screenshot pass (human; `scripts/screenshot.mjs` is ui-next, not workspace):
  Home, Deliveries (+ row → trace), Connections, K8s explorer, ⌘K palette.
  Boot: `srelens.design=classic` + `productSurface=workspace`, first-run done.

### Kubernetes explorer (blocked)

Native depth still missing; today `KubernetesExplorerScreen` embeds classic
`ResourceBrowser` / `CustomResourceBrowser`. Until that embed is replaced, keep
the classic IDE escape hatch.

- [ ] Workspace-native explorer (no day-to-day need to open full classic `App.tsx`)
- [ ] Then drop `AppGate` `srelens.productSurface` (`workspace` \| `classic`) —
  delivery axis only when `srelens.design=classic`; not a ui-next parity item.
  See [migration map](docs/DEVELOPMENT.md#classic-vs-ui-next-vs-workspace-migration-map).

### Product: Incidents / Drill

Not K8s IDE parity (classic never had a detail Drill tab). Kit has `DrillCard`
(Signal→Diagnose→Act); needs an object-scoped incident feed before wiring.

- [ ] Cluster/product incident feed → re-add `/incidents` to `INVESTIGATE` + `SCREENS`
- [ ] Object-scoped **Drill** pane (`DrillCard`) when that feed exists

### Live-only data

- [x] Removed Demo mode, fixture routing, sample-data chrome, and demo first-run
- [x] My Work and Deliveries query provider capabilities only
- [x] Empty, partial, and failed provider results remain distinct UI states
- [x] Removed disconnected placeholder panels and their fixture-only tests
- [x] Contour visible on every screen (persistent contour switcher in rail)
- [x] First-run / Connections: optional providers per contour

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
