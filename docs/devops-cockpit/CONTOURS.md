# Contours: AppFarm & Komus

Public endpoints and sibling credential paths for this fork. **Secrets are never
committed here** — they live in sibling repos / the desktop vault.

Canonical product direction:
[`DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md`](../../DEVOPS_WORKSPACE_REDESIGN_INSTRUCTIONS.md).

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

Smoke (VPN required):

```bash
python3 scripts/devops-contour-smoke.py --contour appfarm
# optional: export GITLAB_PROJECTS=group/project before smoke to probe that path
```

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
srelens devops trace OPS-142          # fixture until live correlation lands

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

