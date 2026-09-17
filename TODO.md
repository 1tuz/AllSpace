# DevOps Workspace TODO

Fork relative to upstream `dev` at
`01f2f56885e1a46182246bc47cc787e1245db2a9`.

Canonical direction:
[`DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md`](DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md).

## Stage 1 — architectural seam

- [x] Standalone workspace shell (no global cluster selection / resource-kind root).
- [x] Home, Deliveries, Delivery Trace, Connections, First-run on fixtures.
- [x] Fixture AppFarm journey (Jira → GitLab MR → pipeline → artifact → workload).
- [x] Fixture Komus journey (Bitbucket → Jenkins → artifact → workload; no Jira).
- [x] Kubernetes Explorer entry with local cluster selector only.
- [x] Tests: Home without kube context; fixture traces; partial vs empty; exact vs heuristic.
- [x] Docs rewritten for delivery-first IA (PRODUCT / ARCHITECTURE / PLAN / RESEARCH / HANDOFF).
- [x] Contour presets AppFarm/Komus (public URLs + sibling .env paths); TLS insecure for private CA.
- [x] Live AppFarm smoke via `scripts/devops-contour-smoke.py` (VPN).

## Platform retained (done earlier)

- [x] Domain model, correlation fixtures, provider crates (partial).
- [x] Desktop `VaultCredentialStore` + profile settings entry.
- [x] Legacy Mission Control nested screen **retired** (Settings → DevOps kept).

## Stage 2–4 (this fork)

- [x] Command palette foundation across deliveries / entities (workspace ⌘K).
- [x] Backend `devops.traceDelivery`; join out of React core wrapper.
- [x] Register Bitbucket / Jenkins read capabilities.
- [x] Contour `projectFilters` (GitLab / Bitbucket CORP / Jenkins jobs) + CLI env.
- [x] Artifact → workload join rules (digest Exact / tag Strong / short-sha Heuristic).
- [x] TTL cache for delivery trace; clear on profile select/upsert.
- [x] Delivery Trace → Explore opens classic IDE focused on runtime workload.
- [x] Workspace rail materials + `prefers-reduced-transparency`.
- [x] Smoke script probes optional `GITLAB_PROJECTS` / `BITBUCKET_PROJECTS`.
- [ ] Live kube fan-out inside `devops.traceDelivery` (list deployments by image).
- [ ] In-workspace resource browser / logs / shell (today: classic IDE handoff).
- [ ] Native Tauri vibrancy beyond CSS backdrop (optional polish).
