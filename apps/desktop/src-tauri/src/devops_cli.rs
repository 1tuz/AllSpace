//! Headless `srelens devops …` — same capability registry as GUI / MCP.
//!
//! Credentials never appear in argv. Prefer the desktop vault; when the vault
//! is locked/unavailable, fall back to process-scoped credentials from env
//! (`JIRA_*` / `GITLAB_*` / …) so CLI and MCP still work for the current process.

use std::sync::Arc;

use serde_json::{json, Value};
use srelens_capability::Registry;
use srelens_devops_profiles::{
    Credential, CredentialRef, CredentialStore, Provider, SessionCredentials,
};

use crate::vault::{unlock_with_master_password, Vault, VaultCredentialStore};

/// Shared config dir with GUI / MCP (`…/app.srelens.desktop/mcp`).
pub fn mcp_dir() -> std::path::PathBuf {
    dirs::config_dir()
        .expect("could not resolve the platform config directory")
        .join("app.srelens.desktop")
        .join("mcp")
}

/// Open the desktop vault and unlock when password-gated.
pub fn open_vault(master_password: Option<String>) -> Arc<Vault> {
    let vault = Arc::new(Vault::open(&mcp_dir()));
    if matches!(vault.key_source(), "password-locked" | "biometric-locked") {
        match master_password {
            Some(password) => {
                if let Err(e) = unlock_with_master_password(&vault, &mcp_dir(), &password) {
                    eprintln!("srelens: SRELENS_MASTER_PASSWORD did not unlock the vault: {e}");
                    std::process::exit(2);
                }
            }
            None => eprintln!(
                "srelens: vault is password-locked; set SRELENS_MASTER_PASSWORD to unlock it, or export JIRA_*/GITLAB_TOKEN for this process"
            ),
        }
    }
    vault
}

fn seed_session_from_env(store: &SessionCredentials, profile_id: &str) {
    if let (Ok(user), Ok(secret)) = (std::env::var("JIRA_USERNAME"), std::env::var("JIRA_PASSWORD")) {
        if !secret.is_empty() {
            let _ = store.remember(
                &CredentialRef::new(profile_id, Provider::Jira),
                Credential { username: user, secret },
            );
        }
    }
    if let Ok(token) = std::env::var("GITLAB_TOKEN") {
        if !token.is_empty() {
            let _ = store.remember(
                &CredentialRef::new(profile_id, Provider::Gitlab),
                Credential {
                    username: String::new(),
                    secret: token,
                },
            );
        }
    }
    if let Ok(token) = std::env::var("BITBUCKET_TOKEN") {
        if !token.is_empty() {
            let _ = store.remember(
                &CredentialRef::new(profile_id, Provider::BitbucketDc),
                Credential {
                    username: String::new(),
                    secret: token,
                },
            );
        }
    }
    if let (Ok(user), Ok(secret)) =
        (std::env::var("JENKINS_USERNAME"), std::env::var("JENKINS_PASSWORD"))
    {
        if !secret.is_empty() {
            let _ = store.remember(
                &CredentialRef::new(profile_id, Provider::Jenkins),
                Credential { username: user, secret },
            );
        }
    }
}

fn active_profile_hint() -> String {
    std::env::var("SRELENS_DEVOPS_PROFILE")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "appfarm".into())
}

/// Credential store for headless: vault when unlocked, else session seeded from env.
pub fn headless_credentials(vault: Arc<Vault>) -> Arc<dyn CredentialStore> {
    let vault_store = VaultCredentialStore::new(vault);
    let probe = CredentialRef::new("__probe__", Provider::Jira);
    match vault_store.resolve(&probe) {
        Ok(_) => Arc::new(vault_store),
        Err(_) => {
            let session = SessionCredentials::new();
            seed_session_from_env(&session, &active_profile_hint());
            if std::env::var("BITBUCKET_TOKEN").is_ok() {
                seed_session_from_env(&session, "komus");
            }
            Arc::new(session)
        }
    }
}

