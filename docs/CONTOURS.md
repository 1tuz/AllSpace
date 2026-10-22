# Contours: AppFarm & Komus

Public endpoints and sibling credential paths for this fork. **Secrets are never
committed here** — they live in sibling repos / the desktop vault.

A contour is one **working profile** in the product: its connections, kubeconfig
contexts and namespaces, project filters, widget layout and refresh settings.
AppFarm and Komus are seeded examples, not the only allowed profiles — any
profile can be created, renamed, duplicated or deleted, and switching one must
isolate its data, caches, in-flight requests and Kubernetes contexts from the
other. Layout is stored per profile; switching never inherits the previous
contour's board.

TLS note: profile `tls.allowInsecure` / `caBundlePath`. AppFarm/Komus
presets set `allowInsecure: true` explicitly for private CA. Default profiles use
system trust. Prefer a CA PEM path when available.

## AppFarm

| Piece | Value |
| --- | --- |
| Contour id | `appfarm` |
| Jira DC | `https://sdlc.go.rshbank.ru/jira` |
| GitLab CE | `https://gitlab.rshbdev.ru` |
| Credential file | `../AppFarm/scripts/daily-reports-master/.env` |
| Env keys | `JIRA_USERNAME`, `JIRA_PASSWORD`, `JIRA_DOMAIN`, `GITLAB_URL`, `GITLAB_TOKEN` |
| Filter env | `GITLAB_PROJECTS` (comma-separated `group/project` paths; not seeded in the preset) |
| Auth | Jira session (user/password); GitLab PAT (`accessToken`) |
| TLS | private CA → provider HTTP clients use `danger_accept_invalid_certs` (same as sibling `verify=False`) |
| Kubeconfigs | `../AppFarm/ops/kubeconfigs/*.yaml` (`cpstbl`, `devstbl`, `rcsdstbl`, …) |

Sibling tools: `AGENTS.md` in AppFarm, skill `jira-gitlab-issues`,
`scripts/daily-reports-master/`.

Smoke (corporate VPN required — without it Jira TLS stalls and GitLab DNS fails):

```bash
python3 scripts/devops-contour-smoke.py --contour appfarm
# optional: export GITLAB_PROJECTS=group/project before smoke to probe that path
```

Live Delivery proof (VPN + sibling `.env`):

```bash
# 1) reachability
python3 scripts/devops-contour-smoke.py --contour appfarm
# 2) profile with private-CA escape hatch (required — set-from-env preserves tls)
srelens devops profiles upsert --id appfarm --label AppFarm --allow-insecure \
  --jira https://sdlc.go.rshbank.ru/jira \
  --gitlab https://gitlab.rshbdev.ru \
  --gitlab-project 'rshbintech/integrations/sre/development/flow/gateway'
# 3) load credentials into vault (secrets never in argv)
set -a && source ../AppFarm/scripts/daily-reports-master/.env && set +a
srelens devops credentials set-from-env --profile appfarm
# 4) multi-hop trace against a real issue key
export KUBECONFIG=../AppFarm/ops/kubeconfigs/cpstbl.yaml
srelens devops trace SRE-1896 --kube-context cpstbl --namespace flow
# → Jira issue + GitLab MR/CI + oci:v1.0.28 → Deployment flow/gateway
```

**Live Delivery proof (2026-09-18):** closed on AppFarm VPN with the commands
above (`partial=false`). Private CA requires `--allow-insecure` (or Settings TLS);
`credentials set-from-env` preserves an existing profile `tls` block.

## Komus

| Piece | Value |
| --- | --- |
| Contour id | `komus` |
| Bitbucket DC | `https://bitbucket-app.komus.net` |
| Jenkins | `https://p-doffice-cicd01.komus.net` |
| Optional Jira | `https://jira-app.komus.net` (`DO-*`, not delivery root) |
| Credential file | `../komus/.ai/mcp/mcp.env` |
| Env keys | `BITBUCKET_*`, `JENKINS_*`, optional `JIRA_*` |
| Filter env | `BITBUCKET_PROJECTS` (comma-separated project keys), `JENKINS_JOBS` (comma-separated job path prefixes) |
| Default filters | Bitbucket preset seeds `CORP` (common sibling default project key); Jenkins filters stay empty for the user to fill |
| Auth | Bitbucket bearer token; Jenkins basic (user + API token) |
| Kubeconfigs | `../komus/kubeconfigs/{dev,stage,uat,prod,qa}.yaml` |

