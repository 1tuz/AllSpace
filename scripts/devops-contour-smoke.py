#!/usr/bin/env python3
"""Smoke-test AppFarm / Komus contour reachability using sibling credential files.

Reads secrets from sibling repos only. Prints hostnames, HTTP codes, and counts —
never passwords or tokens.

Examples:
  python3 scripts/devops-contour-smoke.py --contour appfarm
  python3 scripts/devops-contour-smoke.py --contour komus
  python3 scripts/devops-contour-smoke.py --all
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

try:
    import requests
    import urllib3
except ModuleNotFoundError:
    print("Install requests first (sibling AppFarm venv has it).", file=sys.stderr)
    raise SystemExit(2)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

ROOT = Path(__file__).resolve().parents[1]

CONTOURS: dict[str, dict[str, Any]] = {
    "appfarm": {
        "env": Path("/Users/antony/Documents/projects/AppFarm/scripts/daily-reports-master/.env"),
        "jira_domain_key": "JIRA_DOMAIN",
        "jira_user_key": "JIRA_USERNAME",
        "jira_pass_key": "JIRA_PASSWORD",
        "gitlab_url_key": "GITLAB_URL",
        "gitlab_token_key": "GITLAB_TOKEN",
        "kubeconfig": Path("/Users/antony/Documents/projects/AppFarm/ops/kubeconfigs/cpstbl.yaml"),
    },
    "komus": {
        "env": Path("/Users/antony/Documents/projects/komus/.ai/mcp/mcp.env"),
        "bitbucket_url_key": "BITBUCKET_URL",
        "bitbucket_token_key": "BITBUCKET_TOKEN",
        "jenkins_url_key": "JENKINS_URL",
        "jenkins_user_key": "JENKINS_USERNAME",
        "jenkins_pass_key": "JENKINS_PASSWORD",
        "jira_domain_key": "JIRA_DOMAIN",
        "jira_user_key": "JIRA_USERNAME",
        "jira_pass_key": "JIRA_PASSWORD",
        "kubeconfig": Path("/Users/antony/Documents/projects/komus/kubeconfigs/dev.yaml"),
    },
}


def load_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise FileNotFoundError(f"credential file missing: {path}")
    out: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip("'").strip('"')
    return out


def host(url: str) -> str:
    u = urlparse(url if "://" in url else f"https://{url}")
    return f"{u.scheme}://{u.netloc}"


def csv_projects(*sources: dict[str, str] | None, key: str) -> list[str]:
    """Collect comma-separated project filters from process env and/or loaded .env."""
    raw = os.environ.get(key) or ""
    for source in sources:
        if source and not raw:
            raw = source.get(key, "")
    return [part.strip() for part in raw.split(",") if part.strip()]


def smoke_appfarm(env: dict[str, str], kubeconfig: Path) -> int:
    failures = 0
    jira = env["JIRA_DOMAIN"].rstrip("/")
    gl = env["GITLAB_URL"].rstrip("/")
    print(f"contour=appfarm jira={host(jira)} gitlab={host(gl)}")

    s = requests.Session()
    s.verify = False
    r = s.post(
        f"{jira}/rest/auth/1/session",
        json={"username": env["JIRA_USERNAME"], "password": env["JIRA_PASSWORD"]},
        timeout=20,
    )
    print(f"jira_session http={r.status_code}")
    if r.status_code not in (200, 201):
        failures += 1
    else:
        q = s.get(
            f"{jira}/rest/api/2/search",
            params={
                "jql": "assignee=currentUser() ORDER BY updated DESC",
                "maxResults": 3,
                "fields": "summary,status",
            },
            timeout=30,
        )
        print(f"jira_search http={q.status_code}")
        if q.ok:
            for issue in q.json().get("issues", []):
                print(f"  {issue.get('key')} {issue.get('fields', {}).get('status', {}).get('name')}")
        else:
            failures += 1

    h = {"PRIVATE-TOKEN": env["GITLAB_TOKEN"]}
    gu = requests.get(f"{gl}/api/v4/user", headers=h, verify=False, timeout=20)
    print(f"gitlab_user http={gu.status_code}")
    if not gu.ok:
        failures += 1
    gp = requests.get(
        f"{gl}/api/v4/projects",
        headers=h,
        params={"membership": "true", "per_page": 3, "simple": "true"},
        verify=False,
        timeout=20,
    )
    print(f"gitlab_projects http={gp.status_code} count={len(gp.json()) if gp.ok else 0}")
    if not gp.ok:
        failures += 1

    projects = csv_projects(env, key="GITLAB_PROJECTS")
    if projects:
        print(f"gitlab_project_filters count={len(projects)}")
        for path in projects:
            print(f"  project={path}")
        first = projects[0]
        encoded = quote(first, safe="")
        one = requests.get(
            f"{gl}/api/v4/projects/{encoded}",
            headers=h,
            verify=False,
            timeout=20,
        )
        print(f"gitlab_project_get path={first} http={one.status_code}")
        if not one.ok:
            failures += 1

    if kubeconfig.is_file():
        print(f"kubeconfig_present={kubeconfig.name}")
    else:
        print("kubeconfig_present=false")
        failures += 1
    return failures


def smoke_komus(env: dict[str, str], kubeconfig: Path) -> int:
    failures = 0
    bb = env.get("BITBUCKET_URL", "").rstrip("/")
    jk = env.get("JENKINS_URL", "").rstrip("/")
    print(f"contour=komus bitbucket={host(bb) if bb else 'missing'} jenkins={host(jk) if jk else 'missing'}")

    if bb and env.get("BITBUCKET_TOKEN"):
        try:
            r = requests.get(
                f"{bb}/rest/api/1.0/projects",
                headers={"Authorization": f"Bearer {env['BITBUCKET_TOKEN']}"},
                params={"limit": 3},
                verify=False,
                timeout=20,
            )
            print(f"bitbucket_projects http={r.status_code}")
            if not r.ok:
                failures += 1
        except requests.RequestException as exc:
            print(f"bitbucket_projects error={type(exc).__name__}")
            failures += 1

        bb_keys = csv_projects(env, key="BITBUCKET_PROJECTS")
        if bb_keys:
            print(f"bitbucket_project_filters count={len(bb_keys)}")
            for key in bb_keys:
                print(f"  project={key}")
            first = bb_keys[0]
            try:
                one = requests.get(
                    f"{bb}/rest/api/1.0/projects/{quote(first, safe='')}",
                    headers={"Authorization": f"Bearer {env['BITBUCKET_TOKEN']}"},
                    verify=False,
                    timeout=20,
                )
                print(f"bitbucket_project_get key={first} http={one.status_code}")
                if not one.ok:
                    failures += 1
            except requests.RequestException as exc:
                print(f"bitbucket_project_get error={type(exc).__name__}")
                failures += 1
    else:
        print("bitbucket skipped (missing url/token)")
        failures += 1

    if jk and env.get("JENKINS_USERNAME") and env.get("JENKINS_PASSWORD"):
        try:
            r = requests.get(
                f"{jk}/api/json",
                auth=(env["JENKINS_USERNAME"], env["JENKINS_PASSWORD"]),
                params={"tree": "nodeName,numExecutors"},
                verify=False,
                timeout=20,
            )
            print(f"jenkins_api http={r.status_code}")
            if not r.ok:
                failures += 1
        except requests.RequestException as exc:
            print(f"jenkins_api error={type(exc).__name__}")
            failures += 1
    else:
        print("jenkins skipped (missing url/user/pass)")
        failures += 1

    # Optional Komus Jira (DO-*) — separate from delivery root for Komus CI path
    jira = (env.get("JIRA_DOMAIN") or "").rstrip("/")
    if jira and env.get("JIRA_USERNAME") and env.get("JIRA_PASSWORD"):
        try:
            s = requests.Session()
            s.verify = False
            r = s.post(
                f"{jira}/rest/auth/1/session",
                json={"username": env["JIRA_USERNAME"], "password": env["JIRA_PASSWORD"]},
                timeout=20,
            )
            print(f"komus_jira_session http={r.status_code}")
            if r.status_code not in (200, 201):
                failures += 1
        except requests.RequestException as exc:
            print(f"komus_jira_session error={type(exc).__name__}")
            failures += 1

    if kubeconfig.is_file():
        print(f"kubeconfig_present={kubeconfig.name}")
    else:
        print("kubeconfig_present=false")
    return failures

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contour", choices=sorted(CONTOURS), help="Single contour")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if not args.contour and not args.all:
        parser.error("pass --contour or --all")

    names = list(CONTOURS) if args.all else [args.contour]
    total = 0
    for name in names:
        cfg = CONTOURS[name]
        print(f"--- {name} ---")
        try:
            env = load_env(cfg["env"])
        except FileNotFoundError as exc:
            print(exc)
            total += 1
            continue
        if name == "appfarm":
            total += smoke_appfarm(env, cfg["kubeconfig"])
        else:
            total += smoke_komus(env, cfg["kubeconfig"])
    print(f"failures={total}")
    return 1 if total else 0


if __name__ == "__main__":
    raise SystemExit(main())
