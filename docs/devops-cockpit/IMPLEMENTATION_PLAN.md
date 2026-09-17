# Implementation plan

> Canonical direction:
> [`DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md`](../../DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md).

Do not add new DevOps screens to the legacy SRE Lens cluster-first shell.
Mission Control as `activeKind = "devops"` is legacy transitional UI.

## Completed foundation (retain)

- Domain crates: `devops-model`, `correlation`, `devops-profiles`.
- Provider crates: `jira`, `gitlab`, `bitbucket`, `jenkins` (read capabilities).
- Desktop vault credential store + settings entry for profiles.
- Backend `devops.traceDelivery` join (evidence / partial / sourceErrors).
- Fixture `devops.traceIssue` kept for offline demos; thin core wrapper prefers live.
- Prototype in `prototypes/devops-cockpit` (spike only).

## Stage 1 — Architectural seam (done in tree)

Goal: minimal product shell independent of cluster-first root navigation.

Done:

1. Document delivery-first IA (this folder + handoff + TODO + STAGE1).
2. Standalone workspace shell: Home, Deliveries, Delivery Trace, Connections,
   Settings stub, First-run empty state (`apps/desktop/src/workspace/`).
3. Fixture AppFarm and Komus journeys (no real company credentials).
4. Kubernetes Explorer entry with local cluster selector via `listContexts`;
   classic IDE remains escape hatch.
5. Tests in `WorkspaceApp.test.tsx`.

Exit criteria met for fixture shell. Live providers = Stage 3.

## Stage 2 — Product shell on fixture data (done)

Deliveries filter, Home sections, First-run presets, workspace ⌘K palette,
Mission Control nesting **removed** (Settings → DevOps remains).

## Stage 3 — Real read-only graph (done for adapters + join)

- `bitbucket.listPullRequests` / `listCommits` / `jenkins.listBuilds`
- `devops.traceDelivery` backend join; CLI prefers live → fixture
- Contour projectFilters + Bitbucket `CORP` default
- Artifact→workload evidence ladder in `join.rs`
- Trace TTL cache cleared on profile switch
- Workspace overlays live answer; fixtures remain offline default

Still open for a later slice: live kube listing inside the delivery capability.

## Stage 4 — Kubernetes Explorer + macOS polish (partial)

Done:

- Delivery → Explore → classic IDE resource focus (`runtimeHandoff`)
- Workspace rail backdrop + reduced-transparency fallback

Still open: mount full resource browsers inside the workspace explorer; optional
native Tauri vibrancy.

## Explicitly not Stage 1

- Real AppFarm / Komus HTTP against private endpoints.
- SSH / Ansible.
- Rewriting Kubernetes core.
- Migrating UI frameworks for look alone.
- Keeping DevOps permanently nested under resource-kind tabs.

## Checks every change

```bash
cargo test --workspace
pnpm test
pnpm build
```

Capability catalog changes:

```bash
UPDATE_CATALOG=1 cargo test -p srelens-registry
```
