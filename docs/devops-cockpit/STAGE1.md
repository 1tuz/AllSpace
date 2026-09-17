# Stage 1 — architectural seam

Date: 2026-09-16

## Architectural note

Product entry is now a delivery-first `WorkspaceApp` (`apps/desktop/src/workspace/`),
mounted from `AppGate` by default. Global cluster hotbar / resource-kind root
routing are not part of this shell. Kubernetes is a secondary explorer route that
calls `k8s.listContexts` locally. Classic SRE Lens `App` remains an explicit
escape hatch (`srelens.productSurface=classic`) until Stage 4 mounts a full
explorer.

Fixture AppFarm and Komus deliveries render Home / Trace / Connections without
live credentials or a selected cluster.

## Changed files

- `DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md` (instruction; untracked source)
- `docs/devops-cockpit/PRODUCT.md`
- `docs/devops-cockpit/ARCHITECTURE.md`
- `docs/devops-cockpit/IMPLEMENTATION_PLAN.md`
- `docs/devops-cockpit/RESEARCH.md`
- `docs/devops-cockpit/CMD_AGENT_HANDOFF.md`
- `TODO.md`
- `apps/desktop/src/AppGate.tsx`
- `apps/desktop/src/workspace/*` (fixtures, nav, WorkspaceApp, tests)
- `docs/devops-cockpit/STAGE1.md` (this note)

## Tests

- `apps/desktop/src/workspace/WorkspaceApp.test.tsx`
  - Home without kube context
  - fixture AppFarm exact/heuristic labels
  - fixture Komus partial source errors (no Jira)
  - Connections
  - Kubernetes explorer calls `listContexts`
  - Home → Delivery navigation

## Known limitations

- Fixture data only; no live provider joins in the new shell.
- Kubernetes Explorer lists contexts only; resource browsers still classic IDE.
- Command palette / First-run persistence are minimal.
- Legacy `DevOpsMissionControl` as `activeKind=devops` still exists inside classic App.
- Screenshots not captured in this environment yet — drive UI via `pnpm dev`.

## Next-stage blockers

- Decide when to remove nested Mission Control from classic App.
- Backend `DeliveryTrace` capability to replace client-side joining.
- Contextual runtime deep-link carrying cluster/namespace/workload into explorer.
