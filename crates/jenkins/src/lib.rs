use base64::Engine;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use srelens_capability::{Annotations, Capability, CapabilityError};
use srelens_devops_model::{Entity, EntityKind, Source};
use srelens_devops_profiles::{active_connection, AuthMethod, CredentialStore, Provider};
use std::collections::BTreeMap;
use std::sync::Arc;

const DEFAULT_LOG_TAIL_BYTES: usize = 256 * 1024;
const MAX_LOG_TAIL_BYTES: usize = 1024 * 1024;

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

    /// Plain-text GET (`consoleText`). JSON-only fakes keep the default refusal.
    fn get_text(&self, request: JenkinsRequest) -> Result<(u16, String), JenkinsError> {
        let _ = request;
        Err(JenkinsError::InvalidResponse(
            "this transport does not serve plain-text bodies".into(),
        ))
    }
}

/// An `Arc` is a transport too, so a capability can share one across calls.
impl<T: JenkinsTransport + ?Sized> JenkinsTransport for Arc<T> {
    fn get(&self, request: JenkinsRequest) -> Result<JenkinsResponse, JenkinsError> {
        (**self).get(request)
    }

    fn get_text(&self, request: JenkinsRequest) -> Result<(u16, String), JenkinsError> {
        (**self).get_text(request)
    }
}

impl<T: JenkinsTransport + ?Sized> JenkinsTransport for &T {
    fn get(&self, request: JenkinsRequest) -> Result<JenkinsResponse, JenkinsError> {
        (*self).get(request)
    }

    fn get_text(&self, request: JenkinsRequest) -> Result<(u16, String), JenkinsError> {
        (*self).get_text(request)
    }
}

pub struct ReqwestJenkinsTransport {
    client: reqwest::blocking::Client,
}

impl ReqwestJenkinsTransport {
    pub fn new() -> Result<Self, JenkinsError> {
        Self::with_tls(&srelens_devops_profiles::TlsConfig::default())
    }

    pub fn with_tls(tls: &srelens_devops_profiles::TlsConfig) -> Result<Self, JenkinsError> {
        let client = srelens_devops_profiles::blocking_client(
            tls,
            JenkinsError::Transport,
            |builder| builder.redirect(reqwest::redirect::Policy::none()),
        )?;
        Ok(Self { client })
    }
}

impl JenkinsTransport for ReqwestJenkinsTransport {
    fn get(&self, request: JenkinsRequest) -> Result<JenkinsResponse, JenkinsError> {
        let (status, text) = self.raw_get(request)?;
        let body = serde_json::from_str(&text)
            .map_err(|e| JenkinsError::InvalidResponse(e.to_string()))?;
        Ok(JenkinsResponse { status, body })
    }

    fn get_text(&self, request: JenkinsRequest) -> Result<(u16, String), JenkinsError> {
        self.raw_get(request)
    }
}