/// Registry + credential store for headless devops / MCP.
pub fn headless_registry(vault: Arc<Vault>) -> Registry {
    let cache = srelens_kube::client_cache::ClientCache::new_many(
        srelens_registry::all_kubeconfig_paths(),
    );
    crate::capabilities::build_registry_with_paths_and_settings(
        cache,
        crate::capabilities::default_kubeconfig_paths(),
        crate::capabilities::default_settings_path(),
        headless_credentials(vault),
    )
}

pub fn run(args: &[String], master_password: Option<String>) -> ! {
    if args.is_empty() || args.iter().any(|a| a == "-h" || a == "--help") {
        print_help();
        std::process::exit(0);
    }

    let vault = open_vault(master_password);
    let credentials = headless_credentials(vault);
    let registry = {
        let cache = srelens_kube::client_cache::ClientCache::new_many(
            srelens_registry::all_kubeconfig_paths(),
        );
        crate::capabilities::build_registry_with_paths_and_settings(
            cache,
            crate::capabilities::default_kubeconfig_paths(),
            crate::capabilities::default_settings_path(),
            credentials.clone(),
        )
    };

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");

    let code = runtime.block_on(async { dispatch(&registry, credentials.as_ref(), args).await });
    std::process::exit(code);
}

async fn dispatch(registry: &Registry, store: &dyn CredentialStore, args: &[String]) -> i32 {
    match args[0].as_str() {
        "profiles" => profiles(registry, &args[1..]).await,
        "trace" => trace(registry, &args[1..]).await,
        "jira" => jira(registry, &args[1..]).await,
        "gitlab" => gitlab(registry, &args[1..]).await,
        "credentials" => credentials_cmd(store, registry, &args[1..]).await,
        other => {
            eprintln!("unknown devops command: {other}");
            print_help();
            2
        }
    }
}

async fn invoke(registry: &Registry, id: &str, input: Value) -> Result<Value, String> {
    registry
        .invoke(id, input)
        .await
        .map_err(|e| e.to_string())
}

fn print_json(value: &Value) {
    println!("{}", serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()));
}

async fn profiles(registry: &Registry, args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        None | Some("list") => match invoke(registry, "devops.profiles.list", json!({})).await {
            Ok(v) => {
                print_json(&v);
                0
            }
            Err(e) => {
                eprintln!("devops.profiles.list failed: {e}");
                1
            }
        },
        Some("select") => {
            let Some(id) = args.get(1) else {
                eprintln!("usage: srelens devops profiles select <profileId>");
                return 2;
            };
            match invoke(registry, "devops.profiles.select", json!({ "profileId": id })).await {
                Ok(v) => {
                    print_json(&v);
                    0
                }
                Err(e) => {
                    eprintln!("devops.profiles.select failed: {e}");
                    1
                }
            }
        }
        Some("upsert") => upsert_profile(registry, &args[1..]).await,
        Some(other) => {
            eprintln!("unknown profiles subcommand: {other}");
            2
        }
    }
}

