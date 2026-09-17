# Research notes

## Salience — product reference (concepts only)

Public docs used:

- https://clegginabox.github.io/salience-macos/docs/concepts
- https://clegginabox.github.io/salience-macos/docs/map
- https://clegginabox.github.io/salience-macos/docs/my-work
- https://clegginabox.github.io/salience-macos/docs/mcp
- https://github.com/clegginabox/salience-macos

Borrowed concepts:

- entities, correlations, situations;
- work as primary UI unit;
- attention / loudness instead of metric walls;
- My Work / delivery-oriented views;
- command palette;
- same normalized graph for UI and MCP agents.

Not copied: branding, assets, exact layout, closed implementation details.

Exact Salience product name matters: do not confuse with unrelated “Salience”
products.

## SRE Lens — platform reference

Baseline: `dev` at `01f2f56885e1a46182246bc47cc787e1245db2a9`.

Confirmed:

- React 19 + Tauri 2 desktop; axum web host; TUI;
- shared Rust capability registry → desktop / web / MCP;
- Kubernetes browse/edit/apply, logs, exec, forward, Helm, metrics, CRDs, RBAC;
- vault, safety annotations, MCP consent;
- declarative extension API is Kubernetes-centric (not sufficient alone for
  arbitrary HTTP to Jira/GitLab/Bitbucket/Jenkins).

## Conclusion (corrected)

```text
SRE Lens backend / platform foundation: retain
SRE Lens product shell / IA: replace
```

Old conclusion (“Kubernetes IDE does not need rewriting as the product”) was
wrong for this fork’s goal. The IDE surface stays as a **secondary** explorer
over retained platform capabilities. The product shell becomes delivery-first.

Primary instruction:
[`DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md`](../../DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md).
