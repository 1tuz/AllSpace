# AllSpace

AllSpace is a delivery-first, local DevOps workspace: a prototype desktop app
that joins a work item to its change, build, artifact, deployment, and runtime in
one place. It runs as a Tauri v2 shell over a React 19 workspace and a Rust
capability core.

## What it does

- **My Work** — a widget mosaic with a summary, an inbox, and an inline delivery
  Trace. Selecting a delivery fills the Trace without leaving the screen.
- **Deliveries** — a browse list beside the selected Trace, with situations on
  the rows.
- **Delivery Trace** — work item → change → build → artifact → deployment →
  runtime, joined from provider data with explicit evidence and confidence.
- **Provider adapters** — Jira, GitLab, Bitbucket, and Jenkins feed a
  provider-neutral delivery model.
- **Kubernetes depth** — the Kubernetes explorer opens as a contextual
  drill-down from a trace, over local kubeconfig credentials.
- **MCP access** — the same capability registry is exposed to MCP-capable
  clients over stdio or loopback HTTP.
- **Partial results stay partial** — a failed provider or cluster call is
  reported as a source error on a partial trace, never as a fact about the
  cluster or pipeline.

## Architecture

AllSpace runs a React 19 workspace inside a Tauri v2 shell. The UI calls Tauri
commands and receives events; the headless web host exposes the same
capabilities over HTTP and WebSocket; and the MCP server, also embedded by the
TUI, answers over stdio or loopback HTTP. Each host assembles the same
Tauri-free capability registry, so a capability is registered once and reached
from every surface.

![AllSpace architecture: workspace, hosts, capability registry, delivery correlation, provider adapters, and Kubernetes access](docs/assets/allspace-architecture.svg)

The diagram shows integration modules, not the external services they call:
Jira, GitLab, Bitbucket, Jenkins, and the Kubernetes API sit outside the
boundary. Arrows are dependencies, not a full network topology. The
[diagram source (HTML)](docs/assets/allspace-architecture.html) is the editable
file; GitHub serves it as source, not as a live interactive page.

Kubernetes work goes through `crates/kube` and `crates/streams` — clients,
watches, logs, exec, port forwarding, Helm, and metrics. Delivery work is
provider-neutral: `crates/devops-model` defines anchors, entities, edges, and a
`Trace`; the Jira, GitLab, Bitbucket, and Jenkins adapters return entities; and
`crates/correlation` joins them with explicit evidence and confidence. A failed
source stays in `sourceErrors` on a partial trace rather than becoming a fact
about the cluster or pipeline.

The primary composition is Home's My Work mosaic: summary, inbox, and inline
Trace. Selecting a delivery fills the Trace region, which can maximize. The
Deliveries screen keeps its list and selected Trace side by side, and Kubernetes
opens as a contextual drill-down from a trace.

Repository layout:

```text
apps/
  desktop/              React workspace and Tauri v2 shell (src-tauri/)
  tui/                  Terminal UI
packages/
  core/                 Shared TypeScript service layer and capability wrappers
  ui-kit/               Design-system primitives
  ui-next/              Next-design surfaces and routes
crates/
  capability/           Capability and registry types
  registry/             Capability assembly, catalog, and MCP kind resolution
  kube/                 Kubernetes clients, watches, actions, Helm, and metrics
  streams/              Exec, logs, port-forward, terminal, Helm, and watch streams
  devops-model/         Provider-neutral delivery entities, edges, and Trace
  correlation/          Anchor joins, evidence, situations, and trace capabilities
  jira/                 Jira adapter
  gitlab/               GitLab adapter
  bitbucket/            Bitbucket adapter
  jenkins/              Jenkins adapter
  mcp/                  MCP server over stdio and loopback HTTP
  server/               Headless web host
docs/                   Installation, usage, development, and project documentation
```

## Setup

Prerequisites:

- [Rust](https://rustup.rs) stable
- [Node.js](https://nodejs.org) 26 (Node 24 LTS is also supported); `nvm install && nvm use` reads `.nvmrc`
- [pnpm](https://pnpm.io) 11+ (the exact version is pinned by `packageManager` in `package.json`)
- [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/)
- A reachable Kubernetes cluster for cluster-dependent workflows

Run from source:

```sh
git clone https://github.com/1tuz/AllSpace
cd AllSpace
pnpm install
pnpm dev
```

See the [developer guide](docs/DEVELOPMENT.md) for architecture, testing
standards, and instructions for adding capabilities, and the
[user guide](docs/USAGE.md) for using the app.

## Build and test

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Launch the desktop application in development mode |
| `pnpm test` | Run JavaScript and TypeScript tests |
| `cargo test` | Run Rust workspace tests |
| `pnpm build` | Build the production frontend |
| `pnpm tauri build` | Create packaged desktop binaries |

## Status

AllSpace is a prototype. CI builds unsigned desktop bundles for local testing
from [Actions](https://github.com/1tuz/AllSpace/actions/workflows/desktop-build.yml).
Signed releases and updater artifacts are not configured; installers from the
upstream project are not AllSpace releases.

## Naming

The Rust crates (`srelens-*`), TypeScript packages (`@srelens/*`), the
`srelens` binary and bundle identifier (`app.srelens.desktop`), and
configuration keys such as `SRELENS_MASTER_KEY` and `srelens.design` keep their
upstream identifiers so code paths, commands, and existing configuration stay
valid. They are internal identifiers; the product is AllSpace.

## License

AllSpace is open source under the [MIT License](LICENSE). The upstream copyright
notice is retained unchanged.

## Credits

- [srelens/srelens](https://github.com/srelens/srelens) — the MIT-licensed code
  foundation: Tauri v2 shell, React frontend, Rust capability registry,
  Kubernetes watch and stream layer, and MCP server.
- [Salience](https://github.com/clegginabox/salience-macos) — product and UX
  inspiration: joined unit-of-work context, My Work, and compact master/detail
  density. Credited as a design reference, not as a source-code dependency.