async fn upsert_profile(registry: &Registry, args: &[String]) -> i32 {
    let mut id = None;
    let mut label = None;
    let mut jira = None;
    let mut gitlab = None;
    let mut gitlab_projects: Vec<String> = Vec::new();
    let mut bitbucket = None;
    let mut bitbucket_projects: Vec<String> = Vec::new();
    let mut jenkins = None;
    let mut jenkins_jobs: Vec<String> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--id" => {
                id = args.get(i + 1).cloned();
                i += 2;
            }
            "--label" => {
                label = args.get(i + 1).cloned();
                i += 2;
            }
            "--jira" => {
                jira = args.get(i + 1).cloned();
                i += 2;
            }
            "--gitlab" => {
                gitlab = args.get(i + 1).cloned();
                i += 2;
            }
            "--gitlab-project" => {
                if let Some(p) = args.get(i + 1) {
                    gitlab_projects.push(p.clone());
                }
                i += 2;
            }
            "--bitbucket" => {
                bitbucket = args.get(i + 1).cloned();
                i += 2;
            }
            "--bitbucket-project" => {
                if let Some(p) = args.get(i + 1) {
                    bitbucket_projects.push(p.clone());
                }
                i += 2;
            }
            "--jenkins" => {
                jenkins = args.get(i + 1).cloned();
                i += 2;
            }
            "--jenkins-job" => {
                if let Some(p) = args.get(i + 1) {
                    jenkins_jobs.push(p.clone());
                }
                i += 2;
            }
            other => {
                eprintln!("unknown flag: {other}");
                return 2;
            }
        }
    }
    let (Some(id), Some(label)) = (id, label) else {
        eprintln!("usage: srelens devops profiles upsert --id ID --label LABEL [--jira URL] [--gitlab URL] …");
        return 2;
    };
    let mut providers = Vec::new();
    if let Some(base_url) = jira {
        providers.push(json!({
            "provider": "jira",
            "baseUrl": base_url.trim_end_matches('/'),
            "authMethod": "session",
            "projectFilters": []
        }));
    }
    if let Some(base_url) = gitlab {
        providers.push(json!({
            "provider": "gitlab",
            "baseUrl": base_url.trim_end_matches('/'),
            "authMethod": "accessToken",
            "projectFilters": gitlab_projects
        }));
    }
    if let Some(base_url) = bitbucket {
        providers.push(json!({
            "provider": "bitbucketDc",
            "baseUrl": base_url.trim_end_matches('/'),
            "authMethod": "bearerToken",
            "projectFilters": bitbucket_projects
        }));
    }
    if let Some(base_url) = jenkins {
        providers.push(json!({
            "provider": "jenkins",
            "baseUrl": base_url.trim_end_matches('/'),
            "authMethod": "basic",
            "projectFilters": jenkins_jobs
        }));
    }
    if providers.is_empty() {
        eprintln!("provide at least one of --jira / --gitlab / --bitbucket / --jenkins");
        return 2;
    }
    let input = json!({
        "profile": { "id": id, "label": label, "providers": providers },
        "select": true
    });
    match invoke(registry, "devops.profiles.upsert", input).await {
        Ok(v) => {
            print_json(&v);
            0
        }
        Err(e) => {
            eprintln!("devops.profiles.upsert failed: {e}");
            1
        }
    }
}

async fn trace(registry: &Registry, args: &[String]) -> i32 {
    let input = match trace_input(args) {
        Ok(input) => input,
        Err(error) => {
            eprintln!("{error}");
            eprintln!("usage: srelens devops trace <issueKey> [--kube-context CONTEXT] [--namespace NAME]…");
            return 2;
        }
    };
    let Some(key) = args.first() else {
        eprintln!("usage: srelens devops trace <issueKey> [--kube-context CONTEXT] [--namespace NAME]…");
        return 2;
    };
    let live = invoke(registry, "devops.traceDelivery", input).await;
    match live {
        Ok(v) if v.get("nodes").and_then(|n| n.as_array()).is_some_and(|n| !n.is_empty()) => {
            print_json(&v);
            0
        }
        Ok(partial) => match invoke(registry, "devops.traceIssue", json!({ "issueKey": key })).await {
            Ok(fixture)
                if fixture
                    .get("nodes")
                    .and_then(|n| n.as_array())
                    .is_some_and(|n| !n.is_empty()) =>
            {
                // Keep live sourceErrors on the fixture so "partial" stays honest.
                let mut out = fixture;
                if let Some(obj) = out.as_object_mut() {
                    if let Some(errors) = partial.get("sourceErrors") {
                        obj.insert("sourceErrors".into(), errors.clone());
                    }
                    if partial.get("partial") == Some(&json!(true))
                        || partial
                            .get("sourceErrors")
                            .and_then(|e| e.as_array())
                            .is_some_and(|e| !e.is_empty())
                    {
                        obj.insert("partial".into(), json!(true));
                    }
                }
                print_json(&out);
                0
            }
            Ok(_) => {
                print_json(&partial);
                0
            }
            Err(e) => {
                eprintln!("devops.traceIssue fallback failed: {e}");
                print_json(&partial);
                0
            }
        },
        Err(e) => match invoke(registry, "devops.traceIssue", json!({ "issueKey": key })).await {
            Ok(v) => {
                print_json(&v);
                0
            }
            Err(_) => {
                eprintln!("devops.traceDelivery failed: {e}");
                1
            }
        },
    }
}