impl ReqwestJenkinsTransport {
    fn raw_get(&self, request: JenkinsRequest) -> Result<(u16, String), JenkinsError> {
        let mut builder = self.client.get(&request.url);
        for (name, value) in request.headers {
            builder = builder.header(name, value);
        }
        let response = builder
            .send()
            .map_err(|e| JenkinsError::Transport(e.to_string()))?;
        let status = response.status().as_u16();
        let text = response
            .text()
            .map_err(|e| JenkinsError::Transport(e.to_string()))?;
        Ok((status, text))
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
    /// Nested children. Folders often omit or null this field — treat as empty.
    #[serde(default, deserialize_with = "deserialize_null_default")]
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
    #[serde(default, deserialize_with = "deserialize_null_default")]
    pub actions: Vec<JenkinsAction>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JenkinsAction {
    #[serde(rename = "_class", default)]
    pub class: Option<String>,
    /// Jenkins frequently sends `"parameters": null` on non-parameter actions.
    #[serde(default, deserialize_with = "deserialize_null_default")]
    pub parameters: Vec<JenkinsParameter>,
    #[serde(rename = "lastBuiltRevision", default)]
    pub last_built_revision: Option<Value>,
    #[serde(rename = "buildsByBranchName", default)]
    pub builds_by_branch_name: Value,
}

fn deserialize_null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
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

    /// Revision recorded under `buildsByBranchName` for a specific build number.
    /// Multi-checkout Pipelines (app + cicd) leave several `BuildData` actions;
    /// the entry whose `buildNumber` matches this build is the checkout that
    /// actually ran for it.
    pub fn revision_for_build_number(&self, number: u64) -> Option<String> {
        let map = self.builds_by_branch_name.as_object()?;
        for entry in map.values() {
            let build_number = entry
                .get("buildNumber")
                .and_then(|value| value.as_u64())
                .or_else(|| entry.get("buildNumber").and_then(|value| value.as_i64()).map(|n| n as u64))?;
            if build_number != number {
                continue;
            }
            if let Some(sha) = entry
                .pointer("/revision/SHA1")
                .and_then(|value| value.as_str())
                .filter(|sha| !sha.is_empty())
            {
                return Some(sha.to_owned());
            }
        }
        None
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
    /// callers can extract parameters and the SCM revision. `"builds": null`
    /// (Folders) is treated as an empty list.
    pub fn list_builds(&self, job_path: &str) -> Result<Vec<JenkinsBuild>, JenkinsError> {
        let body = self.get_json(
            &format!("{}/api/json", Self::job_api_prefix(job_path)?),
            "builds[number,result,building,fullDisplayName,url,timestamp,actions[_class,parameters[name,value],lastBuiltRevision[SHA1],buildsByBranchName[*[buildNumber,revision[SHA1]]]]]",
        )?;
        let builds: Option<Vec<JenkinsBuild>> = serde_json::from_value(body["builds"].clone())
            .map_err(|error| JenkinsError::InvalidResponse(error.to_string()))?;
        Ok(builds.unwrap_or_default())
    }

    /// One build with its actions. `job_path` is the slash-joined job path,
    /// e.g. `payments-api/main` for a Multibranch branch job.
    pub fn get_build(&self, job_path: &str, number: u64) -> Result<JenkinsBuild, JenkinsError> {
        let body = self.get_json(
            &format!("{}/{number}/api/json", Self::job_api_prefix(job_path)?),
            "number,result,building,fullDisplayName,url,timestamp,actions[_class,parameters[name,value],lastBuiltRevision[SHA1],buildsByBranchName[*[buildNumber,revision[SHA1]]]]",
        )?;
        serde_json::from_value(body)
            .map_err(|error| JenkinsError::InvalidResponse(error.to_string()))
    }

    /// Bounded tail of `consoleText`. When Pipeline Stage View is installed,
    /// also reads `wfapi/describe` for the first failed stage name.
    pub fn get_build_log(
        &self,
        job_path: &str,
        number: u64,
        max_bytes: usize,
    ) -> Result<(String, bool, Option<String>), JenkinsError> {
        let prefix = Self::job_api_prefix(job_path)?;
        let (status, text) = self.transport.get_text(JenkinsRequest {
            url: format!("{}{prefix}/{number}/consoleText", self.base_url),
            headers: BTreeMap::from([("Authorization".into(), self.auth.header()?)]),
        })?;
        if !(200..300).contains(&status) {
            return Err(JenkinsError::UnexpectedStatus(status));
        }
        let (text, truncated) = bound_log_text(&text, max_bytes);
        let failure_stage = self.failed_pipeline_stage(job_path, number).ok().flatten();
        Ok((text, truncated, failure_stage))
    }

    fn failed_pipeline_stage(
        &self,
        job_path: &str,
        number: u64,
    ) -> Result<Option<String>, JenkinsError> {
        let prefix = Self::job_api_prefix(job_path)?;
        let response = self.transport.get(JenkinsRequest {
            url: format!("{}{prefix}/{number}/wfapi/describe", self.base_url),
            headers: BTreeMap::from([("Authorization".into(), self.auth.header()?)]),
        })?;
        if !(200..300).contains(&response.status) {
            return Ok(None);
        }
        let stages = response.body["stages"].as_array().cloned().unwrap_or_default();
        Ok(stages.into_iter().find_map(|stage| {
            let status = stage["status"].as_str().unwrap_or("");
            if status.eq_ignore_ascii_case("FAILED") || status.eq_ignore_ascii_case("FAILURE") {
                stage["name"].as_str().map(str::to_owned)
            } else {
                None
            }
        }))
    }
}

/// Keep the tail of a console log within `max_bytes`.
pub fn bound_log_text(text: &str, max_bytes: usize) -> (String, bool) {
    let bytes = text.as_bytes();
    if bytes.len() <= max_bytes {
        return (text.to_owned(), false);
    }
    let mut start = bytes.len().saturating_sub(max_bytes);
    while start < bytes.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    (text[start..].to_owned(), true)
}

fn resolve_log_limit(max_bytes: Option<u64>) -> usize {
    max_bytes
        .map(|n| n as usize)
        .unwrap_or(DEFAULT_LOG_TAIL_BYTES)
        .clamp(1, MAX_LOG_TAIL_BYTES)
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
    let scm_revisions = collect_scm_revisions(build);
    // Prefer the checkout whose buildsByBranchName entry names this build
    // number; otherwise first lastBuiltRevision (legacy single-SCM jobs).
    let sha = build
        .actions
        .iter()
        .find_map(|action| action.revision_for_build_number(build.number))
        .or_else(|| scm_revisions.first().cloned());
    let parameters: serde_json::Map<String, Value> = build
        .parameters()
        .into_iter()
        .map(|(name, value)| (name, value))
        .collect();
    let image_tag = derived_image_tag(build, &parameters);
    let mut attributes = json!({
        "jobPath": job_path,
        "buildNumber": build.number,
        "status": status,
        "timestamp": build.timestamp_ms,
        "scmRevision": sha,
        "sha": sha,
        "scmRevisions": scm_revisions,
        "parameters": parameters,
    });
    if let Some(tag) = image_tag {
        if let Some(obj) = attributes.as_object_mut() {
            obj.insert("imageTag".into(), json!(tag));
            obj.insert("tag".into(), json!(tag));
        }
    }
    Entity {
        id: format!("jenkins:{job_path}:{}", build.number),
        kind: EntityKind::Build,
        source: Source::Jenkins,
        title: build
            .full_display_name
            .clone()
            .unwrap_or_else(|| format!("{job_path} #{}", build.number)),
        url: build.url.clone(),
        attributes,
    }
}

fn collect_scm_revisions(build: &JenkinsBuild) -> Vec<String> {
    let mut out = Vec::new();
    for action in &build.actions {
        if let Some(sha) = action.revision_for_build_number(build.number) {
            if !out.iter().any(|known| known == &sha) {
                out.push(sha);
            }
        }
    }
    for action in &build.actions {
        if let Some(sha) = action.built_revision() {
            if !out.iter().any(|known| known == &sha) {
                out.push(sha);
            }
        }
    }
    out
}

/// Image tag published by the build when Jenkins exposes one.
///
/// Order: explicit `IMAGE_TAG` parameter → `{buildNumber}-{DEPLOY_ENV}` when
/// `DEPLOY_ENV` is set and `IMAGE_TAG` is empty (Komus/DOFFICE pipelines stamp
/// runtime images that way). Never invent a registry host here — correlation
/// matches bare tags against live workload image refs.
fn derived_image_tag(
    build: &JenkinsBuild,
    parameters: &serde_json::Map<String, Value>,
) -> Option<String> {
    let explicit = parameters
        .get("IMAGE_TAG")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(tag) = explicit {
        return Some(tag.to_owned());
    }
    let deploy_env = parameters
        .get("DEPLOY_ENV")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some(format!("{}-{deploy_env}", build.number))
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
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn JenkinsTransport + Send + Sync>, JenkinsError> + Send + Sync,
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
                    let transport = transport(connection.tls.clone()).map_err(|error| error.to_string())?;
                    let client = JenkinsClient::new(&connection.base_url, auth, transport)
                        .map_err(|error| error.to_string())?;
                    let all_jobs = client.list_jobs().map_err(|error| error.to_string())?;
                    // Top-level list is only one folder level deep, so nested
                    // WorkflowJobs under Folder/Folder never appear as leaves.
                    // Explicit filter paths (contain `/`) are therefore queried
                    // directly — that is how Komus seeds `DOFFICE/…/job`.
                    let mut matching: Vec<String> = collect_leaf_job_names(&all_jobs)
                        .into_iter()
                        .filter(|full_name| job_matches_filters(full_name, &filters))
                        .collect();
                    for filter in &filters {
                        if filter.contains('/') && !matching.iter().any(|name| name == filter) {
                            matching.push(filter.clone());
                        }
                    }
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

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetBuildLogIn {
    pub job_path: String,
    pub build_number: u64,
    /// Max bytes of the consoleText tail. Defaults to 256 KiB; capped at 1 MiB.
    #[serde(default)]
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetBuildLogOut {
    pub text: String,
    pub truncated: bool,
    pub job_path: String,
    pub build_number: u64,
    /// First failed Pipeline stage when Stage View (`wfapi`) answers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_stage: Option<String>,
}

/// `jenkins.getBuildLog` — bounded `consoleText` tail for one build.
pub fn get_build_log_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn JenkinsTransport + Send + Sync>, JenkinsError> + Send + Sync,
    >,
) -> Capability {
    Capability::typed::<GetBuildLogIn, GetBuildLogOut, _, _>(
        "jenkins.getBuildLog",
        "read a bounded tail of a Jenkins build consoleText for the active DevOps profile",
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                if input.job_path.is_empty() || input.build_number == 0 {
                    return Err(CapabilityError::InvalidInput(
                        "jobPath and buildNumber are required".into(),
                    ));
                }
                let connection = active_connection(&settings, store.as_ref(), Provider::Jenkins)
                    .await
                    .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let auth = jenkins_auth(
                    &connection.auth_method,
                    &connection.credential.username,
                    &connection.credential.secret,
                )?;
                let max_bytes = resolve_log_limit(input.max_bytes);
                let job_path = input.job_path.clone();
                let build_number = input.build_number;

                let (text, truncated, failure_stage) = tokio::task::spawn_blocking(move || {
                    let transport = transport(connection.tls.clone()).map_err(|error| error.to_string())?;
                    let client = JenkinsClient::new(&connection.base_url, auth, transport)
                        .map_err(|error| error.to_string())?;
                    client
                        .get_build_log(&job_path, build_number, max_bytes)
                        .map_err(|error| error.to_string())
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the Jenkins request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)?;

                Ok(GetBuildLogOut {
                    text,
                    truncated,
                    job_path: input.job_path,
                    build_number: input.build_number,
                    failure_stage,
                })
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
    fn normalize_build_derives_image_tag_from_deploy_env_and_keeps_all_scm_revisions() {
        let build = JenkinsBuild {
            number: 65,
            result: Some("SUCCESS".into()),
            building: Some(false),
            full_display_name: Some("expressbot #65".into()),
            url: Some("https://jenkins.example.test/job/expressbot/65/".into()),
            timestamp_ms: Some(1),
            actions: vec![
                JenkinsAction {
                    class: Some("hudson.model.ParametersAction".into()),
                    parameters: vec![
                        JenkinsParameter {
                            name: "DEPLOY_ENV".into(),
                            value: Some(json!("dev")),
                        },
                        JenkinsParameter {
                            name: "IMAGE_TAG".into(),
                            value: Some(json!("")),
                        },
                    ],
                    last_built_revision: None,
                    builds_by_branch_name: json!({}),
                },
                JenkinsAction {
                    class: Some("hudson.plugins.git.util.BuildData".into()),
                    parameters: vec![],
                    last_built_revision: Some(json!({ "SHA1": "cicdsha00000000000000000000000000000001" })),
                    builds_by_branch_name: json!({
                        "refs/remotes/origin/feature/x": {
                            "buildNumber": 65,
                            "revision": { "SHA1": "cicdsha00000000000000000000000000000001" }
                        }
                    }),
                },
                JenkinsAction {
                    class: Some("hudson.plugins.git.util.BuildData".into()),
                    parameters: vec![],
                    last_built_revision: Some(json!({ "SHA1": "appsha000000000000000000000000000000002" })),
                    builds_by_branch_name: json!({
                        "refs/remotes/origin/master": {
                            "buildNumber": 65,
                            "revision": { "SHA1": "appsha000000000000000000000000000000002" }
                        }
                    }),
                },
            ],
        };

        let entity = normalize_build("DOFFICE/expressbot", &build);
        assert_eq!(entity.attributes["imageTag"], "65-dev");
        assert_eq!(entity.attributes["tag"], "65-dev");
        assert_eq!(
            entity.attributes["sha"],
            "cicdsha00000000000000000000000000000001"
        );
        let revisions = entity.attributes["scmRevisions"].as_array().unwrap();
        assert!(revisions
            .iter()
            .any(|value| value == "cicdsha00000000000000000000000000000001"));
        assert!(revisions
            .iter()
            .any(|value| value == "appsha000000000000000000000000000000002"));
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

    /// Nested Folder jobs under Komus return `"builds": null` for the list
    /// tree; that must not surface as InvalidResponse.
    #[test]
    fn list_builds_treats_null_builds_as_empty() {
        struct NullBuildsTransport;
        impl JenkinsTransport for NullBuildsTransport {
            fn get(&self, request: JenkinsRequest) -> Result<JenkinsResponse, JenkinsError> {
                assert!(request.url.contains("/job/DOFFICE/api/json?tree=builds"));
                Ok(JenkinsResponse::json(200, json!({ "builds": null })))
            }
        }

        let client = JenkinsClient::new(
            "https://jenkins.example.test",
            JenkinsAuth::api_token("operator", "fixture-token"),
            NullBuildsTransport,
        )
        .unwrap();

        let builds = client.list_builds("DOFFICE").unwrap();
        assert!(builds.is_empty());
    }

    #[test]
    fn list_builds_tolerates_null_parameters_on_actions() {
        struct NullParamsTransport;
        impl JenkinsTransport for NullParamsTransport {
            fn get(&self, request: JenkinsRequest) -> Result<JenkinsResponse, JenkinsError> {
                assert!(request.url.contains("/job/DOFFICE/job/EXPRESS_BOT/job/expressbot-build-deploy/"));
                Ok(JenkinsResponse::json(
                    200,
                    json!({
                        "builds": [{
                            "number": 67,
                            "result": "SUCCESS",
                            "actions": [
                                { "_class": "hudson.model.CauseAction", "parameters": null },
                                {
                                    "_class": "hudson.model.ParametersAction",
                                    "parameters": [{ "name": "BRANCH", "value": "master" }]
                                }
                            ]
                        }]
                    }),
                ))
            }
        }

        let client = JenkinsClient::new(
            "https://jenkins.example.test",
            JenkinsAuth::api_token("operator", "fixture-token"),
            NullParamsTransport,
        )
        .unwrap();

        let builds = client
            .list_builds("DOFFICE/EXPRESS_BOT/expressbot-build-deploy")
            .unwrap();
        assert_eq!(builds.len(), 1);
        assert_eq!(builds[0].number, 67);
        assert_eq!(
            builds[0].parameters(),
            vec![("BRANCH".into(), json!("master"))]
        );
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
            if request.url.contains("wfapi/describe") {
                return Ok(JenkinsResponse::json(
                    200,
                    json!({
                        "stages": [
                            { "name": "Checkout", "status": "SUCCESS" },
                            { "name": "Integration", "status": "FAILED" }
                        ]
                    }),
                ));
            }
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

        fn get_text(&self, request: JenkinsRequest) -> Result<(u16, String), JenkinsError> {
            self.urls.lock().unwrap().push(request.url.clone());
            if request.url.contains("/consoleText") {
                let mut body = String::from("started\n");
                body.push_str(&"line ".repeat(80_000));
                body.push_str("BUILD FAILURE in Integration\n");
                return Ok((200, body));
            }
            Err(JenkinsError::UnexpectedStatus(404))
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
            Arc::new(move |_tls| {
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
            Arc::new(move |_tls| {
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

    #[tokio::test]
    async fn build_log_uses_the_callers_camel_case_payload() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let mut registry = Registry::new();
        let scripted = transport.clone();
        registry.register(get_build_log_capability(
            store_with_token(),
            settings_capability(vec!["payments-api"]),
            Arc::new(move |_tls| {
                Ok(scripted.clone() as Arc<dyn JenkinsTransport + Send + Sync>)
            }),
        ));

        let out = registry
            .invoke(
                "jenkins.getBuildLog",
                json!({
                    "jobPath": "payments-api/main",
                    "buildNumber": 9182,
                    "maxBytes": 2048
                }),
            )
            .await
            .expect("build log");

        assert_eq!(out["truncated"], true);
        assert_eq!(out["failureStage"], "Integration");
        assert!(out["text"].as_str().unwrap().contains("BUILD FAILURE"));
        assert!(!out["text"].as_str().unwrap().contains("started"));
        assert!(!out.to_string().contains("must-not-appear"));
        assert!(registry
            .invoke(
                "jenkins.getBuildLog",
                json!({ "job_path": "payments-api/main", "build_number": 9182 }),
            )
            .await
            .is_err());
        assert!(transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("/consoleText")));
    }
}
