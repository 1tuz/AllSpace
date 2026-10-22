# Security Policy

AllSpace is a local-first DevOps workspace that reads your kubeconfigs and talks
to your clusters, so we take security seriously. Thank you for helping keep
users safe.

## Supported versions

Security fixes target the current `main` branch. There are no signed AllSpace
releases; prototype builds are unsigned CI artifacts.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Private vulnerability reporting is not currently enabled for this repository.
Contact the [maintainer](https://github.com/1tuz) to arrange a private channel
before sharing sensitive details. Do not post credentials, kubeconfigs, or
exploit details in a public issue.

Please include:

- A description of the issue and its impact
- Steps to reproduce (or a proof of concept)
- Affected version and OS
- Any suggested remediation

We aim to acknowledge reports within a few days and to coordinate a fix and
disclosure timeline with you. We'll credit reporters who wish to be named once
a fix ships.

## Scope

In scope: the desktop app and its handling of kubeconfigs and cluster
credentials, exec credential plugin invocation, the cluster connection layer
(TLS, auth), the MCP server surface (transports, consent, destructive-action
gating), the in-app updater, and the build artifacts. Out of scope:
vulnerabilities in Kubernetes itself, in your clusters, or in third-party
credential plugins you configure.

## Security model (for context)

- **Local access** — the application connects to the configured Kubernetes and
  provider APIs; cluster access uses local kubeconfig files and credential plugins.
- **Provider credentials** — configured tokens are managed by the local encrypted
  credential vault; keep them out of exported profiles and diagnostic reports.
- **MCP access** — the HTTP transport binds to loopback; destructive capabilities
  carry confirmation requirements.
- **Development bundles** — CI packages are unsigned. A signed release and updater
  feed are not configured for AllSpace.
- **MIT-licensed** — the source is open for review.

## Known dependency advisories

Some GitHub Dependabot alerts reflect **transitive Linux-only dependencies**
that cannot be patched in this repository alone:

- **`glib` (< 0.20)** — pulled in by Tauri's GTK3 / WebKitGTK stack on Linux.
  The unsoundness in `VariantStrIter` is fixed in `glib` 0.20+, but gtk-rs 0.18
  (GTK3) is unmaintained and Tauri has not yet completed its GTK4 migration.
  We track upstream: [tauri#12048](https://github.com/tauri-apps/tauri/issues/12048),
  [wry#1474](https://github.com/tauri-apps/wry/issues/1474). Risk is limited to
  Linux builds; macOS and Windows are unaffected.