Sibling tools: `komus/AGENTS.md`, skills `komus-jira-issue`,
`komus-jenkins-*`, `komus-k8s-readonly-health`.

```bash
python3 scripts/devops-contour-smoke.py --contour komus
# optional: export BITBUCKET_PROJECTS=CORP before smoke to probe that project
```

**Live Delivery proof (2026-09-18):** Bitbucket → Jenkins → runtime closed on VPN
with sibling `mcp.env` + `kubeconfigs/dev.yaml`:

```bash
set -a && source ../komus/.ai/mcp/mcp.env && set +a
export SRELENS_DEVOPS_PROFILE=komus
export BITBUCKET_PROJECTS=CORP
export JENKINS_JOBS='DOFFICE/EXPRESS_BOT/expressbot-build-deploy'
export KUBECONFIG=../komus/kubeconfigs/dev.yaml
srelens devops credentials set-from-env --profile komus
srelens devops profiles upsert --id komus --label Komus \
  --bitbucket https://bitbucket-app.komus.net --bitbucket-project CORP \
  --jenkins https://p-doffice-cicd01.komus.net \
  --jenkins-job 'DOFFICE/EXPRESS_BOT/expressbot-build-deploy'
srelens devops profiles select komus
# MCP devops.myWork → 20 deliveries, partial=false
srelens devops trace 'DOFFICE/EXPRESS_BOT/expressbot-build-deploy:65' \
  --anchor-kind build \
  --kube-context kubernetes-admin@dev-doffice-cluster \
  --namespace expressbot-dev
# → Bitbucket commits + Jenkins #65 + oci:65-dev → Deployment expressbot-dev
```

Off-VPN, Bitbucket / Jenkins / cluster API do not resolve; do not invent proofs.

## Credentials in the vault

Yes — that is the intended path on desktop:

1. Unlock vault at launch (`VaultGate`: password / biometric).
2. **Settings → DevOps** (workspace Settings embeds the same form): Apply contour
   endpoints, paste username/token, Save. Goes to `secrets.enc` via
   `devops_credential_set`. Values never read back into React.
3. CLI/MCP reuse the same vault when unlocked (`SRELENS_MASTER_PASSWORD` if
   password-locked). Process env is only a headless fallback for that run.

## Kubernetes OIDC (AppFarm)

AppFarm kubeconfigs use `kubectl oidc-login get-token` against Keycloak
(`auth.rshbdev.ru`). Tokens expire (often daily). The next API call through
srelens or kubectl runs the exec plugin, which **opens the system browser** for
login when interactive — same as bare kubectl. That is not the DevOps vault;
it is kube auth. Desktop repairs login-shell PATH at startup so the plugin is
found.

## CLI and MCP

Same capability registry for both. Connector secrets never go in argv.

```bash
# Work CLI (headless)
srelens devops profiles list
srelens devops jira search AFS-28457
srelens devops gitlab mrs
srelens devops trace OPS-142

# MCP (agents) — vault-backed when unlocked; else process env
srelens --mcp-stdio
srelens --mcp-http 127.0.0.1:8765
```

Credentials for headless:

1. Desktop vault (unlock with `SRELENS_MASTER_PASSWORD` when password-locked).
2. Else export `JIRA_USERNAME` / `JIRA_PASSWORD` / `GITLAB_TOKEN` (and Komus
   equivalents) in the process environment for that run.
3. Optional filter lists (comma-separated): `GITLAB_PROJECTS`,
   `BITBUCKET_PROJECTS`, `JENKINS_JOBS` — used by `credentials set-from-env`
   and the smoke script; never put tokens in argv.
4. Optional `SRELENS_DEVOPS_PROFILE` (default `appfarm`).

Public profile endpoints still live in durable settings (`devops.profiles.*`).