fn trace_input(args: &[String]) -> Result<Value, String> {
    let issue_key = args.first().filter(|key| !key.starts_with("--"))
        .ok_or("an issue key is required")?;
    let mut kube_context = None;
    let mut namespaces = Vec::new();
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--kube-context" => {
                kube_context = args.get(index + 1).cloned().filter(|value| !value.is_empty());
                if kube_context.is_none() {
                    return Err("--kube-context needs a context name".into());
                }
                index += 2;
            }
            "--namespace" => {
                let namespace = args.get(index + 1).cloned().filter(|value| !value.is_empty())
                    .ok_or("--namespace needs a namespace")?;
                namespaces.push(namespace);
                index += 2;
            }
            flag => return Err(format!("unknown trace option: {flag}")),
        }
    }
    Ok(json!({
        "issueKey": issue_key,
        "kubeContext": kube_context,
        "namespaces": namespaces,
    }))
}

async fn jira(registry: &Registry, args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("search") => {
            let keys: Vec<&str> = args[1..].iter().map(String::as_str).collect();
            if keys.is_empty() {
                eprintln!("usage: srelens devops jira search <ISSUE> [ISSUE…]");
                return 2;
            }
            match invoke(registry, "jira.searchIssues", json!({ "issueKeys": keys })).await {
                Ok(v) => {
                    print_json(&v);
                    0
                }
                Err(e) => {
                    eprintln!("jira.searchIssues failed: {e}");
                    1
                }
            }
        }
        _ => {
            eprintln!("usage: srelens devops jira search <ISSUE> [ISSUE…]");
            2
        }
    }
}

async fn gitlab(registry: &Registry, args: &[String]) -> i32 {
    let id = match args.first().map(String::as_str) {
        Some("mrs") | Some("merge-requests") => "gitlab.listMergeRequests",
        Some("commits") => "gitlab.listCommits",
        Some("pipelines") => "gitlab.listPipelines",
        _ => {
            eprintln!("usage: srelens devops gitlab <mrs|commits|pipelines>");
            return 2;
        }
    };
    match invoke(registry, id, json!({})).await {
        Ok(v) => {
            print_json(&v);
            0
        }
        Err(e) => {
            eprintln!("{id} failed: {e}");
            1
        }
    }
}

async fn credentials_cmd(
    store: &dyn CredentialStore,
    registry: &Registry,
    args: &[String],
) -> i32 {
    match args.first().map(String::as_str) {
        Some("status") => {
            let refs = store.configured();
            let out: Vec<Value> = refs
                .into_iter()
                .map(|r| json!({ "profileId": r.profile_id, "provider": r.provider.slug() }))
                .collect();
            print_json(&json!({ "credentials": out }));
            0
        }
        Some("set-from-env") => set_from_env(store, registry, &args[1..]).await,
        _ => {
            eprintln!("usage: srelens devops credentials <status|set-from-env --profile ID>");
            2
        }
    }
}

