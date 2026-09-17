# Agent handoff — DevOps Workspace

## Read first

1. [`DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md`](../../DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md)
   — **source of truth** for product direction.
2. `AGENTS.md`, `CONTRIBUTING.md`, `docs/DEVELOPMENT.md`
3. `docs/devops-cockpit/PRODUCT.md`
4. `docs/devops-cockpit/ARCHITECTURE.md`
5. `docs/devops-cockpit/IMPLEMENTATION_PLAN.md`
6. `TODO.md`

## Do

- Treat cluster-first UI assumptions as **legacy**.
- Build the standalone delivery-first shell (`apps/desktop/src/workspace/`).
- Keep correlation / credentials / provider HTTP below React.
- Work in small verifiable stages; update docs in the same stage.
- Preserve backend contracts and existing platform tests unless intentionally
  removing a legacy surface.

## Do not

- Add new DevOps screens to the old Sidebar / ClusterHotbar / `activeKind`
  model.
- Request real AppFarm / Komus credentials or call private endpoints unless
  explicitly authorized later.
- Treat source failure as empty data; use short SHA as exact evidence; return
  secrets to the UI; HTTP from React; duplicate MCP servers; SSH/Ansible in MVP.
- Rewrite the whole app into another UI framework for aesthetics alone.

## Current stage

**Stages 2–3 done; Stage 4 partial.** Workspace is the default surface.

- ⌘K palette; live `devops.traceDelivery`; fixture fallback
- Mission Control nested tab removed
- Explore in Kubernetes → classic IDE focused on runtime workload
- Contour projectFilters + rail materials / reduced transparency

Next optional slice: live kube image join inside delivery capability; in-shell
browsers instead of classic handoff.

## Verification

```bash
cargo test --workspace
pnpm test
pnpm build
```
