# DevOps workspace TODO

Direction: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#devops-workspace-shell-this-fork). Contours: [`docs/CONTOURS.md`](docs/CONTOURS.md).

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

### Vitrina

- [x] Removed the disconnected Layout prototype from navigation and routing
- [x] Drop developer `ScreenHeader` descriptions on shipped screens
- [x] Default route stays My Work

### Primary UX

- [x] Home summary strip (attention / review / building / delivered)
- [x] Deliveries master-detail (live list + selected trace preview)
- [x] Trace = joined view; providers as nodes + evidence, not orphan panels
- [x] Single header per region (the duplicate panel frame was removed with Layout)
- [x] Situation: label + colour on every row

### Content

- [x] Partial trace when contour omits a provider (e.g. Komus without Jira)
- [x] Live errors are explicit, never rendered as empty panels
- [x] Removed the unwired Code panel and placeholder copy

### Polish

- [x] Glass on chrome only (sidebar/titlebar), not dense content
- [x] Row density + contrast like prototype
- [ ] Reduced transparency / increased contrast manual check
- [ ] Screenshot pass: Home, Deliveries, trace, Connections, K8s, ⌘K

### Live-only data

- [x] Removed Demo mode, fixture routing, sample-data chrome, and demo first-run
- [x] My Work and Deliveries query provider capabilities only
- [x] Empty, partial, and failed provider results remain distinct UI states
- [x] Removed disconnected placeholder panels and their fixture-only tests
- [x] Contour visible on every screen (persistent contour switcher in rail)
- [x] First-run / Connections: optional providers per contour