async fn set_from_env(
    store: &dyn CredentialStore,
    registry: &Registry,
    args: &[String],
) -> i32 {
    let mut profile = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--profile" => {
                profile = args.get(i + 1).cloned();
                i += 2;
            }
            other => {
                eprintln!("unknown flag: {other}");
                return 2;
            }
        }
    }
    let Some(profile_id) = profile else {
        eprintln!("usage: srelens devops credentials set-from-env --profile <id>");
        return 2;
    };

    // Credential import must not broaden a profile that was already scoped in
    // Settings. Empty env filter variables mean “keep the saved boundary”,
    // not “scan every project visible to this token”.
    let profiles = invoke(registry, "devops.profiles.list", json!({})).await.ok();
    let gitlab_filters = profile_filters(
        profiles.as_ref().unwrap_or(&Value::Null),
        &profile_id,
        "gitlab",
        env_csv("GITLAB_PROJECTS"),
    );
    let bitbucket_filters = profile_filters(
        profiles.as_ref().unwrap_or(&Value::Null),
        &profile_id,
        "bitbucketDc",
        env_csv("BITBUCKET_PROJECTS"),
    );
    let jenkins_filters = profile_filters(
        profiles.as_ref().unwrap_or(&Value::Null),
        &profile_id,
        "jenkins",
        env_csv("JENKINS_JOBS"),
    );

    if let (Ok(jira_url), Ok(_)) = (std::env::var("JIRA_DOMAIN"), std::env::var("JIRA_PASSWORD")) {
        let gitlab_url = std::env::var("GITLAB_URL").ok();
        let mut providers = vec![json!({
            "provider": "jira",
            "baseUrl": jira_url.trim_end_matches('/'),
            "authMethod": "session",
            "projectFilters": []
        })];
        if let Some(url) = gitlab_url {
            providers.push(json!({
                "provider": "gitlab",
                "baseUrl": url.trim_end_matches('/'),
                "authMethod": "accessToken",
                "projectFilters": gitlab_filters
            }));
        }
        let _ = invoke(
            registry,
            "devops.profiles.upsert",
            json!({
                "profile": { "id": profile_id, "label": profile_id, "providers": providers },
                "select": true
            }),
        )
        .await;
    }
    if let (Ok(bb), Ok(_)) = (std::env::var("BITBUCKET_URL"), std::env::var("BITBUCKET_TOKEN")) {
        let mut providers = vec![json!({
            "provider": "bitbucketDc",
            "baseUrl": bb.trim_end_matches('/'),
            "authMethod": "bearerToken",
            "projectFilters": bitbucket_filters
        })];
        if let Ok(jk) = std::env::var("JENKINS_URL") {
            providers.push(json!({
                "provider": "jenkins",
                "baseUrl": jk.trim_end_matches('/'),
                "authMethod": "basic",
                "projectFilters": jenkins_filters
            }));
        }
        let _ = invoke(
            registry,
            "devops.profiles.upsert",
            json!({
                "profile": { "id": profile_id, "label": profile_id, "providers": providers },
                "select": true
            }),
        )
        .await;
    }

    let mut saved = Vec::new();
    if let (Ok(user), Ok(secret)) = (std::env::var("JIRA_USERNAME"), std::env::var("JIRA_PASSWORD")) {
        if !secret.is_empty() {
            if let Err(e) = store.remember(
                &CredentialRef::new(&profile_id, Provider::Jira),
                Credential { username: user, secret },
            ) {
                eprintln!("jira credential: {e}");
                return 1;
            }
            saved.push("jira");
        }
    }
    if let Ok(token) = std::env::var("GITLAB_TOKEN") {
        if !token.is_empty() {
            if let Err(e) = store.remember(
                &CredentialRef::new(&profile_id, Provider::Gitlab),
                Credential {
                    username: String::new(),
                    secret: token,
                },
            ) {
                eprintln!("gitlab credential: {e}");
                return 1;
            }
            saved.push("gitlab");
        }
    }
    if let Ok(token) = std::env::var("BITBUCKET_TOKEN") {
        if !token.is_empty() {
            if let Err(e) = store.remember(
                &CredentialRef::new(&profile_id, Provider::BitbucketDc),
                Credential {
                    username: String::new(),
                    secret: token,
                },
            ) {
                eprintln!("bitbucket credential: {e}");
                return 1;
            }
            saved.push("bitbucketDc");
        }
    }
    if let (Ok(user), Ok(secret)) =
        (std::env::var("JENKINS_USERNAME"), std::env::var("JENKINS_PASSWORD"))
    {
        if !secret.is_empty() {
            if let Err(e) = store.remember(
                &CredentialRef::new(&profile_id, Provider::Jenkins),
                Credential { username: user, secret },
            ) {
                eprintln!("jenkins credential: {e}");
                return 1;
            }
            saved.push("jenkins");
        }
    }

    if saved.is_empty() {
        eprintln!("no recognized credential env vars set (JIRA_*/GITLAB_TOKEN/BITBUCKET_TOKEN/JENKINS_*)");
        return 1;
    }
    print_json(&json!({ "profileId": profile_id, "savedProviders": saved }));
    0
}

