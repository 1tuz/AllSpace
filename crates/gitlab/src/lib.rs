use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use srelens_capability::{Annotations, Capability, CapabilityError};
use srelens_devops_model::{Entity, EntityKind, Source};
use srelens_devops_profiles::{active_connection, CredentialStore, Provider};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::Duration;

const MAX_PAGES: usize = 100;
/// Soft default for lazy MR file diffs — enough for a detail pane, not a dump.
const DEFAULT_MAX_DIFF_FILES: usize = 40;
const HARD_MAX_DIFF_FILES: usize = 80;
const MAX_PATCH_CHARS: usize = 12_000;
/// Tail window for job traces. Full traces can be huge; the UI asks for a
/// bounded end of the log, not a stream.
const DEFAULT_TRACE_TAIL_BYTES: usize = 256 * 1024;
const MAX_TRACE_TAIL_BYTES: usize = 1024 * 1024;
const MAX_PIPELINE_JOBS: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitlabRequest {
    pub url: String,
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct GitlabResponse {
    pub status: u16,
    pub next_page: Option<String>,
    pub body: Value,
}

impl GitlabResponse {
    pub fn json(status: u16, next_page: Option<&str>, body: Value) -> Self {
        Self {
            status,
            next_page: next_page.map(str::to_owned),
            body,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitlabError {
    InvalidBaseUrl,
    Transport(String),
    UnexpectedStatus(u16),
    InvalidResponse(String),
    PaginationLimit,
}

pub trait GitlabTransport {
    fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError>;

    /// Plain-text GET (job traces). Default refuses — JSON-only fakes stay
    /// silent until a test scripts a trace.
    fn get_text(&self, request: GitlabRequest) -> Result<(u16, String), GitlabError> {
        let _ = request;
        Err(GitlabError::InvalidResponse(
            "this transport does not serve plain-text bodies".into(),
        ))
    }
}

/// An `Arc` is a transport too, so a capability can share one across calls.
impl<T: GitlabTransport + ?Sized> GitlabTransport for Arc<T> {
    fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
        (**self).get(request)
    }

    fn get_text(&self, request: GitlabRequest) -> Result<(u16, String), GitlabError> {
        (**self).get_text(request)
    }
}

impl<T: GitlabTransport + ?Sized> GitlabTransport for &T {
    fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
        (*self).get(request)
    }

    fn get_text(&self, request: GitlabRequest) -> Result<(u16, String), GitlabError> {
        (*self).get_text(request)
    }
}

/// Production GitLab CE REST transport. Redirects are refused: forwarding a
/// private access token to a redirect target would leak the credential.
pub struct ReqwestGitlabTransport {
    client: reqwest::blocking::Client,
}

impl ReqwestGitlabTransport {
    pub fn new() -> Result<Self, GitlabError> {
        Self::with_tls(&srelens_devops_profiles::TlsConfig::default())
    }

    pub fn with_tls(tls: &srelens_devops_profiles::TlsConfig) -> Result<Self, GitlabError> {
        let client = srelens_devops_profiles::blocking_client(
            tls,
            GitlabError::Transport,
            |builder| {
                builder
                    .redirect(reqwest::redirect::Policy::none())
                    .user_agent(concat!("srelens/", env!("CARGO_PKG_VERSION")))
            },
        )?;
        Ok(Self { client })
    }
}

impl GitlabTransport for ReqwestGitlabTransport {
    fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
        let (status, next_page, text) = self.raw_get(request)?;
        let body = serde_json::from_str(&text)
            .map_err(|error| GitlabError::InvalidResponse(error.to_string()))?;
        Ok(GitlabResponse {
            status,
            next_page,
            body,
        })
    }

    fn get_text(&self, request: GitlabRequest) -> Result<(u16, String), GitlabError> {
        let (status, _next_page, text) = self.raw_get(request)?;
        Ok((status, text))
    }
}

impl ReqwestGitlabTransport {
    fn raw_get(
        &self,
        request: GitlabRequest,
    ) -> Result<(u16, Option<String>, String), GitlabError> {
        let mut builder = self.client.get(&request.url);
        for (name, value) in request.headers {
            builder = builder.header(name, value);
        }
        let response = builder
            .send()
            .map_err(|error| GitlabError::Transport(error.to_string()))?;
        let status = response.status().as_u16();
        let next_page = response
            .headers()
            .get("x-next-page")
            .and_then(|header| header.to_str().ok())
            .map(str::to_owned);
        let text = response
            .text()
            .map_err(|error| GitlabError::Transport(error.to_string()))?;
        Ok((status, next_page, text))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct GitlabProject {
    pub id: u64,
    pub path_with_namespace: String,
    pub web_url: String,
    #[serde(default)]
    pub default_branch: Option<String>,
}

/// Convert the stable GitLab project fields into the provider-neutral graph
/// model. The raw API response stays at the adapter boundary.
pub fn normalize_project(project: &GitlabProject) -> Entity {
    Entity {
        id: format!("gitlab:project:{}", project.id),
        kind: EntityKind::Project,
        source: Source::Gitlab,
        title: project.path_with_namespace.clone(),
        url: Some(project.web_url.clone()),
        attributes: json!({
            "projectId": project.id,
            "pathWithNamespace": project.path_with_namespace,
            "defaultBranch": project.default_branch,
        }),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct GitlabMergeRequest {
    pub iid: u64,
    pub title: String,
    pub web_url: String,
    pub source_branch: String,
    pub target_branch: String,
    pub sha: String,
    pub state: String,
}

/// Convert a GitLab merge request into the provider-neutral graph model.
pub fn normalize_merge_request(project_id: u64, merge_request: &GitlabMergeRequest) -> Entity {
    Entity {
        id: format!("gitlab:merge-request:{project_id}:{}", merge_request.iid),
        kind: EntityKind::PullRequest,
        source: Source::Gitlab,
        title: merge_request.title.clone(),
        url: Some(merge_request.web_url.clone()),
        attributes: json!({
            "projectId": project_id,
            "iid": merge_request.iid,
            "sourceBranch": merge_request.source_branch,
            "targetBranch": merge_request.target_branch,
            "sha": merge_request.sha,
            "state": merge_request.state,
        }),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct GitlabCommit {
    pub id: String,
    pub title: String,
    pub web_url: String,
    pub author_name: String,
}

/// Convert a full GitLab commit SHA into the provider-neutral graph model.
pub fn normalize_commit(project_id: u64, commit: &GitlabCommit) -> Entity {
    Entity {
        id: format!("gitlab:commit:{project_id}:{}", commit.id),
        kind: EntityKind::Commit,
        source: Source::Gitlab,
        title: commit.title.clone(),
        url: Some(commit.web_url.clone()),
        attributes: json!({
            "projectId": project_id,
            "sha": commit.id,
            "authorName": commit.author_name,
        }),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct GitlabPipeline {
    pub id: u64,
    pub status: String,
    pub r#ref: String,
    pub sha: String,
    pub web_url: String,
}

/// Convert a GitLab pipeline into the provider-neutral build entity.
pub fn normalize_pipeline(project_id: u64, pipeline: &GitlabPipeline) -> Entity {
    let mut attributes = json!({
        "projectId": project_id,
        "pipelineId": pipeline.id,
        "status": pipeline.status,
        "ref": pipeline.r#ref,
        "sha": pipeline.sha,
    });
    // Tag pipelines (v1.0.28 / 3.2.11) stamp the same string onto runtime images
    // in AppFarm registries. Expose it as imageTag so kube fan-out can match
    // bare tags without inventing a registry host.
    if let Some(tag) = image_tag_from_pipeline_ref(&pipeline.r#ref) {
        if let Some(obj) = attributes.as_object_mut() {
            obj.insert("imageTag".into(), json!(tag));
            obj.insert("tag".into(), json!(tag));
        }
    }
    Entity {
        id: format!("gitlab:pipeline:{project_id}:{}", pipeline.id),
        kind: EntityKind::Build,
        source: Source::Gitlab,
        title: format!("Pipeline #{} ({})", pipeline.id, pipeline.status),
        url: Some(pipeline.web_url.clone()),
        attributes,
    }
}

/// Release-style refs only — branch names like `feature/x` stay out.
fn image_tag_from_pipeline_ref(pipeline_ref: &str) -> Option<&str> {
    let tag = pipeline_ref.trim();
    if tag.is_empty() || tag.contains('/') {
        return None;
    }
    // v1.0.28, 3.2.11, 20260207-rshb.0.0.5 — must start with a digit or `v`+digit.
    let bytes = tag.as_bytes();
    let starts_ok = bytes[0].is_ascii_digit()
        || (bytes.len() >= 2 && bytes[0].eq_ignore_ascii_case(&b'v') && bytes[1].is_ascii_digit());
    if starts_ok {
        Some(tag)
    } else {
        None
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct GitlabJob {
    pub id: u64,
    pub name: String,
    pub stage: String,
    pub status: String,
    #[serde(default)]
    pub web_url: Option<String>,
    #[serde(default)]
    pub failure_reason: Option<String>,
    #[serde(default)]
    pub allow_failure: Option<bool>,
}

/// Convert a GitLab CI job into the provider-neutral build entity. Stage and
/// failure reason stay in attributes so the Logs tab can name the failure
/// without a second round-trip.
pub fn normalize_job(project_id: u64, pipeline_id: u64, job: &GitlabJob) -> Entity {
    Entity {
        id: format!("gitlab:job:{project_id}:{}", job.id),
        kind: EntityKind::Build,
        source: Source::Gitlab,
        title: format!("{} · {} ({})", job.stage, job.name, job.status),
        url: job.web_url.clone(),
        attributes: json!({
            "projectId": project_id,
            "pipelineId": pipeline_id,
            "jobId": job.id,
            "name": job.name,
            "stage": job.stage,
            "status": job.status,
            "failureReason": job.failure_reason,
            "allowFailure": job.allow_failure,
        }),
    }
}

/// Keep the tail of a CI log within `max_bytes`, cutting on a char boundary.
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

fn resolve_trace_limit(max_bytes: Option<u64>) -> usize {
    max_bytes
        .map(|n| n as usize)
        .unwrap_or(DEFAULT_TRACE_TAIL_BYTES)
        .clamp(1, MAX_TRACE_TAIL_BYTES)
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct GitlabBranchCommit {
    pub id: String,
    #[serde(default)]
    pub short_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct GitlabBranch {
    pub name: String,
    pub commit: GitlabBranchCommit,
    #[serde(default)]
    pub protected: bool,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub web_url: Option<String>,
}

/// Convert a GitLab branch into the provider-neutral graph model.
pub fn normalize_branch(project_id: u64, branch: &GitlabBranch) -> Entity {
    Entity {
        id: format!("gitlab:branch:{project_id}:{}", branch.name),
        kind: EntityKind::Branch,
        source: Source::Gitlab,
        title: branch.name.clone(),
        url: branch.web_url.clone(),
        attributes: json!({
            "projectId": project_id,
            "name": branch.name,
            "sha": branch.commit.id,
            "protected": branch.protected,
            "default": branch.default,
        }),
    }
}

pub struct GitlabClient<T> {
    base_url: String,
    token: String,
    transport: T,
}

impl<T: GitlabTransport> GitlabClient<T> {
    pub fn new(base_url: &str, token: &str, transport: T) -> Result<Self, GitlabError> {
        let base_url = base_url.trim_end_matches('/');
        if !base_url.starts_with("https://") || base_url.len() == "https://".len() {
            return Err(GitlabError::InvalidBaseUrl);
        }
        if token.is_empty() {
            return Err(GitlabError::Transport("missing GitLab access token".into()));
        }
        Ok(Self {
            base_url: base_url.into(),
            token: token.into(),
            transport,
        })
    }

    pub fn list_projects(
        &self,
        project_filters: &[String],
    ) -> Result<Vec<GitlabProject>, GitlabError> {
        // A profile normally names concrete project paths (for example
        // `group/service`). Resolve those directly instead of first paging
        // through every project visible to the token. Apart from making the
        // configured boundary exact, this prevents a delivery trace from
        // spending minutes enumerating an organisation before it can read one
        // pipeline. A one-segment filter still means a group prefix and keeps
        // the existing membership listing behaviour below.
        if project_filters
            .iter()
            .all(|filter| filter.trim_matches('/').contains('/'))
        {
            return project_filters
                .iter()
                .map(|filter| self.get_project(filter.trim_matches('/')))
                .collect();
        }
        let mut page = "1".to_owned();
        let mut seen_pages = BTreeSet::new();
        let mut projects = Vec::new();

        while seen_pages.insert(page.clone()) {
            if seen_pages.len() > MAX_PAGES {
                return Err(GitlabError::PaginationLimit);
            }
            let response = self.transport.get(GitlabRequest {
                url: format!(
                    "{}/api/v4/projects?membership=true&simple=true&per_page=100&page={page}",
                    self.base_url
                ),
                headers: BTreeMap::from([("PRIVATE-TOKEN".into(), self.token.clone())]),
            })?;
            if !(200..300).contains(&response.status) {
                return Err(GitlabError::UnexpectedStatus(response.status));
            }
            let mut received: Vec<GitlabProject> = serde_json::from_value(response.body)
                .map_err(|error| GitlabError::InvalidResponse(error.to_string()))?;
            projects.append(&mut received);

            match response.next_page.filter(|next| !next.is_empty()) {
                Some(next) if !seen_pages.contains(&next) => page = next,
                Some(_) => return Err(GitlabError::PaginationLimit),
                None => break,
            }
        }

        projects.retain(|project| project_matches(project, project_filters));
        Ok(projects)
    }

    fn get_project(&self, path: &str) -> Result<GitlabProject, GitlabError> {
        let response = self.transport.get(GitlabRequest {
            url: format!(
                "{}/api/v4/projects/{}",
                self.base_url,
                encode_project_path(path)
            ),
            headers: BTreeMap::from([("PRIVATE-TOKEN".into(), self.token.clone())]),
        })?;
        if !(200..300).contains(&response.status) {
            return Err(GitlabError::UnexpectedStatus(response.status));
        }
        serde_json::from_value(response.body)
            .map_err(|error| GitlabError::InvalidResponse(error.to_string()))
    }

    pub fn list_merge_requests(
        &self,
        project_id: u64,
    ) -> Result<Vec<GitlabMergeRequest>, GitlabError> {
        let mut page = "1".to_owned();
        let mut seen_pages = BTreeSet::new();
        let mut merge_requests = Vec::new();

        while seen_pages.insert(page.clone()) {
            if seen_pages.len() > MAX_PAGES {
                return Err(GitlabError::PaginationLimit);
            }
            let response = self.transport.get(GitlabRequest {
                url: format!(
                    "{}/api/v4/projects/{project_id}/merge_requests?state=all&per_page=100&page={page}",
                    self.base_url
                ),
                headers: BTreeMap::from([("PRIVATE-TOKEN".into(), self.token.clone())]),
            })?;
            if !(200..300).contains(&response.status) {
                return Err(GitlabError::UnexpectedStatus(response.status));
            }
            let mut received: Vec<GitlabMergeRequest> = serde_json::from_value(response.body)
                .map_err(|error| GitlabError::InvalidResponse(error.to_string()))?;
            merge_requests.append(&mut received);

            match response.next_page.filter(|next| !next.is_empty()) {
                Some(next) if !seen_pages.contains(&next) => page = next,
                Some(_) => return Err(GitlabError::PaginationLimit),
                None => break,
            }
        }

        Ok(merge_requests)
    }

    pub fn list_commits(&self, project_id: u64) -> Result<Vec<GitlabCommit>, GitlabError> {
        let mut page = "1".to_owned();
        let mut seen_pages = BTreeSet::new();
        let mut commits = Vec::new();

        while seen_pages.insert(page.clone()) {
            if seen_pages.len() > MAX_PAGES {
                return Err(GitlabError::PaginationLimit);
            }
            let response = self.transport.get(GitlabRequest {
                url: format!(
                    "{}/api/v4/projects/{project_id}/repository/commits?per_page=100&page={page}",
                    self.base_url
                ),
                headers: BTreeMap::from([("PRIVATE-TOKEN".into(), self.token.clone())]),
            })?;
            if !(200..300).contains(&response.status) {
                return Err(GitlabError::UnexpectedStatus(response.status));
            }
            let mut received: Vec<GitlabCommit> = serde_json::from_value(response.body)
                .map_err(|error| GitlabError::InvalidResponse(error.to_string()))?;
            commits.append(&mut received);

            match response.next_page.filter(|next| !next.is_empty()) {
                Some(next) if !seen_pages.contains(&next) => page = next,
                Some(_) => return Err(GitlabError::PaginationLimit),
                None => break,
            }
        }

        Ok(commits)
    }

    pub fn list_branches(&self, project_id: u64) -> Result<Vec<GitlabBranch>, GitlabError> {
        let mut page = "1".to_owned();
        let mut seen_pages = BTreeSet::new();
        let mut branches = Vec::new();

        while seen_pages.insert(page.clone()) {
            if seen_pages.len() > MAX_PAGES {
                return Err(GitlabError::PaginationLimit);
            }
            let response = self.transport.get(GitlabRequest {
                url: format!(
                    "{}/api/v4/projects/{project_id}/repository/branches?per_page=100&page={page}",
                    self.base_url
                ),
                headers: BTreeMap::from([("PRIVATE-TOKEN".into(), self.token.clone())]),
            })?;
            if !(200..300).contains(&response.status) {
                return Err(GitlabError::UnexpectedStatus(response.status));
            }
            let mut received: Vec<GitlabBranch> = serde_json::from_value(response.body)
                .map_err(|error| GitlabError::InvalidResponse(error.to_string()))?;
            branches.append(&mut received);

            match response.next_page.filter(|next| !next.is_empty()) {
                Some(next) if !seen_pages.contains(&next) => page = next,
                Some(_) => return Err(GitlabError::PaginationLimit),
                None => break,
            }
        }

        Ok(branches)
    }

    pub fn list_pipelines(&self, project_id: u64) -> Result<Vec<GitlabPipeline>, GitlabError> {
        let mut page = "1".to_owned();
        let mut seen_pages = BTreeSet::new();
        let mut pipelines = Vec::new();

        while seen_pages.insert(page.clone()) {
            if seen_pages.len() > MAX_PAGES {
                return Err(GitlabError::PaginationLimit);
            }
            let response = self.transport.get(GitlabRequest {
                url: format!(
                    "{}/api/v4/projects/{project_id}/pipelines?per_page=100&page={page}",
                    self.base_url
                ),
                headers: BTreeMap::from([("PRIVATE-TOKEN".into(), self.token.clone())]),
            })?;
            if !(200..300).contains(&response.status) {
                return Err(GitlabError::UnexpectedStatus(response.status));
            }
            let mut received: Vec<GitlabPipeline> = serde_json::from_value(response.body)
                .map_err(|error| GitlabError::InvalidResponse(error.to_string()))?;
            pipelines.append(&mut received);

            match response.next_page.filter(|next| !next.is_empty()) {
                Some(next) if !seen_pages.contains(&next) => page = next,
                Some(_) => return Err(GitlabError::PaginationLimit),
                None => break,
            }
        }

        Ok(pipelines)
    }

    /// Jobs of one pipeline, newest stages last as GitLab returns them.
    /// Bounded to `MAX_PIPELINE_JOBS` so a giant matrix does not flood the UI.
    pub fn list_pipeline_jobs(
        &self,
        project_id: u64,
        pipeline_id: u64,
    ) -> Result<Vec<GitlabJob>, GitlabError> {
        let response = self.transport.get(GitlabRequest {
            url: format!(
                "{}/api/v4/projects/{project_id}/pipelines/{pipeline_id}/jobs?per_page=100",
                self.base_url
            ),
            headers: BTreeMap::from([("PRIVATE-TOKEN".into(), self.token.clone())]),
        })?;
        if !(200..300).contains(&response.status) {
            return Err(GitlabError::UnexpectedStatus(response.status));
        }
        let mut jobs: Vec<GitlabJob> = serde_json::from_value(response.body)
            .map_err(|error| GitlabError::InvalidResponse(error.to_string()))?;
        if jobs.len() > MAX_PIPELINE_JOBS {
            jobs.truncate(MAX_PIPELINE_JOBS);
        }
        Ok(jobs)
    }

    /// Bounded tail of a job's plain-text trace.
    pub fn get_job_trace(
        &self,
        project_id: u64,
        job_id: u64,
        max_bytes: usize,
    ) -> Result<(String, bool), GitlabError> {
        let (status, text) = self.transport.get_text(GitlabRequest {
            url: format!(
                "{}/api/v4/projects/{project_id}/jobs/{job_id}/trace",
                self.base_url
            ),
            headers: BTreeMap::from([("PRIVATE-TOKEN".into(), self.token.clone())]),
        })?;
        if !(200..300).contains(&status) {
            return Err(GitlabError::UnexpectedStatus(status));
        }
        Ok(bound_log_text(&text, max_bytes))
    }

    /// Bounded per-file diffs for one merge request. Caps the file list and
    /// truncates each patch so a large MR cannot flood the detail pane.
    pub fn get_merge_request_diff(
        &self,
        project_id: &str,
        iid: u64,
        max_files: usize,
    ) -> Result<GetMergeRequestDiffOut, GitlabError> {
        let max_files = max_files.clamp(1, HARD_MAX_DIFF_FILES);
        let project = encode_project_path(project_id.trim_matches('/'));
        let mut page = "1".to_owned();
        let mut seen_pages = BTreeSet::new();
        let mut files = Vec::new();
        let mut truncated = false;

        while seen_pages.insert(page.clone()) {
            if seen_pages.len() > MAX_PAGES {
                return Err(GitlabError::PaginationLimit);
            }
            let response = self.transport.get(GitlabRequest {
                url: format!(
                    "{}/api/v4/projects/{project}/merge_requests/{iid}/diffs?per_page=100&page={page}",
                    self.base_url
                ),
                headers: BTreeMap::from([("PRIVATE-TOKEN".into(), self.token.clone())]),
            })?;
            if !(200..300).contains(&response.status) {
                return Err(GitlabError::UnexpectedStatus(response.status));
            }
            let received: Vec<GitlabDiffFile> = serde_json::from_value(response.body)
                .map_err(|error| GitlabError::InvalidResponse(error.to_string()))?;
            for entry in received {
                if files.len() >= max_files {
                    truncated = true;
                    break;
                }
                files.push(normalize_gitlab_diff_file(entry));
            }
            if truncated {
                break;
            }
            match response.next_page.filter(|next| !next.is_empty()) {
                Some(_) if files.len() >= max_files => {
                    truncated = true;
                    break;
                }
                Some(next) if !seen_pages.contains(&next) => page = next,
                Some(_) => return Err(GitlabError::PaginationLimit),
                None => break,
            }
        }

        Ok(GetMergeRequestDiffOut {
            total_files: files.len(),
            truncated,
            files,
        })
    }
}

/// One file from `GET …/merge_requests/:iid/diffs`.
#[derive(Debug, Clone, Deserialize)]
struct GitlabDiffFile {
    #[serde(default)]
    old_path: Option<String>,
    #[serde(default)]
    new_path: Option<String>,
    #[serde(default)]
    diff: Option<String>,
    #[serde(default)]
    new_file: bool,
    #[serde(default)]
    deleted_file: bool,
    #[serde(default)]
    renamed_file: bool,
}

fn normalize_gitlab_diff_file(entry: GitlabDiffFile) -> ChangeDiffFile {
    let status = if entry.new_file {
        "added"
    } else if entry.deleted_file {
        "deleted"
    } else if entry.renamed_file {
        "renamed"
    } else {
        "modified"
    };
    let path = entry
        .new_path
        .clone()
        .or_else(|| entry.old_path.clone())
        .unwrap_or_default();
    let old_path = entry.old_path.filter(|old| old != &path);
    ChangeDiffFile {
        path,
        old_path,
        status: status.into(),
        patch: entry.diff.map(bound_patch),
    }
}

fn bound_patch(patch: String) -> String {
    if patch.len() <= MAX_PATCH_CHARS {
        return patch;
    }
    let mut cut = MAX_PATCH_CHARS;
    while cut > 0 && !patch.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}…", &patch[..cut])
}

fn resolve_max_diff_files(requested: Option<u32>) -> usize {
    requested
        .map(|n| n as usize)
        .unwrap_or(DEFAULT_MAX_DIFF_FILES)
        .clamp(1, HARD_MAX_DIFF_FILES)
}

/// GitLab's `GET /projects/:id` accepts a URL-encoded namespace path. Keep
/// the path escaping local to this boundary: a profile filter is data, never
/// a URL fragment or query string.
fn encode_project_path(path: &str) -> String {
    path.bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            other => format!("%{other:02X}").chars().collect(),
        })
        .collect()
}

fn project_matches(project: &GitlabProject, filters: &[String]) -> bool {
    filters.is_empty()
        || filters.iter().any(|filter| {
            let filter = filter.trim_matches('/');
            project.path_with_namespace == filter
                || project
                    .path_with_namespace
                    .strip_prefix(filter)
                    .is_some_and(|suffix| suffix.starts_with('/'))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[derive(Default)]
    struct FakeTransport {
        requests: RefCell<Vec<GitlabRequest>>,
    }

    impl GitlabTransport for FakeTransport {
        fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
            self.requests.borrow_mut().push(request.clone());
            if request.url.contains("/api/v4/projects/platform%2Fapi") {
                return Ok(GitlabResponse::json(
                    200,
                    None,
                    json!({
                        "id": 1,
                        "path_with_namespace": "platform/api",
                        "web_url": "https://gitlab.example.test/platform/api"
                    }),
                ));
            }
            let second_page = request.url.ends_with("page=2");
            Ok(GitlabResponse::json(
                200,
                if second_page { None } else { Some("2") },
                if second_page {
                    json!([
                        { "id": 3, "path_with_namespace": "platform/ignored", "web_url": "https://gitlab.example.test/platform/ignored" }
                    ])
                } else {
                    json!([
                        { "id": 1, "path_with_namespace": "platform/api", "web_url": "https://gitlab.example.test/platform/api" },
                        { "id": 2, "path_with_namespace": "payments/web", "web_url": "https://gitlab.example.test/payments/web" }
                    ])
                },
            ))
        }
    }

    #[test]
    fn lists_all_pages_and_keeps_only_profile_project_filters() {
        let transport = FakeTransport::default();
        let client = GitlabClient::new("https://gitlab.example.test/", "test-token", &transport)
            .expect("valid client");

        let projects = client
            .list_projects(&["platform/api".into(), "payments".into()])
            .expect("GitLab answered both pages");

        assert_eq!(
            projects
                .iter()
                .map(|project| project.path_with_namespace.as_str())
                .collect::<Vec<_>>(),
            vec!["platform/api", "payments/web"]
        );
        let requests = transport.requests.borrow();
        assert_eq!(requests.len(), 2);
        assert_eq!(
            requests[0].headers.get("PRIVATE-TOKEN"),
            Some(&"test-token".into())
        );
        assert!(requests[0]
            .url
            .ends_with("/api/v4/projects?membership=true&simple=true&per_page=100&page=1"));
        assert!(requests[1].url.ends_with("page=2"));
    }

    #[test]
    fn resolves_an_exact_project_path_without_enumerating_every_membership_page() {
        let transport = FakeTransport::default();
        let client = GitlabClient::new("https://gitlab.example.test", "test-token", &transport)
            .expect("valid client");

        let projects = client
            .list_projects(&["platform/api".into()])
            .expect("the named project resolves");

        assert_eq!(projects.len(), 1);
        let requests = transport.requests.borrow();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].url.ends_with("/api/v4/projects/platform%2Fapi"));
    }

    #[test]
    fn reqwest_transport_forwards_pat_and_next_page_header() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(1)))
                .unwrap();
            let mut bytes = [0; 4096];
            let read = stream.read(&mut bytes).unwrap();
            let request = String::from_utf8_lossy(&bytes[..read]);
            assert!(request.contains("GET /api/v4/projects?page=1 HTTP/1.1"));
            assert!(request.contains("private-token: fixture-token"));
            let body = r#"[{"id":7,"path_with_namespace":"platform/api","web_url":"https://gitlab.example.test/platform/api"}]"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Next-Page: 2\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });

        let response = ReqwestGitlabTransport::new()
            .unwrap()
            .get(GitlabRequest {
                url: format!("http://{address}/api/v4/projects?page=1"),
                headers: BTreeMap::from([("PRIVATE-TOKEN".into(), "fixture-token".into())]),
            })
            .unwrap();

        assert_eq!(response.status, 200);
        assert_eq!(response.next_page.as_deref(), Some("2"));
        assert_eq!(response.body[0]["id"], 7);
        server.join().unwrap();
    }

    #[test]
    fn normalizes_a_gitlab_project_into_a_source_entity() {
        let entity = normalize_project(&GitlabProject {
            id: 7,
            path_with_namespace: "platform/api".into(),
            web_url: "https://gitlab.example.test/platform/api".into(),
            default_branch: Some("main".into()),
        });

        assert_eq!(entity.id, "gitlab:project:7");
        assert_eq!(entity.kind, srelens_devops_model::EntityKind::Project);
        assert_eq!(entity.source, srelens_devops_model::Source::Gitlab);
        assert_eq!(entity.title, "platform/api");
        assert_eq!(
            entity.url.as_deref(),
            Some("https://gitlab.example.test/platform/api")
        );
        assert_eq!(entity.attributes["defaultBranch"], "main");
    }

    #[test]
    fn lists_project_merge_requests_and_normalizes_them() {
        struct MergeRequestTransport {
            requests: RefCell<Vec<GitlabRequest>>,
        }

        impl GitlabTransport for MergeRequestTransport {
            fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
                self.requests.borrow_mut().push(request.clone());
                let second_page = request.url.ends_with("page=2");
                Ok(GitlabResponse::json(
                    200,
                    if second_page { None } else { Some("2") },
                    if second_page {
                        json!([{
                            "iid": 43,
                            "title": "Follow-up",
                            "web_url": "https://gitlab.example.test/platform/api/-/merge_requests/43",
                            "source_branch": "feature/OPS-143",
                            "target_branch": "main",
                            "sha": "f00dbabe",
                            "state": "merged"
                        }])
                    } else {
                        json!([{
                            "iid": 42,
                            "title": "Cache invalidation",
                            "web_url": "https://gitlab.example.test/platform/api/-/merge_requests/42",
                            "source_branch": "feature/OPS-142-cache",
                            "target_branch": "main",
                            "sha": "deadbeef",
                            "state": "opened"
                        }])
                    },
                ))
            }
        }

        let transport = MergeRequestTransport {
            requests: RefCell::new(vec![]),
        };
        let client =
            GitlabClient::new("https://gitlab.example.test", "test-token", &transport).unwrap();

        let merge_requests = client.list_merge_requests(7).unwrap();

        assert_eq!(merge_requests.len(), 2);
        assert_eq!(merge_requests[0].iid, 42);
        assert_eq!(
            normalize_merge_request(7, &merge_requests[0]),
            Entity {
                id: "gitlab:merge-request:7:42".into(),
                kind: EntityKind::PullRequest,
                source: Source::Gitlab,
                title: "Cache invalidation".into(),
                url: Some("https://gitlab.example.test/platform/api/-/merge_requests/42".into(),),
                attributes: json!({
                    "projectId": 7,
                    "iid": 42,
                    "sourceBranch": "feature/OPS-142-cache",
                    "targetBranch": "main",
                    "sha": "deadbeef",
                    "state": "opened"
                }),
            }
        );
        let requests = transport.requests.borrow();
        assert_eq!(requests.len(), 2);
        assert!(requests[0]
            .url
            .ends_with("/api/v4/projects/7/merge_requests?state=all&per_page=100&page=1"));
        assert!(requests[1].url.ends_with("page=2"));
    }

    #[test]
    fn lists_project_commits_and_normalizes_them() {
        struct CommitTransport;

        impl GitlabTransport for CommitTransport {
            fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
                assert!(request
                    .url
                    .ends_with("/api/v4/projects/7/repository/commits?per_page=100&page=1"));
                Ok(GitlabResponse::json(
                    200,
                    None,
                    json!([{
                        "id": "0123456789abcdef",
                        "title": "Fix cache invalidation",
                        "web_url": "https://gitlab.example.test/platform/api/-/commit/0123456789abcdef",
                        "author_name": "A. Operator"
                    }]),
                ))
            }
        }

        let client =
            GitlabClient::new("https://gitlab.example.test", "test-token", CommitTransport)
                .unwrap();
        let commits = client.list_commits(7).unwrap();

        assert_eq!(commits.len(), 1);
        assert_eq!(
            normalize_commit(7, &commits[0]),
            Entity {
                id: "gitlab:commit:7:0123456789abcdef".into(),
                kind: EntityKind::Commit,
                source: Source::Gitlab,
                title: "Fix cache invalidation".into(),
                url: Some(
                    "https://gitlab.example.test/platform/api/-/commit/0123456789abcdef".into(),
                ),
                attributes: json!({
                    "projectId": 7,
                    "sha": "0123456789abcdef",
                    "authorName": "A. Operator"
                }),
            }
        );
    }

    #[test]
    fn lists_project_branches_and_normalizes_them() {
        struct BranchTransport;

        impl GitlabTransport for BranchTransport {
            fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
                assert!(request
                    .url
                    .ends_with("/api/v4/projects/7/repository/branches?per_page=100&page=1"));
                Ok(GitlabResponse::json(
                    200,
                    None,
                    json!([{
                        "name": "feature/OPS-142-retry-worker",
                        "commit": {
                            "id": "92ac41f7d2ab",
                            "short_id": "92ac41f7",
                            "title": "Retry worker"
                        },
                        "protected": false,
                        "default": false,
                        "web_url": "https://gitlab.example.test/platform/payments/-/tree/feature/OPS-142-retry-worker"
                    }]),
                ))
            }
        }

        let client =
            GitlabClient::new("https://gitlab.example.test", "test-token", BranchTransport)
                .unwrap();
        let branches = client.list_branches(7).unwrap();

        assert_eq!(branches.len(), 1);
        assert_eq!(
            normalize_branch(7, &branches[0]),
            Entity {
                id: "gitlab:branch:7:feature/OPS-142-retry-worker".into(),
                kind: EntityKind::Branch,
                source: Source::Gitlab,
                title: "feature/OPS-142-retry-worker".into(),
                url: Some(
                    "https://gitlab.example.test/platform/payments/-/tree/feature/OPS-142-retry-worker"
                        .into(),
                ),
                attributes: json!({
                    "projectId": 7,
                    "name": "feature/OPS-142-retry-worker",
                    "sha": "92ac41f7d2ab",
                    "protected": false,
                    "default": false,
                }),
            }
        );
    }

    #[test]
    fn lists_project_pipelines_and_normalizes_them() {
        struct PipelineTransport;

        impl GitlabTransport for PipelineTransport {
            fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
                assert!(request
                    .url
                    .ends_with("/api/v4/projects/7/pipelines?per_page=100&page=1"));
                Ok(GitlabResponse::json(
                    200,
                    None,
                    json!([{
                        "id": 821,
                        "status": "success",
                        "ref": "main",
                        "sha": "0123456789abcdef",
                        "web_url": "https://gitlab.example.test/platform/api/-/pipelines/821"
                    }]),
                ))
            }
        }

        let client = GitlabClient::new(
            "https://gitlab.example.test",
            "test-token",
            PipelineTransport,
        )
        .unwrap();
        let pipelines = client.list_pipelines(7).unwrap();

        assert_eq!(
            normalize_pipeline(7, &pipelines[0]),
            Entity {
                id: "gitlab:pipeline:7:821".into(),
                kind: EntityKind::Build,
                source: Source::Gitlab,
                title: "Pipeline #821 (success)".into(),
                url: Some("https://gitlab.example.test/platform/api/-/pipelines/821".into()),
                attributes: json!({
                    "projectId": 7,
                    "pipelineId": 821,
                    "status": "success",
                    "ref": "main",
                    "sha": "0123456789abcdef"
                }),
            }
        );
    }

    #[test]
    fn normalize_pipeline_exposes_release_ref_as_image_tag() {
        let pipeline = GitlabPipeline {
            id: 3540625,
            status: "manual".into(),
            r#ref: "v1.0.28".into(),
            sha: "bcfaac480d1f".into(),
            web_url: "https://gitlab.example.test/-/pipelines/3540625".into(),
        };
        let entity = normalize_pipeline(67065, &pipeline);
        assert_eq!(entity.attributes["imageTag"], "v1.0.28");
        assert_eq!(entity.attributes["tag"], "v1.0.28");
        assert_eq!(entity.attributes["ref"], "v1.0.28");
        assert!(image_tag_from_pipeline_ref("feature/x").is_none());
        assert!(image_tag_from_pipeline_ref("main").is_none());
        assert_eq!(image_tag_from_pipeline_ref("3.2.11"), Some("3.2.11"));
    }

    #[test]
    fn bound_log_text_keeps_the_tail() {
        let (text, truncated) = bound_log_text("abcdef", 4);
        assert_eq!(text, "cdef");
        assert!(truncated);
        let (short, not_truncated) = bound_log_text("hi", 10);
        assert_eq!(short, "hi");
        assert!(!not_truncated);
    }

    #[test]
    fn get_merge_request_diff_bounds_files_and_patches() {
        struct DiffTransport;

        impl GitlabTransport for DiffTransport {
            fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
                assert!(request.url.contains(
                    "/api/v4/projects/7/merge_requests/42/diffs?per_page=100&page=1"
                ));
                Ok(GitlabResponse::json(
                    200,
                    None,
                    json!([
                        {
                            "old_path": "src/a.rs",
                            "new_path": "src/a.rs",
                            "diff": "@@ -1 +1 @@\n-old\n+new\n",
                            "new_file": false,
                            "deleted_file": false,
                            "renamed_file": false
                        },
                        {
                            "old_path": "gone.txt",
                            "new_path": "gone.txt",
                            "diff": "-bye\n",
                            "new_file": false,
                            "deleted_file": true,
                            "renamed_file": false
                        },
                        {
                            "old_path": "skip.rs",
                            "new_path": "skip.rs",
                            "diff": "+extra\n",
                            "new_file": true,
                            "deleted_file": false,
                            "renamed_file": false
                        }
                    ]),
                ))
            }
        }

        let client =
            GitlabClient::new("https://gitlab.example.test", "test-token", DiffTransport).unwrap();
        let out = client.get_merge_request_diff("7", 42, 2).unwrap();
        assert_eq!(out.files.len(), 2);
        assert!(out.truncated);
        assert_eq!(out.total_files, 2);
        assert_eq!(out.files[0].path, "src/a.rs");
        assert_eq!(out.files[0].status, "modified");
        assert_eq!(out.files[0].patch.as_deref(), Some("@@ -1 +1 @@\n-old\n+new\n"));
        assert_eq!(out.files[1].status, "deleted");
    }
}

impl std::fmt::Display for GitlabError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GitlabError::InvalidBaseUrl => write!(f, "the GitLab base URL is unusable"),
            GitlabError::Transport(reason) => write!(f, "the GitLab request failed: {reason}"),
            GitlabError::UnexpectedStatus(status) => {
                write!(f, "GitLab answered with HTTP {status}")
            }
            GitlabError::InvalidResponse(reason) => {
                write!(f, "GitLab returned an unexpected payload: {reason}")
            }
            GitlabError::PaginationLimit => write!(f, "GitLab pagination did not terminate"),
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListMergeRequestsIn {
    /// Narrows the profile's own project filters for this call. Empty means
    /// "use what the profile already names".
    #[serde(default)]
    pub project_filters: Vec<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListMergeRequestsOut {
    pub merge_requests: Vec<Entity>,
    /// The project paths the filters actually resolved to, so a reader can tell
    /// a narrowed query from an empty answer.
    pub projects: Vec<String>,
}

/// `gitlab.listMergeRequests` — read merge requests of the active profile's
/// projects.
///
/// The profile names the projects; without a filter this refuses rather than
/// scanning every project the token can see. Credential and configuration
/// failures keep their own reasons.
pub fn list_merge_requests_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn GitlabTransport + Send + Sync>, GitlabError> + Send + Sync,
    >,
) -> Capability {
    Capability::typed::<ListMergeRequestsIn, ListMergeRequestsOut, _, _>(
        "gitlab.listMergeRequests",
        "list merge requests of the active DevOps profile's GitLab projects",
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                let connection = active_connection(&settings, store.as_ref(), Provider::Gitlab)
                    .await
                    .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let filters = if input.project_filters.is_empty() {
                    connection.project_filters.clone()
                } else {
                    input.project_filters.clone()
                };
                if filters.is_empty() {
                    return Err(CapabilityError::Handler(format!(
                        "profile {} names no GitLab projects; add a project filter or pass projectFilters",
                        connection.profile_id
                    )));
                }

                let (merge_requests, projects) = tokio::task::spawn_blocking(move || {
                    let transport = transport(connection.tls.clone()).map_err(|error| error.to_string())?;
                    let client = GitlabClient::new(
                        &connection.base_url,
                        &connection.credential.secret,
                        transport,
                    )
                    .map_err(|error| error.to_string())?;
                    let projects = client.list_projects(&filters).map_err(|e| e.to_string())?;
                    let mut merge_requests = Vec::new();
                    for project in &projects {
                        let found = client
                            .list_merge_requests(project.id)
                            .map_err(|e| e.to_string())?;
                        merge_requests.extend(
                            found
                                .iter()
                                .map(|merge_request| normalize_merge_request(project.id, merge_request)),
                        );
                    }
                    Ok::<_, String>((merge_requests, projects))
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the GitLab request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)?;

                Ok(ListMergeRequestsOut {
                    merge_requests,
                    projects: projects
                        .iter()
                        .map(|project| project.path_with_namespace.clone())
                        .collect(),
                })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListProjectEntitiesIn {
    /// Narrows the profile's own project filters for this call. Empty means
    /// "use what the profile already names".
    #[serde(default)]
    pub project_filters: Vec<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectEntitiesOut {
    pub entities: Vec<Entity>,
    pub projects: Vec<String>,
}

#[derive(Clone, Copy)]
enum ProjectEntityKind {
    Commit,
    Pipeline,
    Branch,
}

fn list_project_entities_capability(
    id: &'static str,
    description: &'static str,
    kind: ProjectEntityKind,
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn GitlabTransport + Send + Sync>, GitlabError> + Send + Sync,
    >,
) -> Capability {
    Capability::typed::<ListProjectEntitiesIn, ListProjectEntitiesOut, _, _>(
        id,
        description,
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                let connection = active_connection(&settings, store.as_ref(), Provider::Gitlab)
                    .await
                    .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let filters = if input.project_filters.is_empty() {
                    connection.project_filters.clone()
                } else {
                    input.project_filters
                };
                if filters.is_empty() {
                    return Err(CapabilityError::InvalidInput(
                        "the active profile names no GitLab projects; refusing to scan every project"
                            .into(),
                    ));
                }

                let (entities, projects) = tokio::task::spawn_blocking(move || {
                    let transport = transport(connection.tls.clone()).map_err(|error| error.to_string())?;
                    let client = GitlabClient::new(
                        &connection.base_url,
                        &connection.credential.secret,
                        transport,
                    )
                    .map_err(|error| error.to_string())?;
                    let projects = client.list_projects(&filters).map_err(|error| error.to_string())?;
                    let mut entities = Vec::new();
                    for project in &projects {
                        match kind {
                            ProjectEntityKind::Commit => entities.extend(
                                client
                                    .list_commits(project.id)
                                    .map_err(|error| error.to_string())?
                                    .iter()
                                    .map(|commit| normalize_commit(project.id, commit)),
                            ),
                            ProjectEntityKind::Pipeline => entities.extend(
                                client
                                    .list_pipelines(project.id)
                                    .map_err(|error| error.to_string())?
                                    .iter()
                                    .map(|pipeline| normalize_pipeline(project.id, pipeline)),
                            ),
                            ProjectEntityKind::Branch => entities.extend(
                                client
                                    .list_branches(project.id)
                                    .map_err(|error| error.to_string())?
                                    .iter()
                                    .map(|branch| normalize_branch(project.id, branch)),
                            ),
                        }
                    }
                    Ok::<_, String>((entities, projects))
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the GitLab request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)?;

                Ok(ListProjectEntitiesOut {
                    entities,
                    projects: projects
                        .into_iter()
                        .map(|project| project.path_with_namespace)
                        .collect(),
                })
            }
        },
    )
}

/// `gitlab.listCommits` — list commits of the active profile's named projects.
pub fn list_commits_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn GitlabTransport + Send + Sync>, GitlabError> + Send + Sync,
    >,
) -> Capability {
    list_project_entities_capability(
        "gitlab.listCommits",
        "list commits of the active DevOps profile's GitLab projects",
        ProjectEntityKind::Commit,
        store,
        settings_get,
        transport,
    )
}

/// `gitlab.listPipelines` — list pipelines of the active profile's named projects.
pub fn list_pipelines_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn GitlabTransport + Send + Sync>, GitlabError> + Send + Sync,
    >,
) -> Capability {
    list_project_entities_capability(
        "gitlab.listPipelines",
        "list pipelines of the active DevOps profile's GitLab projects",
        ProjectEntityKind::Pipeline,
        store,
        settings_get,
        transport,
    )
}

/// `gitlab.listBranches` — list branches of the active profile's named projects.
pub fn list_branches_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn GitlabTransport + Send + Sync>, GitlabError> + Send + Sync,
    >,
) -> Capability {
    list_project_entities_capability(
        "gitlab.listBranches",
        "list branches of the active DevOps profile's GitLab projects",
        ProjectEntityKind::Branch,
        store,
        settings_get,
        transport,
    )
}

/// One bounded file entry shared by GitLab MR and Bitbucket PR diff caps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangeDiffFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetMergeRequestDiffIn {
    /// Numeric project id or `path/with/namespace`.
    pub project_id: String,
    pub iid: u64,
    #[serde(default)]
    pub max_files: Option<u32>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetMergeRequestDiffOut {
    pub files: Vec<ChangeDiffFile>,
    pub truncated: bool,
    /// Count of files returned in this payload (not the remote total).
    pub total_files: usize,
}

/// `gitlab.getMergeRequestDiff` — lazy, bounded file diffs for one MR.
pub fn get_merge_request_diff_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn GitlabTransport + Send + Sync>, GitlabError>
            + Send
            + Sync,
    >,
) -> Capability {
    Capability::typed::<GetMergeRequestDiffIn, GetMergeRequestDiffOut, _, _>(
        "gitlab.getMergeRequestDiff",
        "fetch a bounded file diff for one GitLab merge request",
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                if input.project_id.trim().is_empty() {
                    return Err(CapabilityError::InvalidInput(
                        "projectId is required".into(),
                    ));
                }
                let connection = active_connection(&settings, store.as_ref(), Provider::Gitlab)
                    .await
                    .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let max_files = resolve_max_diff_files(input.max_files);
                let project_id = input.project_id.clone();
                let iid = input.iid;

                tokio::task::spawn_blocking(move || {
                    let transport =
                        transport(connection.tls.clone()).map_err(|error| error.to_string())?;
                    let client = GitlabClient::new(
                        &connection.base_url,
                        &connection.credential.secret,
                        transport,
                    )
                    .map_err(|error| error.to_string())?;
                    client
                        .get_merge_request_diff(&project_id, iid, max_files)
                        .map_err(|error| error.to_string())
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the GitLab request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetPipelineJobsIn {
    pub project_id: u64,
    pub pipeline_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineFailure {
    pub job_id: u64,
    pub job_name: String,
    pub stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetPipelineJobsOut {
    pub jobs: Vec<Entity>,
    /// First hard-failed job (status failed, not allow_failure), when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<PipelineFailure>,
    /// True when the API returned more jobs than we keep.
    pub truncated: bool,
}

fn first_hard_failure(jobs: &[GitlabJob]) -> Option<PipelineFailure> {
    jobs.iter()
        .find(|job| job.status == "failed" && job.allow_failure != Some(true))
        .map(|job| PipelineFailure {
            job_id: job.id,
            job_name: job.name.clone(),
            stage: job.stage.clone(),
            failure_reason: job.failure_reason.clone(),
        })
}

/// `gitlab.getPipelineJobs` — list jobs (stages) of one pipeline with failure location.
pub fn get_pipeline_jobs_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn GitlabTransport + Send + Sync>, GitlabError> + Send + Sync,
    >,
) -> Capability {
    Capability::typed::<GetPipelineJobsIn, GetPipelineJobsOut, _, _>(
        "gitlab.getPipelineJobs",
        "list jobs of a GitLab pipeline for the active DevOps profile, including failure location",
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                if input.project_id == 0 || input.pipeline_id == 0 {
                    return Err(CapabilityError::InvalidInput(
                        "projectId and pipelineId must be positive".into(),
                    ));
                }
                let connection = active_connection(&settings, store.as_ref(), Provider::Gitlab)
                    .await
                    .map_err(|error| CapabilityError::Handler(error.to_string()))?;

                let (raw_jobs, truncated) = tokio::task::spawn_blocking(move || {
                    let transport = transport(connection.tls.clone()).map_err(|error| error.to_string())?;
                    let client = GitlabClient::new(
                        &connection.base_url,
                        &connection.credential.secret,
                        transport,
                    )
                    .map_err(|error| error.to_string())?;
                    let jobs = client
                        .list_pipeline_jobs(input.project_id, input.pipeline_id)
                        .map_err(|error| error.to_string())?;
                    let truncated = jobs.len() >= MAX_PIPELINE_JOBS;
                    Ok::<_, String>((jobs, truncated))
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the GitLab request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)?;

                let failure = first_hard_failure(&raw_jobs);
                let jobs = raw_jobs
                    .iter()
                    .map(|job| normalize_job(input.project_id, input.pipeline_id, job))
                    .collect();
                Ok(GetPipelineJobsOut {
                    jobs,
                    failure,
                    truncated,
                })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetJobTraceIn {
    pub project_id: u64,
    pub job_id: u64,
    /// Max bytes of the log tail to return. Defaults to 256 KiB; capped at 1 MiB.
    #[serde(default)]
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetJobTraceOut {
    pub text: String,
    pub truncated: bool,
    pub project_id: u64,
    pub job_id: u64,
}

/// `gitlab.getJobTrace` — bounded plain-text tail of one job's log.
pub fn get_job_trace_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn GitlabTransport + Send + Sync>, GitlabError> + Send + Sync,
    >,
) -> Capability {
    Capability::typed::<GetJobTraceIn, GetJobTraceOut, _, _>(
        "gitlab.getJobTrace",
        "read a bounded tail of a GitLab CI job trace for the active DevOps profile",
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                if input.project_id == 0 || input.job_id == 0 {
                    return Err(CapabilityError::InvalidInput(
                        "projectId and jobId must be positive".into(),
                    ));
                }
                let connection = active_connection(&settings, store.as_ref(), Provider::Gitlab)
                    .await
                    .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let max_bytes = resolve_trace_limit(input.max_bytes);

                let (text, truncated) = tokio::task::spawn_blocking(move || {
                    let transport = transport(connection.tls.clone()).map_err(|error| error.to_string())?;
                    let client = GitlabClient::new(
                        &connection.base_url,
                        &connection.credential.secret,
                        transport,
                    )
                    .map_err(|error| error.to_string())?;
                    client
                        .get_job_trace(input.project_id, input.job_id, max_bytes)
                        .map_err(|error| error.to_string())
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the GitLab request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)?;

                Ok(GetJobTraceOut {
                    text,
                    truncated,
                    project_id: input.project_id,
                    job_id: input.job_id,
                })
            }
        },
    )
}

#[cfg(test)]
mod capability_tests {
    use super::*;
    use srelens_capability::Registry;
    use srelens_devops_profiles::{Credential, CredentialRef, SessionCredentials};

    struct ScriptedTransport {
        urls: std::sync::Mutex<Vec<String>>,
    }

    impl GitlabTransport for ScriptedTransport {
        fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
            self.urls.lock().unwrap().push(request.url.clone());
            if request.url.contains("/repository/commits") {
                return Ok(GitlabResponse::json(
                    200,
                    None,
                    json!([{
                        "id": "92ac41f7d2ab",
                        "title": "Retry worker",
                        "web_url": "https://gitlab.example.test/platform/payments/-/commit/92ac41f7d2ab",
                        "author_name": "Operator"
                    }]),
                ));
            }
            if request.url.contains("/repository/branches") {
                return Ok(GitlabResponse::json(
                    200,
                    None,
                    json!([{
                        "name": "feature/OPS-142-retry-worker",
                        "commit": { "id": "92ac41f7d2ab" },
                        "protected": false,
                        "default": false,
                        "web_url": "https://gitlab.example.test/platform/payments/-/tree/feature/OPS-142-retry-worker"
                    }]),
                ));
            }
            // Jobs path is `/pipelines/{id}/jobs` — match before bare `/pipelines`.
            if request.url.contains("/pipelines/") && request.url.contains("/jobs") {
                return Ok(GitlabResponse::json(
                    200,
                    None,
                    json!([
                        {
                            "id": 501,
                            "name": "build",
                            "stage": "build",
                            "status": "success",
                            "web_url": "https://gitlab.example.test/platform/payments/-/jobs/501",
                            "allow_failure": false
                        },
                        {
                            "id": 502,
                            "name": "integration",
                            "stage": "test",
                            "status": "failed",
                            "web_url": "https://gitlab.example.test/platform/payments/-/jobs/502",
                            "failure_reason": "script_failure",
                            "allow_failure": false
                        }
                    ]),
                ));
            }
            if request.url.contains("/pipelines") {
                return Ok(GitlabResponse::json(
                    200,
                    None,
                    json!([{
                        "id": 83,
                        "status": "success",
                        "ref": "main",
                        "sha": "92ac41f7d2ab",
                        "web_url": "https://gitlab.example.test/platform/payments/-/pipelines/83"
                    }]),
                ));
            }
            if request.url.contains("/merge_requests/") && request.url.contains("/diffs") {
                return Ok(GitlabResponse::json(
                    200,
                    None,
                    json!([{
                        "old_path": "src/retry.rs",
                        "new_path": "src/retry.rs",
                        "diff": "@@ -1 +1 @@\n-todo\n+done\n",
                        "new_file": false,
                        "deleted_file": false,
                        "renamed_file": false
                    }]),
                ));
            }
            if request.url.contains("/merge_requests") {
                return Ok(GitlabResponse::json(
                    200,
                    None,
                    json!([{
                        "iid": 482,
                        "title": "OPS-142 idempotent payment retry worker",
                        "web_url": "https://gitlab.example.test/platform/payments/-/merge_requests/482",
                        "source_branch": "feature/OPS-142-retry-worker",
                        "target_branch": "main",
                        "sha": "92ac41f7d2ab",
                        "state": "merged"
                    }]),
                ));
            }
            Ok(GitlabResponse::json(
                200,
                None,
                json!([{
                    "id": 7,
                    "path_with_namespace": "platform/payments",
                    "web_url": "https://gitlab.example.test/platform/payments",
                    "default_branch": "main"
                }]),
            ))
        }

        fn get_text(&self, request: GitlabRequest) -> Result<(u16, String), GitlabError> {
            self.urls.lock().unwrap().push(request.url.clone());
            if request.url.contains("/jobs/502/trace") {
                let mut body = String::from("ok line\n");
                body.push_str(&"FAIL ".repeat(80_000));
                body.push_str("integration exploded\n");
                return Ok((200, body));
            }
            Err(GitlabError::UnexpectedStatus(404))
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
                    "activeProfileId": "appfarm",
                    "profiles": [{
                        "id": "appfarm", "label": "AppFarm", "providers": [{
                            "provider": "gitlab", "baseUrl": "https://gitlab.example.test",
                            "authMethod": "accessToken", "projectFilters": filters
                        }]
                    }]
                } } }))
            }
        })
    }

    fn registry_with(
        store: Arc<dyn CredentialStore>,
        filters: Vec<&str>,
        transport: Arc<ScriptedTransport>,
    ) -> Registry {
        let mut registry = Registry::new();
        let merge_requests_transport = transport.clone();
        registry.register(list_merge_requests_capability(
            store.clone(),
            settings_capability(filters.clone()),
            Arc::new(move |_tls| Ok(merge_requests_transport.clone() as Arc<dyn GitlabTransport + Send + Sync>)),
        ));
        let commits_transport = transport.clone();
        registry.register(list_commits_capability(
            store.clone(),
            settings_capability(filters.clone()),
            Arc::new(move |_tls| Ok(commits_transport.clone() as Arc<dyn GitlabTransport + Send + Sync>)),
        ));
        let pipelines_transport = transport.clone();
        registry.register(list_pipelines_capability(
            store.clone(),
            settings_capability(filters.clone()),
            Arc::new(move |_tls| Ok(pipelines_transport.clone() as Arc<dyn GitlabTransport + Send + Sync>)),
        ));
        let jobs_transport = transport.clone();
        registry.register(get_pipeline_jobs_capability(
            store.clone(),
            settings_capability(filters.clone()),
            Arc::new(move |_tls| Ok(jobs_transport.clone() as Arc<dyn GitlabTransport + Send + Sync>)),
        ));
        let trace_transport = transport.clone();
        registry.register(get_job_trace_capability(
            store.clone(),
            settings_capability(filters.clone()),
            Arc::new(move |_tls| Ok(trace_transport.clone() as Arc<dyn GitlabTransport + Send + Sync>)),
        ));
        let diff_transport = transport.clone();
        registry.register(get_merge_request_diff_capability(
            store.clone(),
            settings_capability(filters.clone()),
            Arc::new(move |_tls| Ok(diff_transport.clone() as Arc<dyn GitlabTransport + Send + Sync>)),
        ));
        registry.register(list_branches_capability(
            store,
            settings_capability(filters),
            Arc::new(move |_tls| Ok(transport.clone() as Arc<dyn GitlabTransport + Send + Sync>)),
        ));
        registry
    }

    fn store_with_token() -> Arc<SessionCredentials> {
        let store = SessionCredentials::new();
        store.remember(
            &CredentialRef::new("appfarm", Provider::Gitlab),
            Credential {
                username: "oauth2".into(),
                secret: "must-not-appear".into(),
            },
        );
        Arc::new(store)
    }

    #[tokio::test]
    async fn lists_merge_requests_of_the_profiles_projects_without_echoing_the_token() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let registry = registry_with(store_with_token(), vec!["platform"], transport.clone());

        let out = registry
            .invoke("gitlab.listMergeRequests", json!({}))
            .await
            .expect("the profile resolves");

        assert_eq!(out["projects"], json!(["platform/payments"]));
        assert_eq!(out["mergeRequests"][0]["id"], "gitlab:merge-request:7:482");
        assert!(!out.to_string().contains("must-not-appear"));
        assert!(transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("/projects/7/merge_requests")));

        // The Rust spelling is not the contract the wrapper speaks.
        let wrong = registry
            .invoke("gitlab.listMergeRequests", json!({ "project_filters": [] }))
            .await;
        assert!(matches!(wrong, Err(CapabilityError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn lists_commits_and_pipelines_using_the_callers_camel_case_payload() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let registry = registry_with(store_with_token(), vec!["platform"], transport.clone());

        let commits = registry
            .invoke("gitlab.listCommits", json!({ "projectFilters": ["platform"] }))
            .await
            .expect("commits are listed");
        assert_eq!(commits["entities"][0]["id"], "gitlab:commit:7:92ac41f7d2ab");

        let pipelines = registry
            .invoke("gitlab.listPipelines", json!({}))
            .await
            .expect("pipelines are listed");
        assert_eq!(pipelines["entities"][0]["id"], "gitlab:pipeline:7:83");
        assert!(transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("/repository/commits")));
        assert!(registry
            .invoke("gitlab.listCommits", json!({ "project_filters": [] }))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn lists_branches_using_the_callers_camel_case_payload() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let registry = registry_with(store_with_token(), vec!["platform"], transport.clone());

        let branches = registry
            .invoke("gitlab.listBranches", json!({ "projectFilters": ["platform"] }))
            .await
            .expect("branches are listed");
        assert_eq!(
            branches["entities"][0]["id"],
            "gitlab:branch:7:feature/OPS-142-retry-worker"
        );
        assert!(transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("/repository/branches")));
        assert!(registry
            .invoke("gitlab.listBranches", json!({ "project_filters": [] }))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn a_profile_that_names_no_project_refuses_instead_of_scanning_everything() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let registry = registry_with(store_with_token(), vec![], transport.clone());

        let error = registry
            .invoke("gitlab.listMergeRequests", json!({}))
            .await
            .expect_err("no project is named");

        assert!(error.to_string().contains("names no GitLab projects"));
        assert!(transport.urls.lock().unwrap().is_empty(), "no request is made");
    }

    #[tokio::test]
    async fn a_profile_without_a_stored_token_fails_with_that_reason() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let registry = registry_with(
            Arc::new(SessionCredentials::new()),
            vec!["platform"],
            transport,
        );

        let error = registry
            .invoke("gitlab.listMergeRequests", json!({}))
            .await
            .expect_err("no token is stored");

        assert!(error
            .to_string()
            .contains("no credential is stored for appfarm/gitlab"));
    }

    #[tokio::test]
    async fn pipeline_jobs_and_trace_use_the_callers_camel_case_payload() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let registry = registry_with(store_with_token(), vec!["platform"], transport.clone());

        let jobs = registry
            .invoke(
                "gitlab.getPipelineJobs",
                json!({ "projectId": 7, "pipelineId": 83 }),
            )
            .await
            .expect("pipeline jobs");
        assert_eq!(jobs["jobs"][0]["id"], "gitlab:job:7:501");
        assert_eq!(jobs["failure"]["jobId"], 502);
        assert_eq!(jobs["failure"]["jobName"], "integration");
        assert_eq!(jobs["failure"]["stage"], "test");
        assert_eq!(jobs["failure"]["failureReason"], "script_failure");
        assert!(registry
            .invoke(
                "gitlab.getPipelineJobs",
                json!({ "project_id": 7, "pipeline_id": 83 }),
            )
            .await
            .is_err());

        let trace = registry
            .invoke(
                "gitlab.getJobTrace",
                json!({ "projectId": 7, "jobId": 502, "maxBytes": 2048 }),
            )
            .await
            .expect("job trace");
        assert_eq!(trace["truncated"], true);
        assert!(trace["text"].as_str().unwrap().contains("integration exploded"));
        assert!(!trace["text"].as_str().unwrap().contains("ok line"));
        assert!(!trace.to_string().contains("must-not-appear"));
        assert!(registry
            .invoke(
                "gitlab.getJobTrace",
                json!({ "project_id": 7, "job_id": 502 }),
            )
            .await
            .is_err());
        assert!(transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("/pipelines/83/jobs")));
        assert!(transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("/jobs/502/trace")));
    }

    #[tokio::test]
    async fn merge_request_diff_uses_the_callers_camel_case_payload() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let registry = registry_with(store_with_token(), vec!["platform"], transport.clone());

        let out = registry
            .invoke(
                "gitlab.getMergeRequestDiff",
                json!({ "projectId": "7", "iid": 482, "maxFiles": 10 }),
            )
            .await
            .expect("mr diff");
        assert_eq!(out["truncated"], false);
        assert_eq!(out["totalFiles"], 1);
        assert_eq!(out["files"][0]["path"], "src/retry.rs");
        assert_eq!(out["files"][0]["status"], "modified");
        assert!(out["files"][0]["patch"]
            .as_str()
            .unwrap()
            .contains("+done"));
        assert!(!out.to_string().contains("must-not-appear"));
        assert!(transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("/merge_requests/482/diffs")));

        // Rust field spelling is not the wire contract.
        assert!(registry
            .invoke(
                "gitlab.getMergeRequestDiff",
                json!({ "project_id": "7", "iid": 482 }),
            )
            .await
            .is_err());
        assert!(registry
            .invoke(
                "gitlab.getMergeRequestDiff",
                json!({ "projectId": "7", "iid": 482, "max_files": 10 }),
            )
            .await
            .is_err());
    }
}
