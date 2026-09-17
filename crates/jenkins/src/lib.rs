use base64::Engine;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use srelens_capability::{Annotations, Capability, CapabilityError};
use srelens_devops_model::{Entity, EntityKind, Source};
use srelens_devops_profiles::{active_connection, AuthMethod, CredentialStore, Provider};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JenkinsRequest {
    pub url: String,
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct JenkinsResponse {
    pub status: u16,
    pub body: Value,
}

impl JenkinsResponse {
    pub fn json(status: u16, body: Value) -> Self {
        Self { status, body }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JenkinsError {
    InvalidBaseUrl,
    InvalidCredentials,
    Transport(String),
    UnexpectedStatus(u16),
    InvalidResponse(String),
}

/// Read-only Jenkins auth. Basic login/password and Basic login/API-token are
/// both sent as `Authorization: Basic`; an API token replaces the password.
/// A crumb issuer is deliberately absent: read-only GETs do not need one, and
/// crumb handling belongs to future write operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JenkinsAuth {
    username: String,
    secret: String,
}

impl JenkinsAuth {
    pub fn password(username: impl Into<String>, password: impl Into<String>) -> Self {
        Self {
            username: username.into(),
            secret: password.into(),
        }
    }

    pub fn api_token(username: impl Into<String>, token: impl Into<String>) -> Self {
        Self {
            username: username.into(),
            secret: token.into(),
        }
    }

    fn header(&self) -> Result<String, JenkinsError> {
        if self.username.is_empty() || self.secret.is_empty() {
            return Err(JenkinsError::InvalidCredentials);
        }
        let encoded = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:{}", self.username, self.secret));
        Ok(format!("Basic {encoded}"))
    }

    /// The `Authorization` header value; used by tests to assert the wire
    /// format without a live transport.
    pub fn header_value(&self) -> Result<String, JenkinsError> {
        self.header()
    }
}

pub trait JenkinsTransport {
    fn get(&self, request: JenkinsRequest) -> Result<JenkinsResponse, JenkinsError>;
}

/// An `Arc` is a transport too, so a capability can share one across calls.
impl<T: JenkinsTransport + ?Sized> JenkinsTransport for Arc<T> {
    fn get(&self, request: JenkinsRequest) -> Result<JenkinsResponse, JenkinsError> {
        (**self).get(request)
    }
}

impl<T: JenkinsTransport + ?Sized> JenkinsTransport for &T {
    fn get(&self, request: JenkinsRequest) -> Result<JenkinsResponse, JenkinsError> {
        (*self).get(request)
    }
}

pub struct ReqwestJenkinsTransport {
    client: reqwest::blocking::Client,
}

impl ReqwestJenkinsTransport {
    pub fn new() -> Result<Self, JenkinsError> {
        // This crate builds the HTTP client, so it must name the crypto
        // provider itself — mirrors gitlab/jira/bitbucket.
        let _ = rustls::crypto::ring::default_provider().install_default();
        // Komus Jenkins may present private-CA TLS; match other provider crates.
        let client = reqwest::blocking::Client::builder()
            .danger_accept_invalid_certs(true)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| JenkinsError::Transport(e.to_string()))?;
        Ok(Self { client })
    }
}

impl JenkinsTransport for ReqwestJenkinsTransport {
    fn get(&self, request: JenkinsRequest) -> Result<JenkinsResponse, JenkinsError> {
        let mut builder = self.client.get(&request.url);
        for (name, value) in request.headers {
            builder = builder.header(name, value);
        }
        let response = builder
            .send()
            .map_err(|e| JenkinsError::Transport(e.to_string()))?;
        let status = response.status().as_u16();
        let body = response
            .json()
            .map_err(|e| JenkinsError::InvalidResponse(e.to_string()))?;
        Ok(JenkinsResponse { status, body })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JenkinsJob {
    /// Bare job name inside its folder. Multibranch jobs appear as folders
    /// with their branches nested, so the full path is what callers track.
    pub name: String,
    #[serde(rename = "fullName", default)]
    pub full_name: Option<String>,
    #[serde(rename = "url", default)]
    pub url: Option<String>,
    #[serde(default)]
    pub jobs: Vec<JenkinsJob>,
    #[serde(rename = "_class", default)]
    pub class: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JenkinsBuild {
    pub number: u64,
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default)]
    pub building: Option<bool>,
    #[serde(rename = "fullDisplayName", default)]
    pub full_display_name: Option<String>,
    #[serde(rename = "url", default)]
    pub url: Option<String>,
    #[serde(default, rename = "timestamp")]
    pub timestamp_ms: Option<u64>,
    #[serde(default)]
    pub actions: Vec<JenkinsAction>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JenkinsAction {
    #[serde(rename = "_class", default)]
    pub class: Option<String>,
    #[serde(default)]
    pub parameters: Vec<JenkinsParameter>,
    #[serde(rename = "lastBuiltRevision", default)]
    pub last_built_revision: Option<Value>,
    #[serde(rename = "buildsByBranchName", default)]
    pub builds_by_branch_name: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JenkinsParameter {
    pub name: String,
    #[serde(default)]
    pub value: Option<Value>,
}

impl JenkinsAction {
    /// The build's SCM revision. Jenkins Pipeline exposes it through
    /// `GitSCM`'s `lastBuiltRevision` (`SHA1` inside); Multibranch builds may
    /// instead carry the branch build actions. Short SHAs are never treated
    /// as exact matches upstream — the caller decides confidence.
    pub fn built_revision(&self) -> Option<String> {
        self.last_built_revision
            .as_ref()
            .and_then(|revision| revision["SHA1"].as_str().map(str::to_owned))
    }
}

impl JenkinsBuild {
    /// Explicit build parameters, merged across `ParametersAction`s.
    pub fn parameters(&self) -> Vec<(String, Value)> {
        self.actions
            .iter()
            .flat_map(|action| action.parameters.iter())
            .filter_map(|parameter| {
                parameter
                    .value
                    .clone()
                    .map(|value| (parameter.name.clone(), value))
            })
            .collect()
    }
}

pub struct JenkinsClient<T> {
    base_url: String,
    auth: JenkinsAuth,
    transport: T,
}

impl<T: JenkinsTransport> JenkinsClient<T> {
    pub fn new(base_url: &str, auth: JenkinsAuth, transport: T) -> Result<Self, JenkinsError> {
        let base_url = base_url.trim_end_matches('/');
        if !base_url.starts_with("https://") || base_url.len() == "https://".len() {
            return Err(JenkinsError::InvalidBaseUrl);
        }
        auth.header()?;
        Ok(Self {
            base_url: base_url.into(),
            auth,
            transport,
        })
    }

    fn get_json(&self, path: &str, tree: &str) -> Result<Value, JenkinsError> {
        let response = self.transport.get(JenkinsRequest {
            url: format!("{}{path}?tree={tree}", self.base_url),
            headers: BTreeMap::from([("Authorization".into(), self.auth.header()?)]),
        })?;
        if !(200..300).contains(&response.status) {
            return Err(JenkinsError::UnexpectedStatus(response.status));
        }
        Ok(response.body)
    }

    /// List top-level Pipeline/Multibranch jobs. Nested folders are returned
    /// with their children via `tree` recursion, one level deep — enough for
    /// a Multibranch Pipeline project whose branches are jobs.
    pub fn list_jobs(&self) -> Result<Vec<JenkinsJob>, JenkinsError> {
        let body = self.get_json(
            "/api/json",
            "jobs[name,fullName,url,_class,jobs[name,fullName,url,_class]]",
        )?;
        serde_json::from_value(body["jobs"].clone())
            .map_err(|error| JenkinsError::InvalidResponse(error.to_string()))
    }

    /// Encode a slash-joined job path as Jenkins nested URL segments:
    /// `payments-api/main` → `/job/payments-api/job/main`.
    fn job_api_prefix(job_path: &str) -> Result<String, JenkinsError> {
        if job_path.is_empty() || job_path.starts_with('/') || job_path.contains("..") {
            return Err(JenkinsError::InvalidResponse("invalid job path".into()));
        }
        let segments: Vec<&str> = job_path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect();
        if segments.is_empty() {
            return Err(JenkinsError::InvalidResponse("invalid job path".into()));
        }
        Ok(format!(
            "/{}",
            segments
                .iter()
                .map(|segment| format!("job/{segment}"))
                .collect::<Vec<_>>()
                .join("/")
        ))
    }

    /// List builds of one job, newest first, with build actions included so
    /// callers can extract parameters and the SCM revision.
    pub fn list_builds(&self, job_path: &str) -> Result<Vec<JenkinsBuild>, JenkinsError> {
        let body = self.get_json(
            &format!("{}/api/json", Self::job_api_prefix(job_path)?),
            "builds[number,result,building,fullDisplayName,url,timestamp,actions[_class,parameters[name,value],lastBuiltRevision[SHA1],buildsByBranchName]]",
        )?;
        serde_json::from_value(body["builds"].clone())
            .map_err(|error| JenkinsError::InvalidResponse(error.to_string()))
    }

    /// One build with its actions. `job_path` is the slash-joined job path,
    /// e.g. `payments-api/main` for a Multibranch branch job.
    pub fn get_build(&self, job_path: &str, number: u64) -> Result<JenkinsBuild, JenkinsError> {
        let body = self.get_json(
            &format!("{}/{number}/api/json", Self::job_api_prefix(job_path)?),
            "number,result,building,fullDisplayName,url,timestamp,actions[_class,parameters[name,value],lastBuiltRevision[SHA1],buildsByBranchName]]",
        )?;
        serde_json::from_value(body)
            .map_err(|error| JenkinsError::InvalidResponse(error.to_string()))
    }
}

/// Convert a Jenkins build into the provider-neutral build entity. The job
/// path is part of the id: two branch jobs may share a build number.
pub fn normalize_build(job_path: &str, build: &JenkinsBuild) -> Entity {
    let status = if build.building == Some(true) {
        "building".to_string()
    } else {
        build
            .result
            .clone()
            .unwrap_or_else(|| "unknown".to_string())
    };
    let sha = build
        .actions
        .iter()
        .find_map(|action| action.built_revision());
    Entity {
        id: format!("jenkins:{job_path}:{}", build.number),
        kind: EntityKind::Build,
        source: Source::Jenkins,
        title: build
            .full_display_name
            .clone()
            .unwrap_or_else(|| format!("{job_path} #{}", build.number)),
        url: build.url.clone(),
        attributes: json!({
            "jobPath": job_path,
            "buildNumber": build.number,
            "status": status,
            "timestamp": build.timestamp_ms,
            "scmRevision": sha,
            "sha": sha,
        }),
    }
}

impl std::fmt::Display for JenkinsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JenkinsError::InvalidBaseUrl => write!(f, "the Jenkins base URL is unusable"),
            JenkinsError::InvalidCredentials => {
                write!(f, "the Jenkins credentials are empty or unusable")
            }
            JenkinsError::Transport(reason) => write!(f, "the Jenkins request failed: {reason}"),
            JenkinsError::UnexpectedStatus(status) => {
                write!(f, "Jenkins answered with HTTP {status}")
            }
            JenkinsError::InvalidResponse(reason) => {
                write!(f, "Jenkins returned an unexpected payload: {reason}")
            }
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListBuildsIn {
    /// Narrows the profile's own job filters for this call. Empty means
    /// "use what the profile already names".
    #[serde(default)]
    pub project_filters: Vec<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListBuildsOut {
    pub builds: Vec<Entity>,
    /// The leaf job fullNames that matched the filters and were queried.
    pub jobs: Vec<String>,
}

fn jenkins_auth(
    auth_method: &AuthMethod,
    username: &str,
    secret: &str,
) -> Result<JenkinsAuth, CapabilityError> {
    match auth_method {
        AuthMethod::Basic | AuthMethod::AccessToken => {
            Ok(JenkinsAuth::password(username, secret))
        }
        _ => Err(CapabilityError::Handler(
            "Jenkins credentials must be basic or an access token".into(),
        )),
    }
}

fn collect_leaf_job_names(jobs: &[JenkinsJob]) -> Vec<String> {
    let mut leaves = Vec::new();
    for job in jobs {
        let full_name = job
            .full_name
            .clone()
            .unwrap_or_else(|| job.name.clone());
        if job.jobs.is_empty() {
            leaves.push(full_name);
        } else {
            leaves.extend(collect_leaf_job_names(&job.jobs));
        }
    }
    leaves
}

fn job_matches_filters(full_name: &str, filters: &[String]) -> bool {
    filters.iter().any(|filter| {
        full_name == filter.as_str()
            || full_name.starts_with(filter)
            || filter.starts_with(full_name)
    })
}

/// `jenkins.listBuilds` — list builds of the active profile's named jobs.
pub fn list_builds_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn() -> Result<Arc<dyn JenkinsTransport + Send + Sync>, JenkinsError> + Send + Sync,
    >,
) -> Capability {
    Capability::typed::<ListBuildsIn, ListBuildsOut, _, _>(
        "jenkins.listBuilds",
        "list builds of the active DevOps profile's Jenkins jobs",
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                let connection = active_connection(&settings, store.as_ref(), Provider::Jenkins)
                    .await
                    .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let filters = if input.project_filters.is_empty() {
                    connection.project_filters.clone()
                } else {
                    input.project_filters.clone()
                };
                if filters.is_empty() {
                    return Err(CapabilityError::Handler(format!(
                        "profile {} names no Jenkins jobs; refusing to scan everything",
                        connection.profile_id
                    )));
                }
                let auth = jenkins_auth(
                    &connection.auth_method,
                    &connection.credential.username,
                    &connection.credential.secret,
                )?;

                let (builds, jobs) = tokio::task::spawn_blocking(move || {
                    let transport = transport().map_err(|error| error.to_string())?;
                    let client = JenkinsClient::new(&connection.base_url, auth, transport)
                        .map_err(|error| error.to_string())?;
                    let all_jobs = client.list_jobs().map_err(|error| error.to_string())?;
                    let matching: Vec<String> = collect_leaf_job_names(&all_jobs)
                        .into_iter()
                        .filter(|full_name| job_matches_filters(full_name, &filters))
                        .collect();
                    let mut builds = Vec::new();
                    for job_path in &matching {
                        let found = client
                            .list_builds(job_path)
                            .map_err(|error| error.to_string())?;
                        builds.extend(
                            found
                                .iter()
                                .map(|build| normalize_build(job_path, build)),
                        );
                    }
                    Ok::<_, String>((builds, matching))
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the Jenkins request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)?;

                Ok(ListBuildsOut { builds, jobs })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(Default)]
    struct FakeTransport {
        requests: std::cell::RefCell<Vec<JenkinsRequest>>,
    }

    impl JenkinsTransport for FakeTransport {
        fn get(&self, request: JenkinsRequest) -> Result<JenkinsResponse, JenkinsError> {
            self.requests.borrow_mut().push(request.clone());
            let body = if request.url.contains("/api/json?tree=jobs") {
                json!({
                    "jobs": [{
                        "name": "payments-api",
                        "fullName": "payments-api",
                        "url": "https://jenkins.example.test/job/payments-api/",
                        "_class": "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
                        "jobs": [{
                            "name": "main",
                            "fullName": "payments-api/main",
                            "url": "https://jenkins.example.test/job/payments-api/job/main/",
                            "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob"
                        }]
                    }]
                })
            } else if request.url.contains("/api/json?tree=builds") {
                json!({
                    "builds": [{
                        "number": 9182,
                        "result": "SUCCESS",
                        "building": false,
                        "fullDisplayName": "payments-api/main #9182",
                        "url": "https://jenkins.example.test/job/payments-api/job/main/9182/",
                        "timestamp": 1750000000000u64,
                        "actions": [
                            { "_class": "hudson.model.CauseAction" },
                            {
                                "_class": "hudson.model.ParametersAction",
                                "parameters": [
                                    { "name": "DEPLOY_ENV", "value": "prod-eu" },
                                    { "name": "SKIP_SMOKE", "value": false }
                                ]
                            },
                            {
                                "_class": "hudson.plugins.git.util.BuildData",
                                "lastBuiltRevision": { "SHA1": "92ac41f7d2ab92ac41f7d2ab92ac41f7d2ab" },
                                "buildsByBranchName": { "main": { "buildNumber": 9182 } }
                            }
                        ]
                    }]
                })
            } else if request.url.contains("/9182/api/json") {
                json!({
                    "number": 9182,
                    "result": "SUCCESS",
                    "building": false,
                    "fullDisplayName": "payments-api/main #9182",
                    "url": "https://jenkins.example.test/job/payments-api/job/main/9182/",
                    "timestamp": 1750000000000u64,
                    "actions": [{
                        "_class": "hudson.plugins.git.util.BuildData",
                        "lastBuiltRevision": { "SHA1": "92ac41f7d2ab92ac41f7d2ab92ac41f7d2ab" }
                    }]
                })
            } else {
                json!({ "number": 9182, "result": "SUCCESS", "building": false })
            };
            Ok(JenkinsResponse::json(200, body))
        }
    }

    #[test]
    fn password_and_api_token_both_send_basic_auth() {
        let password = JenkinsAuth::password("operator", "fixture-password");
        let token = JenkinsAuth::api_token("operator", "fixture-token");
        assert_eq!(
            password.header_value().unwrap(),
            format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode("operator:fixture-password")
            )
        );
        assert_eq!(
            token.header_value().unwrap(),
            format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode("operator:fixture-token")
            )
        );
    }

    #[test]
    fn empty_credentials_and_insecure_base_url_are_refused() {
        assert_eq!(
            JenkinsAuth::password(String::new(), "pw")
                .header_value()
                .err(),
            Some(JenkinsError::InvalidCredentials)
        );
        let transport = FakeTransport::default();
        assert_eq!(
            JenkinsClient::new(
                "http://insecure.example.test",
                JenkinsAuth::api_token("op", "t"),
                &transport,
            )
            .err(),
            Some(JenkinsError::InvalidBaseUrl)
        );
    }

    #[test]
    fn lists_multibranch_jobs_with_children() {
        let transport = FakeTransport::default();
        let client = JenkinsClient::new(
            "https://jenkins.example.test",
            JenkinsAuth::api_token("operator", "fixture-token"),
            &transport,
        )
        .unwrap();

        let jobs = client.list_jobs().unwrap();

        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].name, "payments-api");
        assert_eq!(
            jobs[0].jobs[0].full_name.as_deref(),
            Some("payments-api/main")
        );
        let requests = transport.requests.borrow();
        assert_eq!(requests.len(), 1);
        assert!(requests[0]
            .url
            .starts_with("https://jenkins.example.test/api/json?tree="));
    }

    #[test]
    fn lists_builds_with_actions_parameters_and_scm_revision() {
        let transport = FakeTransport::default();
        let client = JenkinsClient::new(
            "https://jenkins.example.test",
            JenkinsAuth::api_token("operator", "fixture-token"),
            &transport,
        )
        .unwrap();

        let builds = client.list_builds("payments-api/main").unwrap();

        assert_eq!(builds.len(), 1);
        assert_eq!(builds[0].number, 9182);
        assert_eq!(
            builds[0].parameters(),
            vec![
                ("DEPLOY_ENV".to_string(), json!("prod-eu")),
                ("SKIP_SMOKE".to_string(), json!(false)),
            ]
        );
        assert_eq!(
            builds[0].actions[2].built_revision(),
            Some("92ac41f7d2ab92ac41f7d2ab92ac41f7d2ab".to_string())
        );
        assert!(transport.requests.borrow()[0]
            .url
            .contains("/job/payments-api/job/main/api/json"));
    }

    #[test]
    fn normalizes_a_build_with_exact_metadata() {
        let client = JenkinsClient::new(
            "https://jenkins.example.test",
            JenkinsAuth::api_token("operator", "fixture-token"),
            FakeTransport::default(),
        )
        .unwrap();
        let build = client.get_build("payments-api/main", 9182).unwrap();

        let entity = normalize_build("payments-api/main", &build);
        assert_eq!(entity.id, "jenkins:payments-api/main:9182");
        assert_eq!(entity.kind, EntityKind::Build);
        assert_eq!(entity.source, Source::Jenkins);
        assert_eq!(
            entity.attributes["scmRevision"],
            "92ac41f7d2ab92ac41f7d2ab92ac41f7d2ab"
        );
        assert_eq!(
            entity.attributes["sha"],
            "92ac41f7d2ab92ac41f7d2ab92ac41f7d2ab"
        );
        assert_eq!(entity.attributes["status"], "SUCCESS");
    }

    #[test]
    fn path_traversal_is_refused() {
        let client = JenkinsClient::new(
            "https://jenkins.example.test",
            JenkinsAuth::api_token("operator", "fixture-token"),
            FakeTransport::default(),
        )
        .unwrap();
        assert!(client.list_builds("../admin").is_err());
    }
}

#[cfg(test)]
mod capability_tests {
    use super::*;
    use srelens_capability::Registry;
    use srelens_devops_profiles::{Credential, CredentialRef, SessionCredentials};

    struct ScriptedTransport {
        urls: std::sync::Mutex<Vec<String>>,
    }

    impl JenkinsTransport for ScriptedTransport {
        fn get(&self, request: JenkinsRequest) -> Result<JenkinsResponse, JenkinsError> {
            self.urls.lock().unwrap().push(request.url.clone());
            if request.url.contains("tree=jobs") {
                return Ok(JenkinsResponse::json(
                    200,
                    json!({
                        "jobs": [{
                            "name": "payments-api",
                            "fullName": "payments-api",
                            "url": "https://jenkins.example.test/job/payments-api/",
                            "_class": "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
                            "jobs": [{
                                "name": "main",
                                "fullName": "payments-api/main",
                                "url": "https://jenkins.example.test/job/payments-api/job/main/",
                                "_class": "org.jenkinsci.plugins.workflow.job.WorkflowJob"
                            }]
                        }]
                    }),
                ));
            }
            if request.url.contains("/job/payments-api/job/main/") {
                return Ok(JenkinsResponse::json(
                    200,
                    json!({
                        "builds": [{
                            "number": 9182,
                            "result": "SUCCESS",
                            "building": false,
                            "fullDisplayName": "payments-api/main #9182",
                            "url": "https://jenkins.example.test/job/payments-api/job/main/9182/",
                            "timestamp": 1750000000000u64,
                            "actions": [{
                                "_class": "hudson.plugins.git.util.BuildData",
                                "lastBuiltRevision": { "SHA1": "92ac41f7d2ab" }
                            }]
                        }]
                    }),
                ));
            }
            Ok(JenkinsResponse::json(200, json!({ "builds": [] })))
        }
    }

    fn settings_capability(project_filters: Vec<&str>) -> Capability {
        let filters = project_filters
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        Capability::read_only("settings.get", "", move |_| {
            let filters = filters.clone();
            async move {
                Ok(json!({ "values": { "devops.profiles": {
                    "activeProfileId": "komus",
                    "profiles": [{
                        "id": "komus", "label": "Komus", "providers": [{
                            "provider": "jenkins",
                            "baseUrl": "https://jenkins.example.test",
                            "authMethod": "accessToken",
                            "projectFilters": filters
                        }]
                    }]
                } } }))
            }
        })
    }

    fn store_with_token() -> Arc<SessionCredentials> {
        let store = SessionCredentials::new();
        store.remember(
            &CredentialRef::new("komus", Provider::Jenkins),
            Credential {
                username: "build".into(),
                secret: "must-not-appear".into(),
            },
        );
        Arc::new(store)
    }

    #[tokio::test]
    async fn lists_builds_of_the_profiles_jobs_without_echoing_the_token() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let mut registry = Registry::new();
        let scripted = transport.clone();
        registry.register(list_builds_capability(
            store_with_token(),
            settings_capability(vec!["payments-api"]),
            Arc::new(move || {
                Ok(scripted.clone() as Arc<dyn JenkinsTransport + Send + Sync>)
            }),
        ));

        let out = registry
            .invoke("jenkins.listBuilds", json!({}))
            .await
            .expect("the profile resolves");

        assert_eq!(out["jobs"], json!(["payments-api/main"]));
        assert_eq!(out["builds"][0]["id"], "jenkins:payments-api/main:9182");
        assert_eq!(out["builds"][0]["attributes"]["sha"], "92ac41f7d2ab");
        assert!(!out.to_string().contains("must-not-appear"));
        assert!(transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("/job/payments-api/job/main/")));

        let wrong = registry
            .invoke("jenkins.listBuilds", json!({ "project_filters": [] }))
            .await;
        assert!(matches!(wrong, Err(CapabilityError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn a_profile_that_names_no_job_refuses_instead_of_scanning_everything() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let mut registry = Registry::new();
        let scripted = transport.clone();
        registry.register(list_builds_capability(
            store_with_token(),
            settings_capability(vec![]),
            Arc::new(move || {
                Ok(scripted.clone() as Arc<dyn JenkinsTransport + Send + Sync>)
            }),
        ));

        let error = registry
            .invoke("jenkins.listBuilds", json!({}))
            .await
            .expect_err("no job is named");

        assert!(error.to_string().contains("refusing to scan everything"));
        assert!(transport.urls.lock().unwrap().is_empty(), "no request is made");
    }
}