fn profile_filters(
    profiles: &Value,
    profile_id: &str,
    provider: &str,
    from_env: Vec<String>,
) -> Vec<String> {
    if !from_env.is_empty() {
        return from_env;
    }
    profiles
        .get("profiles")
        .and_then(Value::as_array)
        .and_then(|profiles| profiles.iter().find(|profile| profile.get("id") == Some(&json!(profile_id))))
        .and_then(|profile| profile.get("providers"))
        .and_then(Value::as_array)
        .and_then(|providers| providers.iter().find(|item| item.get("provider") == Some(&json!(provider))))
        .and_then(|item| item.get("projectFilters"))
        .and_then(Value::as_array)
        .map(|filters| {
            filters
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn env_csv(name: &str) -> Vec<String> {
    std::env::var(name)
        .ok()
        .map(|raw| {
            raw.split(',')
                .map(|part| part.trim().to_string())
                .filter(|part| !part.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn print_help() {
    eprintln!(
        "\
srelens devops — delivery / DevOps capabilities (same registry as MCP)

Usage:
  srelens devops profiles list
  srelens devops profiles select <profileId>
  srelens devops profiles upsert --id ID --label LABEL [--jira URL] [--gitlab URL] \\
      [--gitlab-project PATH]… [--bitbucket URL] [--bitbucket-project KEY]… \\
      [--jenkins URL] [--jenkins-job PATH]…
  srelens devops trace <issueKey> [--kube-context CONTEXT] [--namespace NAME]…
  srelens devops jira search <ISSUE> [ISSUE…]
  srelens devops gitlab <mrs|commits|pipelines>
  srelens devops credentials status
  srelens devops credentials set-from-env --profile <id>

Credentials (never in argv):
  1. Desktop vault when unlocked (SRELENS_MASTER_PASSWORD if password-locked)
  2. Else process env for this run: JIRA_USERNAME/PASSWORD, GITLAB_TOKEN,
     BITBUCKET_TOKEN, JENKINS_USERNAME/PASSWORD
  Optional filters (comma-separated): GITLAB_PROJECTS, BITBUCKET_PROJECTS, JENKINS_JOBS
  Optional: SRELENS_DEVOPS_PROFILE (default appfarm) when using env fallback

MCP (same vault / env credential rules):
  srelens --mcp-stdio
  srelens --mcp-http [addr]"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trace_input_keeps_the_explicit_runtime_scope() {
        let args = vec![
            "AFS-28457".into(),
            "--kube-context".into(),
            "devstbl".into(),
            "--namespace".into(),
            "appfarm".into(),
        ];

        assert_eq!(
            trace_input(&args).unwrap(),
            json!({
                "issueKey": "AFS-28457",
                "kubeContext": "devstbl",
                "namespaces": ["appfarm"],
            })
        );
    }

    #[test]
    fn imported_credentials_keep_existing_project_filters_when_env_omits_them() {
        let profiles = json!({
            "profiles": [{
                "id": "appfarm",
                "providers": [{ "provider": "gitlab", "projectFilters": ["appfarm/infra/k8s/gitlab"] }]
            }]
        });

        assert_eq!(
            profile_filters(&profiles, "appfarm", "gitlab", vec![]),
            vec!["appfarm/infra/k8s/gitlab"]
        );
    }
}
