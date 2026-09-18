use base64::Engine;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use srelens_capability::{Annotations, Capability, CapabilityError};
use srelens_devops_model::{Entity, EntityKind, Source};
use srelens_devops_profiles::{active_connection, AuthMethod, CredentialStore, Provider};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::Duration;

const MAX_PAGES: usize = 100;
const DEFAULT_MAX_DIFF_FILES: usize = 40;
const HARD_MAX_DIFF_FILES: usize = 80;
const MAX_PATCH_CHARS: usize = 12_000;
/// Soft cap: CORP-scale projects can have hundreds of repos; unbounded PR/commit
/// fan-out freezes the Git panel. Raise deliberately when product needs a deeper scan.
const MAX_REPOS_PER_PROJECT: usize = 25;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BitbucketRequest {
    pub url: String,
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct BitbucketResponse {
    pub status: u16,
    pub next_page: Option<String>,
    pub body: Value,
}

impl BitbucketResponse {
    pub fn json(status: u16, next_page: Option<&str>, body: Value) -> Self {
        Self {
            status,
            next_page: next_page.map(str::to_owned),
            body,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BitbucketError {
    InvalidBaseUrl,
    InvalidCredentials,
    Transport(String),
    UnexpectedStatus(u16),
    InvalidResponse(String),
    PaginationLimit,
}

/// Auth methods Bitbucket Data Center accepts: Basic login/password or a
/// bearer token (HTTP access token) for technical accounts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BitbucketAuth {
    Basic { username: String, password: String },
    BearerToken(String),
}

pub trait BitbucketTransport {
    fn get(&self, request: BitbucketRequest) -> Result<BitbucketResponse, BitbucketError>;
}

/// An `Arc` is a transport too, so a capability can share one across calls.
impl<T: BitbucketTransport + ?Sized> BitbucketTransport for Arc<T> {
    fn get(&self, request: BitbucketRequest) -> Result<BitbucketResponse, BitbucketError> {
        (**self).get(request)
    }
}

impl<T: BitbucketTransport + ?Sized> BitbucketTransport for &T {
    fn get(&self, request: BitbucketRequest) -> Result<BitbucketResponse, BitbucketError> {
        (*self).get(request)
    }
}

pub struct ReqwestBitbucketTransport {
    client: reqwest::blocking::Client,
}

impl ReqwestBitbucketTransport {
    pub fn new() -> Result<Self, BitbucketError> {
        Self::with_tls(&srelens_devops_profiles::TlsConfig::default())
    }

    pub fn with_tls(tls: &srelens_devops_profiles::TlsConfig) -> Result<Self, BitbucketError> {
        let client = srelens_devops_profiles::blocking_client(
            tls,
            BitbucketError::Transport,
            |builder| builder.redirect(reqwest::redirect::Policy::none()),
        )?;
        Ok(Self { client })
    }
}

impl BitbucketTransport for ReqwestBitbucketTransport {
    fn get(&self, request: BitbucketRequest) -> Result<BitbucketResponse, BitbucketError> {
        let mut builder = self.client.get(&request.url);
        for (name, value) in request.headers {
            builder = builder.header(name, value);
        }
        let response = builder
            .send()
            .map_err(|e| BitbucketError::Transport(e.to_string()))?;
        let status = response.status().as_u16();
        let next_page = response
            .headers()
            .get("X-Next-Page")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body = response
            .json()
            .map_err(|e| BitbucketError::InvalidResponse(e.to_string()))?;
        Ok(BitbucketResponse {
            status,
            next_page,
            body,
        })
    }
}

fn basic_auth_header(username: &str, password: &str) -> String {
    let encoded =
        base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"));
    format!("Basic {encoded}")
}

fn auth_header(auth: &BitbucketAuth) -> Result<String, BitbucketError> {
    match auth {
        BitbucketAuth::Basic { username, password }
            if !username.is_empty() && !password.is_empty() =>
        {
            Ok(basic_auth_header(username, password))
        }
        BitbucketAuth::BearerToken(token) if !token.is_empty() => Ok(format!("Bearer {token}")),
        _ => Err(BitbucketError::InvalidCredentials),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BitbucketPullRequest {
    pub id: u64,
    pub title: String,
    pub state: String,
    pub links: BitbucketLinks,
    #[serde(default, rename = "fromRef")]
    pub from_ref: Option<BitbucketRef>,
    #[serde(default, rename = "toRef")]
    pub to_ref: Option<BitbucketRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BitbucketLinks {
    /// Bitbucket DC renders every link as an array of `{ href }` objects;
    /// the first entry is the canonical URL.
    #[serde(rename = "self", default)]
    pub self_link: Vec<BitbucketLink>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BitbucketLink {
    pub href: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BitbucketRef {
    #[serde(default, rename = "displayId")]
    pub display_id: Option<String>,
    #[serde(default, rename = "latestCommit")]
    pub latest_commit: Option<String>,
}

/// Convert a Bitbucket Data Center pull request into the provider-neutral
/// graph model. The raw API response stays at the adapter boundary.
pub fn normalize_pull_request(
    project_key: &str,
    repository_slug: &str,
    pull_request: &BitbucketPullRequest,
) -> Entity {
    Entity {
        id: format!(
            "bitbucket:pr:{project_key}/{repository_slug}:{}",
            pull_request.id
        ),
        kind: EntityKind::PullRequest,
        source: Source::Bitbucket,
        title: pull_request.title.clone(),
        url: pull_request
            .links
            .self_link
            .first()
            .map(|link| link.href.clone()),
        attributes: json!({
            "projectKey": project_key,
            "repositorySlug": repository_slug,
            "pullRequestId": pull_request.id,
            "state": pull_request.state,
            "fromBranch": pull_request.from_ref.as_ref().and_then(|r| r.display_id.clone()),
            "toBranch": pull_request.to_ref.as_ref().and_then(|r| r.display_id.clone()),
            "sha": pull_request.from_ref.as_ref().and_then(|r| r.latest_commit.clone()),
        }),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BitbucketCommit {
    pub id: String,
    #[serde(default, rename = "displayId")]
    pub display_id: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

/// Convert a full Bitbucket commit SHA into the provider-neutral graph model.
pub fn normalize_commit(
    project_key: &str,
    repository_slug: &str,
    commit: &BitbucketCommit,
) -> Entity {
    Entity {
        id: format!(
            "bitbucket:commit:{project_key}/{repository_slug}:{}",
            commit.id
        ),
        kind: EntityKind::Commit,
        source: Source::Bitbucket,
        title: commit
            .display_id
            .clone()
            .unwrap_or_else(|| commit.id.clone()),
        url: None,
        attributes: json!({
            "projectKey": project_key,
            "repositorySlug": repository_slug,
            "sha": commit.id,
            "message": commit.message,
        }),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BitbucketBranch {
    pub id: String,
    #[serde(default, rename = "displayId")]
    pub display_id: Option<String>,
    #[serde(default, rename = "latestCommit")]
    pub latest_commit: Option<String>,
    #[serde(default, rename = "isDefault")]
    pub is_default: Option<bool>,
}

/// Convert a Bitbucket Data Center branch into the provider-neutral graph model.
pub fn normalize_branch(
    project_key: &str,
    repository_slug: &str,
    branch: &BitbucketBranch,
) -> Entity {
    let name = branch
        .display_id
        .clone()
        .unwrap_or_else(|| branch.id.clone());
    Entity {
        id: format!("bitbucket:branch:{project_key}/{repository_slug}:{name}"),
        kind: EntityKind::Branch,
        source: Source::Bitbucket,
        title: name.clone(),
        url: None,
        attributes: json!({
            "projectKey": project_key,
            "repositorySlug": repository_slug,
            "name": name,
            "sha": branch.latest_commit,
            "default": branch.is_default.unwrap_or(false),
            "ref": branch.id,
        }),
    }
}

pub struct BitbucketClient<T> {
    base_url: String,
    auth: BitbucketAuth,
    transport: T,
}

impl BitbucketAuth {
    /// The `Authorization` header value this auth method sends; used by tests
    /// to assert the wire format without a live transport.
    pub fn auth_header_value(&self) -> Result<String, BitbucketError> {
        auth_header(self)
    }
}

impl<T: BitbucketTransport> BitbucketClient<T> {
    pub fn new(base_url: &str, auth: BitbucketAuth, transport: T) -> Result<Self, BitbucketError> {
        let base_url = base_url.trim_end_matches('/');
        if !base_url.starts_with("https://") || base_url.len() == "https://".len() {
            return Err(BitbucketError::InvalidBaseUrl);
        }
        auth_header(&auth)?;
        Ok(Self {
            base_url: base_url.into(),
            auth,
            transport,
        })
    }

    /// List pull requests across every repository the profile's project
    /// filters allow. Bitbucket scopes PRs per repository, so each repository
    /// of each filtered project is visited once.
    pub fn list_pull_requests(
        &self,
        project_key: &str,
        repository_slug: &str,
    ) -> Result<Vec<BitbucketPullRequest>, BitbucketError> {
        let mut start = "0".to_owned();
        let mut seen_starts = BTreeSet::new();
        let mut pull_requests = Vec::new();

        while seen_starts.insert(start.clone()) {
            if seen_starts.len() > MAX_PAGES {
                return Err(BitbucketError::PaginationLimit);
            }
            let response = self.transport.get(BitbucketRequest {
                url: format!(
                    "{}/rest/api/1.0/projects/{project_key}/repos/{repository_slug}/pull-requests?state=ALL&limit=100&start={start}",
                    self.base_url
                ),
                headers: BTreeMap::from([("Authorization".into(), auth_header(&self.auth)?)]),
            })?;
            if !(200..300).contains(&response.status) {
                return Err(BitbucketError::UnexpectedStatus(response.status));
            }
            let mut received: Vec<BitbucketPullRequest> =
                serde_json::from_value(response.body["values"].clone())
                    .map_err(|error| BitbucketError::InvalidResponse(error.to_string()))?;
            pull_requests.append(&mut received);

            match response.next_page.filter(|next| !next.is_empty()) {
                Some(next) if !seen_starts.contains(&next) => start = next,
                Some(_) => return Err(BitbucketError::PaginationLimit),
                None => break,
            }
        }

        Ok(pull_requests)
    }

    pub fn list_commits(
        &self,
        project_key: &str,
        repository_slug: &str,
    ) -> Result<Vec<BitbucketCommit>, BitbucketError> {
        let mut start = "0".to_owned();
        let mut seen_starts = BTreeSet::new();
        let mut commits = Vec::new();

        while seen_starts.insert(start.clone()) {
            if seen_starts.len() > MAX_PAGES {
                return Err(BitbucketError::PaginationLimit);
            }
            let response = self.transport.get(BitbucketRequest {
                url: format!(
                    "{}/rest/api/1.0/projects/{project_key}/repos/{repository_slug}/commits?limit=100&start={start}",
                    self.base_url
                ),
                headers: BTreeMap::from([("Authorization".into(), auth_header(&self.auth)?)]),
            })?;
            if !(200..300).contains(&response.status) {
                return Err(BitbucketError::UnexpectedStatus(response.status));
            }
            let mut received: Vec<BitbucketCommit> =
                serde_json::from_value(response.body["values"].clone())
                    .map_err(|error| BitbucketError::InvalidResponse(error.to_string()))?;
            commits.append(&mut received);

            match response.next_page.filter(|next| !next.is_empty()) {
                Some(next) if !seen_starts.contains(&next) => start = next,
                Some(_) => return Err(BitbucketError::PaginationLimit),
                None => break,
            }
        }

        Ok(commits)
    }

    pub fn list_branches(
        &self,
        project_key: &str,
        repository_slug: &str,
    ) -> Result<Vec<BitbucketBranch>, BitbucketError> {
        let mut start = "0".to_owned();
        let mut seen_starts = BTreeSet::new();
        let mut branches = Vec::new();

        while seen_starts.insert(start.clone()) {
            if seen_starts.len() > MAX_PAGES {
                return Err(BitbucketError::PaginationLimit);
            }
            let response = self.transport.get(BitbucketRequest {
                url: format!(
                    "{}/rest/api/1.0/projects/{project_key}/repos/{repository_slug}/branches?limit=100&start={start}",
                    self.base_url
                ),
                headers: BTreeMap::from([("Authorization".into(), auth_header(&self.auth)?)]),
            })?;
            if !(200..300).contains(&response.status) {
                return Err(BitbucketError::UnexpectedStatus(response.status));
            }
            let mut received: Vec<BitbucketBranch> =
                serde_json::from_value(response.body["values"].clone())
                    .map_err(|error| BitbucketError::InvalidResponse(error.to_string()))?;
            branches.append(&mut received);

            match response.next_page.filter(|next| !next.is_empty()) {
                Some(next) if !seen_starts.contains(&next) => start = next,
                Some(_) => return Err(BitbucketError::PaginationLimit),
                None => break,
            }
        }

        Ok(branches)
    }

    /// Bounded file list (+ optional hunk text) for one pull request.
    pub fn get_pull_request_diff(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
        max_files: usize,
    ) -> Result<GetPullRequestDiffOut, BitbucketError> {
        let max_files = max_files.clamp(1, HARD_MAX_DIFF_FILES);
        let auth = auth_header(&self.auth)?;
        let limit = (max_files + 1).min(100);
        let response = self.transport.get(BitbucketRequest {
            url: format!(
                "{}/rest/api/1.0/projects/{project_key}/repos/{repository_slug}/pull-requests/{pull_request_id}/changes?limit={limit}&start=0",
                self.base_url
            ),
            headers: BTreeMap::from([("Authorization".into(), auth.clone())]),
        })?;
        if !(200..300).contains(&response.status) {
            return Err(BitbucketError::UnexpectedStatus(response.status));
        }
        let values = response.body["values"]
            .as_array()
            .ok_or_else(|| BitbucketError::InvalidResponse("missing values".into()))?;
        let truncated = values.len() > max_files
            || response
                .next_page
                .as_ref()
                .is_some_and(|next| !next.is_empty())
            || response.body["isLastPage"].as_bool() == Some(false);
        let mut files: Vec<ChangeDiffFile> = values
            .iter()
            .take(max_files)
            .map(normalize_bitbucket_change)
            .collect();

        // Best-effort patches from the PR-level JSON diff. Failure here still
        // leaves the file list — that list is the primary answer.
        if let Ok(patches) = self.fetch_pr_diff_patches(
            project_key,
            repository_slug,
            pull_request_id,
            &auth,
        ) {
            for file in &mut files {
                if let Some(patch) = patches.get(&file.path) {
                    file.patch = Some(bound_patch(patch.clone()));
                }
            }
        }

        Ok(GetPullRequestDiffOut {
            total_files: files.len(),
            truncated,
            files,
        })
    }

    fn fetch_pr_diff_patches(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
        auth: &str,
    ) -> Result<BTreeMap<String, String>, BitbucketError> {
        let response = self.transport.get(BitbucketRequest {
            url: format!(
                "{}/rest/api/1.0/projects/{project_key}/repos/{repository_slug}/pull-requests/{pull_request_id}/diff?contextLines=3",
                self.base_url
            ),
            headers: BTreeMap::from([("Authorization".into(), auth.to_owned())]),
        })?;
        if !(200..300).contains(&response.status) {
            return Err(BitbucketError::UnexpectedStatus(response.status));
        }
        let mut out = BTreeMap::new();
        let Some(diffs) = response.body["diffs"].as_array() else {
            return Ok(out);
        };
        for diff in diffs {
            let path = diff
                .pointer("/destination/toString")
                .or_else(|| diff.pointer("/source/toString"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            if path.is_empty() {
                continue;
            }
            out.insert(path, format_bitbucket_hunks(diff));
        }
        Ok(out)
    }

    /// List repository slugs of one project. Bitbucket has no cross-repository
    /// PR endpoint, so the caller iterates repositories first.
    pub fn list_repositories(&self, project_key: &str) -> Result<Vec<String>, BitbucketError> {
        let mut start = "0".to_owned();
        let mut seen_starts = BTreeSet::new();
        let mut slugs = Vec::new();

        while seen_starts.insert(start.clone()) {
            if seen_starts.len() > MAX_PAGES {
                return Err(BitbucketError::PaginationLimit);
            }
            let response = self.transport.get(BitbucketRequest {
                url: format!(
                    "{}/rest/api/1.0/projects/{project_key}/repos?limit=100&start={start}",
                    self.base_url
                ),
                headers: BTreeMap::from([("Authorization".into(), auth_header(&self.auth)?)]),
            })?;
            if !(200..300).contains(&response.status) {
                return Err(BitbucketError::UnexpectedStatus(response.status));
            }
            let received: Vec<String> = response.body["values"]
                .as_array()
                .ok_or_else(|| BitbucketError::InvalidResponse("missing values".into()))?
                .iter()
                .filter_map(|repo| repo["slug"].as_str().map(str::to_owned))
                .collect();
            slugs.extend(received);

            match response.next_page.filter(|next| !next.is_empty()) {
                Some(next) if !seen_starts.contains(&next) => start = next,
                Some(_) => return Err(BitbucketError::PaginationLimit),
                None => break,
            }
        }

        Ok(slugs)
    }
}

fn normalize_bitbucket_change(value: &Value) -> ChangeDiffFile {
    let path = value
        .pointer("/path/toString")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_owned();
    let old_path = value
        .pointer("/srcPath/toString")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .filter(|old| old != &path);
    let status = match value["type"].as_str().unwrap_or("") {
        "ADD" => "added",
        "DELETE" => "deleted",
        "MOVE" | "COPY" | "RENAME" => "renamed",
        _ => "modified",
    };
    ChangeDiffFile {
        path,
        old_path,
        status: status.into(),
        patch: None,
    }
}

fn format_bitbucket_hunks(diff: &Value) -> String {
    let mut out = String::new();
    let Some(hunks) = diff["hunks"].as_array() else {
        return out;
    };
    for hunk in hunks {
        let src_line = hunk["sourceLine"].as_u64().unwrap_or(0);
        let src_span = hunk["sourceSpan"].as_u64().unwrap_or(0);
        let dst_line = hunk["destinationLine"].as_u64().unwrap_or(0);
        let dst_span = hunk["destinationSpan"].as_u64().unwrap_or(0);
        out.push_str(&format!(
            "@@ -{src_line},{src_span} +{dst_line},{dst_span} @@\n"
        ));
        if let Some(segments) = hunk["segments"].as_array() {
            for segment in segments {
                let prefix = match segment["type"].as_str().unwrap_or("") {
                    "ADDED" => '+',
                    "REMOVED" => '-',
                    _ => ' ',
                };
                if let Some(lines) = segment["lines"].as_array() {
                    for line in lines {
                        let text = line["text"].as_str().unwrap_or("");
                        out.push(prefix);
                        out.push_str(text);
                        out.push('\n');
                    }
                }
            }
        }
    }
    out
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

impl std::fmt::Display for BitbucketError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BitbucketError::InvalidBaseUrl => write!(f, "the Bitbucket base URL is unusable"),
            BitbucketError::InvalidCredentials => {
                write!(f, "the Bitbucket credentials are empty or unusable")
            }
            BitbucketError::Transport(reason) => {
                write!(f, "the Bitbucket request failed: {reason}")
            }
            BitbucketError::UnexpectedStatus(status) => {
                write!(f, "Bitbucket answered with HTTP {status}")
            }
            BitbucketError::InvalidResponse(reason) => {
                write!(f, "Bitbucket returned an unexpected payload: {reason}")
            }
            BitbucketError::PaginationLimit => {
                write!(f, "Bitbucket pagination did not terminate")
            }
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListPullRequestsIn {
    /// Narrows the profile's own project filters for this call. Empty means
    /// "use what the profile already names".
    #[serde(default)]
    pub project_filters: Vec<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListPullRequestsOut {
    pub pull_requests: Vec<Entity>,
    /// The project keys the filters actually visited.
    pub projects: Vec<String>,
    /// True when at least one project had more repos than the soft fan-out cap.
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListCommitsIn {
    #[serde(default)]
    pub project_filters: Vec<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListCommitsOut {
    pub entities: Vec<Entity>,
    pub projects: Vec<String>,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListBranchesIn {
    #[serde(default)]
    pub project_filters: Vec<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListBranchesOut {
    pub entities: Vec<Entity>,
    pub projects: Vec<String>,
    #[serde(default)]
    pub truncated: bool,
}

fn bitbucket_auth(
    auth_method: &AuthMethod,
    username: &str,
    secret: &str,
) -> Result<BitbucketAuth, CapabilityError> {
    match auth_method {
        AuthMethod::Basic => Ok(BitbucketAuth::Basic {
            username: username.to_owned(),
            password: secret.to_owned(),
        }),
        AuthMethod::BearerToken => Ok(BitbucketAuth::BearerToken(secret.to_owned())),
        _ => Err(CapabilityError::Handler(
            "Bitbucket credentials must be basic or a bearer token".into(),
        )),
    }
}

fn resolve_project_filters(
    input_filters: &[String],
    connection_filters: &[String],
    profile_id: &str,
) -> Result<Vec<String>, CapabilityError> {
    let filters = if input_filters.is_empty() {
        connection_filters.to_vec()
    } else {
        input_filters.to_vec()
    };
    if filters.is_empty() {
        return Err(CapabilityError::Handler(format!(
            "profile {profile_id} names no Bitbucket projects; refusing to scan everything"
        )));
    }
    Ok(filters)
}

/// Bound per-project repository fan-out so a broad project filter cannot hang
/// the caller. Returns `(visited, truncated)`.
fn take_repos_for_fanout(slugs: Vec<String>) -> (Vec<String>, bool) {
    if slugs.len() <= MAX_REPOS_PER_PROJECT {
        (slugs, false)
    } else {
        (
            slugs.into_iter().take(MAX_REPOS_PER_PROJECT).collect(),
            true,
        )
    }
}

/// `bitbucket.listPullRequests` — read pull requests of the active profile's
/// Bitbucket Data Center projects.
pub fn list_pull_requests_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn BitbucketTransport + Send + Sync>, BitbucketError> + Send + Sync,
    >,
) -> Capability {
    Capability::typed::<ListPullRequestsIn, ListPullRequestsOut, _, _>(
        "bitbucket.listPullRequests",
        "list pull requests of the active DevOps profile's Bitbucket projects",
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                let connection =
                    active_connection(&settings, store.as_ref(), Provider::BitbucketDc)
                        .await
                        .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let filters = resolve_project_filters(
                    &input.project_filters,
                    &connection.project_filters,
                    &connection.profile_id,
                )?;
                let auth = bitbucket_auth(
                    &connection.auth_method,
                    &connection.credential.username,
                    &connection.credential.secret,
                )?;

                let (pull_requests, projects, truncated) = tokio::task::spawn_blocking(move || {
                    let transport = transport(connection.tls.clone()).map_err(|error| error.to_string())?;
                    let client = BitbucketClient::new(&connection.base_url, auth, transport)
                        .map_err(|error| error.to_string())?;
                    let mut pull_requests = Vec::new();
                    let mut projects = Vec::new();
                    let mut truncated = false;
                    for project_key in &filters {
                        projects.push(project_key.clone());
                        let slugs = client
                            .list_repositories(project_key)
                            .map_err(|error| error.to_string())?;
                        let (slugs, cut) = take_repos_for_fanout(slugs);
                        truncated |= cut;
                        for slug in slugs {
                            let found = client
                                .list_pull_requests(project_key, &slug)
                                .map_err(|error| error.to_string())?;
                            pull_requests.extend(found.iter().map(|pull_request| {
                                normalize_pull_request(project_key, &slug, pull_request)
                            }));
                        }
                    }
                    Ok::<_, String>((pull_requests, projects, truncated))
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the Bitbucket request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)?;

                Ok(ListPullRequestsOut {
                    pull_requests,
                    projects,
                    truncated,
                })
            }
        },
    )
}

/// `bitbucket.listCommits` — list commits of the active profile's named projects.
pub fn list_commits_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn BitbucketTransport + Send + Sync>, BitbucketError> + Send + Sync,
    >,
) -> Capability {
    Capability::typed::<ListCommitsIn, ListCommitsOut, _, _>(
        "bitbucket.listCommits",
        "list commits of the active DevOps profile's Bitbucket projects",
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                let connection =
                    active_connection(&settings, store.as_ref(), Provider::BitbucketDc)
                        .await
                        .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let filters = resolve_project_filters(
                    &input.project_filters,
                    &connection.project_filters,
                    &connection.profile_id,
                )?;
                let auth = bitbucket_auth(
                    &connection.auth_method,
                    &connection.credential.username,
                    &connection.credential.secret,
                )?;

                let (entities, projects, truncated) = tokio::task::spawn_blocking(move || {
                    let transport = transport(connection.tls.clone()).map_err(|error| error.to_string())?;
                    let client = BitbucketClient::new(&connection.base_url, auth, transport)
                        .map_err(|error| error.to_string())?;
                    let mut entities = Vec::new();
                    let mut projects = Vec::new();
                    let mut truncated = false;
                    for project_key in &filters {
                        projects.push(project_key.clone());
                        let slugs = client
                            .list_repositories(project_key)
                            .map_err(|error| error.to_string())?;
                        let (slugs, cut) = take_repos_for_fanout(slugs);
                        truncated |= cut;
                        for slug in slugs {
                            let found = client
                                .list_commits(project_key, &slug)
                                .map_err(|error| error.to_string())?;
                            entities.extend(
                                found
                                    .iter()
                                    .map(|commit| normalize_commit(project_key, &slug, commit)),
                            );
                        }
                    }
                    Ok::<_, String>((entities, projects, truncated))
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the Bitbucket request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)?;

                Ok(ListCommitsOut {
                    entities,
                    projects,
                    truncated,
                })
            }
        },
    )
}

/// `bitbucket.listBranches` — list branches of the active profile's named projects.
pub fn list_branches_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn BitbucketTransport + Send + Sync>, BitbucketError> + Send + Sync,
    >,
) -> Capability {
    Capability::typed::<ListBranchesIn, ListBranchesOut, _, _>(
        "bitbucket.listBranches",
        "list branches of the active DevOps profile's Bitbucket projects",
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                let connection =
                    active_connection(&settings, store.as_ref(), Provider::BitbucketDc)
                        .await
                        .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let filters = resolve_project_filters(
                    &input.project_filters,
                    &connection.project_filters,
                    &connection.profile_id,
                )?;
                let auth = bitbucket_auth(
                    &connection.auth_method,
                    &connection.credential.username,
                    &connection.credential.secret,
                )?;

                let (entities, projects, truncated) = tokio::task::spawn_blocking(move || {
                    let transport = transport(connection.tls.clone()).map_err(|error| error.to_string())?;
                    let client = BitbucketClient::new(&connection.base_url, auth, transport)
                        .map_err(|error| error.to_string())?;
                    let mut entities = Vec::new();
                    let mut projects = Vec::new();
                    let mut truncated = false;
                    for project_key in &filters {
                        projects.push(project_key.clone());
                        let slugs = client
                            .list_repositories(project_key)
                            .map_err(|error| error.to_string())?;
                        let (slugs, cut) = take_repos_for_fanout(slugs);
                        truncated |= cut;
                        for slug in slugs {
                            let found = client
                                .list_branches(project_key, &slug)
                                .map_err(|error| error.to_string())?;
                            entities.extend(
                                found
                                    .iter()
                                    .map(|branch| normalize_branch(project_key, &slug, branch)),
                            );
                        }
                    }
                    Ok::<_, String>((entities, projects, truncated))
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the Bitbucket request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)?;

                Ok(ListBranchesOut {
                    entities,
                    projects,
                    truncated,
                })
            }
        },
    )
}

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
pub struct GetPullRequestDiffIn {
    pub project_key: String,
    pub repository_slug: String,
    pub pull_request_id: u64,
    #[serde(default)]
    pub max_files: Option<u32>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetPullRequestDiffOut {
    pub files: Vec<ChangeDiffFile>,
    pub truncated: bool,
    /// Count of files returned in this payload (not the remote total).
    pub total_files: usize,
}

/// `bitbucket.getPullRequestDiff` — lazy, bounded file diffs for one PR.
pub fn get_pull_request_diff_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn BitbucketTransport + Send + Sync>, BitbucketError>
            + Send
            + Sync,
    >,
) -> Capability {
    Capability::typed::<GetPullRequestDiffIn, GetPullRequestDiffOut, _, _>(
        "bitbucket.getPullRequestDiff",
        "fetch a bounded file diff for one Bitbucket pull request",
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                if input.project_key.trim().is_empty() || input.repository_slug.trim().is_empty() {
                    return Err(CapabilityError::InvalidInput(
                        "projectKey and repositorySlug are required".into(),
                    ));
                }
                let connection =
                    active_connection(&settings, store.as_ref(), Provider::BitbucketDc)
                        .await
                        .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let auth = bitbucket_auth(
                    &connection.auth_method,
                    &connection.credential.username,
                    &connection.credential.secret,
                )?;
                let max_files = resolve_max_diff_files(input.max_files);
                let project_key = input.project_key.clone();
                let repository_slug = input.repository_slug.clone();
                let pull_request_id = input.pull_request_id;

                tokio::task::spawn_blocking(move || {
                    let transport =
                        transport(connection.tls.clone()).map_err(|error| error.to_string())?;
                    let client = BitbucketClient::new(&connection.base_url, auth, transport)
                        .map_err(|error| error.to_string())?;
                    client
                        .get_pull_request_diff(
                            &project_key,
                            &repository_slug,
                            pull_request_id,
                            max_files,
                        )
                        .map_err(|error| error.to_string())
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the Bitbucket request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;

    #[derive(Default)]
    struct FakeTransport {
        requests: RefCell<Vec<BitbucketRequest>>,
    }

    impl BitbucketTransport for FakeTransport {
        fn get(&self, request: BitbucketRequest) -> Result<BitbucketResponse, BitbucketError> {
            self.requests.borrow_mut().push(request.clone());
            let second_page = request.url.ends_with("start=1");
            let repositories = request.url.contains("/repos?");
            if repositories {
                return Ok(BitbucketResponse::json(
                    200,
                    if second_page { None } else { Some("1") },
                    if second_page {
                        json!({ "values": [ { "slug": "portal-legacy" } ] })
                    } else {
                        json!({ "values": [ { "slug": "komusoffice-cicd" } ] })
                    },
                ));
            }
            Ok(BitbucketResponse::json(
                200,
                if second_page { None } else { Some("1") },
                if second_page {
                    json!({
                        "values": [{
                            "id": 43,
                            "title": "Follow-up",
                            "state": "MERGED",
                            "links": { "self": [{ "href": "https://bitbucket.example.test/projects/KOMUS/repos/komusoffice-cicd/pull-requests/43" }] },
                            "fromRef": { "id": "refs/heads/feature/OPS-143", "displayId": "feature/OPS-143", "latestCommit": "f00dbabe" },
                            "toRef": { "id": "refs/heads/master", "displayId": "master", "latestCommit": "0101010" }
                        }]
                    })
                } else {
                    json!({
                        "values": [{
                            "id": 42,
                            "title": "Fix pipeline gate",
                            "state": "OPEN",
                            "links": { "self": [{ "href": "https://bitbucket.example.test/projects/KOMUS/repos/komusoffice-cicd/pull-requests/42" }] },
                            "fromRef": { "id": "refs/heads/feature/OPS-142-gate", "displayId": "feature/OPS-142-gate", "latestCommit": "deadbeefdeadbeef" },
                            "toRef": { "id": "refs/heads/master", "displayId": "master", "latestCommit": "0101010" }
                        }]
                    })
                },
            ))
        }
    }

    #[test]
    fn basic_auth_is_accepted_and_bearer_token_is_accepted() {
        let basic_auth = BitbucketAuth::Basic {
            username: "operator".into(),
            password: "fixture-password".into(),
        };
        assert_eq!(
            basic_auth.auth_header_value().unwrap(),
            format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode("operator:fixture-password")
            )
        );
        let bearer = BitbucketClient::new(
            "https://bitbucket.example.test",
            BitbucketAuth::BearerToken("http-access-token".into()),
            FakeTransport::default(),
        )
        .unwrap();
        assert_eq!(bearer.base_url, "https://bitbucket.example.test");
    }

    #[test]
    fn empty_credentials_are_refused() {
        assert_eq!(
            BitbucketClient::new(
                "https://bitbucket.example.test",
                BitbucketAuth::Basic {
                    username: String::new(),
                    password: "pw".into(),
                },
                FakeTransport::default(),
            )
            .err(),
            Some(BitbucketError::InvalidCredentials)
        );
        assert_eq!(
            BitbucketClient::new(
                "https://bitbucket.example.test",
                BitbucketAuth::BearerToken(String::new()),
                FakeTransport::default(),
            )
            .err(),
            Some(BitbucketError::InvalidCredentials)
        );
        assert_eq!(
            BitbucketClient::new(
                "http://insecure.example.test",
                BitbucketAuth::BearerToken("t".into()),
                FakeTransport::default(),
            )
            .err(),
            Some(BitbucketError::InvalidBaseUrl)
        );
    }

    #[test]
    fn lists_pull_requests_across_pages_and_normalizes_them() {
        let transport = FakeTransport::default();
        let client = BitbucketClient::new(
            "https://bitbucket.example.test/",
            BitbucketAuth::Basic {
                username: "operator".into(),
                password: "fixture-password".into(),
            },
            &transport,
        )
        .unwrap();

        let pull_requests = client
            .list_pull_requests("KOMUS", "komusoffice-cicd")
            .expect("Bitbucket answered both pages");

        assert_eq!(pull_requests.len(), 2);
        assert_eq!(
            normalize_pull_request("KOMUS", "komusoffice-cicd", &pull_requests[0]),
            Entity {
                id: "bitbucket:pr:KOMUS/komusoffice-cicd:42".into(),
                kind: EntityKind::PullRequest,
                source: Source::Bitbucket,
                title: "Fix pipeline gate".into(),
                url: Some(
                    "https://bitbucket.example.test/projects/KOMUS/repos/komusoffice-cicd/pull-requests/42"
                        .into(),
                ),
                attributes: json!({
                    "projectKey": "KOMUS",
                    "repositorySlug": "komusoffice-cicd",
                    "pullRequestId": 42,
                    "state": "OPEN",
                    "fromBranch": "feature/OPS-142-gate",
                    "toBranch": "master",
                    "sha": "deadbeefdeadbeef",
                }),
            }
        );
        let requests = transport.requests.borrow();
        assert_eq!(requests.len(), 2);
        assert_eq!(
            requests[0].headers.get("Authorization"),
            Some(&format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode("operator:fixture-password")
            ))
        );
        assert!(requests[0].url.ends_with(
            "/rest/api/1.0/projects/KOMUS/repos/komusoffice-cicd/pull-requests?state=ALL&limit=100&start=0"
        ));
        assert!(requests[1].url.ends_with("start=1"));
    }

    #[test]
    fn lists_commits_and_normalizes_them() {
        struct CommitTransport;

        impl BitbucketTransport for CommitTransport {
            fn get(&self, request: BitbucketRequest) -> Result<BitbucketResponse, BitbucketError> {
                assert!(request.url.ends_with(
                    "/rest/api/1.0/projects/KOMUS/repos/komusoffice-cicd/commits?limit=100&start=0"
                ));
                Ok(BitbucketResponse::json(
                    200,
                    None,
                    json!({
                        "values": [{
                            "id": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
                            "displayId": "deadbeefdead",
                            "message": "OPS-142 gate the pipeline on smoke tests"
                        }]
                    }),
                ))
            }
        }

        let client = BitbucketClient::new(
            "https://bitbucket.example.test",
            BitbucketAuth::BearerToken("http-access-token".into()),
            CommitTransport,
        )
        .unwrap();
        let commits = client.list_commits("KOMUS", "komusoffice-cicd").unwrap();

        assert_eq!(commits.len(), 1);
        assert_eq!(
            normalize_commit("KOMUS", "komusoffice-cicd", &commits[0]),
            Entity {
                id: "bitbucket:commit:KOMUS/komusoffice-cicd:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
                    .into(),
                kind: EntityKind::Commit,
                source: Source::Bitbucket,
                title: "deadbeefdead".into(),
                url: None,
                attributes: json!({
                    "projectKey": "KOMUS",
                    "repositorySlug": "komusoffice-cicd",
                    "sha": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
                    "message": "OPS-142 gate the pipeline on smoke tests",
                }),
            }
        );
    }

    #[test]
    fn lists_branches_and_normalizes_them() {
        struct BranchTransport;

        impl BitbucketTransport for BranchTransport {
            fn get(&self, request: BitbucketRequest) -> Result<BitbucketResponse, BitbucketError> {
                assert!(request.url.ends_with(
                    "/rest/api/1.0/projects/KOMUS/repos/komusoffice-cicd/branches?limit=100&start=0"
                ));
                Ok(BitbucketResponse::json(
                    200,
                    None,
                    json!({
                        "values": [{
                            "id": "refs/heads/feature/OPS-142-gate",
                            "displayId": "feature/OPS-142-gate",
                            "latestCommit": "deadbeefdeadbeef",
                            "isDefault": false
                        }]
                    }),
                ))
            }
        }

        let client = BitbucketClient::new(
            "https://bitbucket.example.test",
            BitbucketAuth::BearerToken("http-access-token".into()),
            BranchTransport,
        )
        .unwrap();
        let branches = client.list_branches("KOMUS", "komusoffice-cicd").unwrap();

        assert_eq!(branches.len(), 1);
        assert_eq!(
            normalize_branch("KOMUS", "komusoffice-cicd", &branches[0]),
            Entity {
                id: "bitbucket:branch:KOMUS/komusoffice-cicd:feature/OPS-142-gate".into(),
                kind: EntityKind::Branch,
                source: Source::Bitbucket,
                title: "feature/OPS-142-gate".into(),
                url: None,
                attributes: json!({
                    "projectKey": "KOMUS",
                    "repositorySlug": "komusoffice-cicd",
                    "name": "feature/OPS-142-gate",
                    "sha": "deadbeefdeadbeef",
                    "default": false,
                    "ref": "refs/heads/feature/OPS-142-gate",
                }),
            }
        );
    }

    #[test]
    fn lists_repository_slugs_across_pages() {
        let transport = FakeTransport::default();
        let client = BitbucketClient::new(
            "https://bitbucket.example.test",
            BitbucketAuth::BearerToken("http-access-token".into()),
            &transport,
        )
        .unwrap();

        let slugs = client.list_repositories("KOMUS").unwrap();

        assert_eq!(slugs, vec!["komusoffice-cicd", "portal-legacy"]);
        let requests = transport.requests.borrow();
        assert!(requests[0]
            .url
            .ends_with("/rest/api/1.0/projects/KOMUS/repos?limit=100&start=0"));
    }

    #[test]
    fn get_pull_request_diff_bounds_files_and_attaches_patches() {
        struct DiffTransport;

        impl BitbucketTransport for DiffTransport {
            fn get(&self, request: BitbucketRequest) -> Result<BitbucketResponse, BitbucketError> {
                if request.url.contains("/changes") {
                    return Ok(BitbucketResponse::json(
                        200,
                        None,
                        json!({
                            "isLastPage": true,
                            "values": [
                                { "type": "MODIFY", "path": { "toString": "a.txt" } },
                                { "type": "ADD", "path": { "toString": "b.txt" } },
                                { "type": "DELETE", "path": { "toString": "c.txt" } }
                            ]
                        }),
                    ));
                }
                if request.url.contains("/diff") {
                    return Ok(BitbucketResponse::json(
                        200,
                        None,
                        json!({
                            "diffs": [{
                                "destination": { "toString": "a.txt" },
                                "hunks": [{
                                    "sourceLine": 1, "sourceSpan": 1,
                                    "destinationLine": 1, "destinationSpan": 1,
                                    "segments": [
                                        { "type": "REMOVED", "lines": [{ "text": "x" }] },
                                        { "type": "ADDED", "lines": [{ "text": "y" }] }
                                    ]
                                }]
                            }]
                        }),
                    ));
                }
                Err(BitbucketError::UnexpectedStatus(404))
            }
        }

        let client = BitbucketClient::new(
            "https://bitbucket.example.test",
            BitbucketAuth::BearerToken("t".into()),
            DiffTransport,
        )
        .unwrap();
        let out = client
            .get_pull_request_diff("KOMUS", "repo", 42, 2)
            .unwrap();
        assert_eq!(out.files.len(), 2);
        assert!(out.truncated);
        assert_eq!(out.files[0].path, "a.txt");
        assert_eq!(out.files[0].status, "modified");
        assert!(out.files[0]
            .patch
            .as_deref()
            .unwrap()
            .contains("+y"));
        assert_eq!(out.files[1].status, "added");
    }

    #[test]
    fn unexpected_status_is_reported_not_swallowed() {
        struct UnauthorizedTransport;

        impl BitbucketTransport for UnauthorizedTransport {
            fn get(&self, _request: BitbucketRequest) -> Result<BitbucketResponse, BitbucketError> {
                Ok(BitbucketResponse::json(
                    401,
                    None,
                    json!({ "errors": [{ "message": "authentication failed" }] }),
                ))
            }
        }

        let client = BitbucketClient::new(
            "https://bitbucket.example.test",
            BitbucketAuth::BearerToken("http-access-token".into()),
            UnauthorizedTransport,
        )
        .unwrap();
        assert_eq!(
            client.list_pull_requests("KOMUS", "komusoffice-cicd").err(),
            Some(BitbucketError::UnexpectedStatus(401))
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

    impl BitbucketTransport for ScriptedTransport {
        fn get(&self, request: BitbucketRequest) -> Result<BitbucketResponse, BitbucketError> {
            self.urls.lock().unwrap().push(request.url.clone());
            if request.url.contains("/repos?") {
                return Ok(BitbucketResponse::json(
                    200,
                    None,
                    json!({ "values": [{ "slug": "komusoffice-cicd" }] }),
                ));
            }
            if request.url.contains("/pull-requests/") && request.url.contains("/changes") {
                return Ok(BitbucketResponse::json(
                    200,
                    None,
                    json!({
                        "isLastPage": true,
                        "values": [
                            {
                                "type": "MODIFY",
                                "path": { "toString": "src/gate.java" },
                                "srcPath": { "toString": "src/gate.java" }
                            },
                            {
                                "type": "ADD",
                                "path": { "toString": "src/new.java" }
                            }
                        ]
                    }),
                ));
            }
            if request.url.contains("/pull-requests/") && request.url.contains("/diff") {
                return Ok(BitbucketResponse::json(
                    200,
                    None,
                    json!({
                        "diffs": [{
                            "source": { "toString": "src/gate.java" },
                            "destination": { "toString": "src/gate.java" },
                            "hunks": [{
                                "sourceLine": 1,
                                "sourceSpan": 1,
                                "destinationLine": 1,
                                "destinationSpan": 1,
                                "segments": [
                                    { "type": "REMOVED", "lines": [{ "text": "old" }] },
                                    { "type": "ADDED", "lines": [{ "text": "new" }] }
                                ]
                            }]
                        }]
                    }),
                ));
            }
            if request.url.contains("/pull-requests") {
                return Ok(BitbucketResponse::json(
                    200,
                    None,
                    json!({
                        "values": [{
                            "id": 42,
                            "title": "OPS-142 retry worker",
                            "state": "OPEN",
                            "links": { "self": [{ "href": "https://bitbucket.example.test/projects/KOMUS/repos/komusoffice-cicd/pull-requests/42" }] },
                            "fromRef": { "displayId": "feature/OPS-142", "latestCommit": "abc123" },
                            "toRef": { "displayId": "master" }
                        }]
                    }),
                ));
            }
            if request.url.contains("/commits") {
                return Ok(BitbucketResponse::json(
                    200,
                    None,
                    json!({
                        "values": [{
                            "id": "abc123def456",
                            "displayId": "abc123d",
                            "message": "Retry worker"
                        }]
                    }),
                ));
            }
            if request.url.contains("/branches") {
                return Ok(BitbucketResponse::json(
                    200,
                    None,
                    json!({
                        "values": [{
                            "id": "refs/heads/feature/OPS-142",
                            "displayId": "feature/OPS-142",
                            "latestCommit": "abc123def456",
                            "isDefault": false
                        }]
                    }),
                ));
            }
            Ok(BitbucketResponse::json(200, None, json!({ "values": [] })))
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
                            "provider": "bitbucketDc",
                            "baseUrl": "https://bitbucket.example.test",
                            "authMethod": "bearerToken",
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
            &CredentialRef::new("komus", Provider::BitbucketDc),
            Credential {
                username: "svc".into(),
                secret: "must-not-appear".into(),
            },
        );
        Arc::new(store)
    }

    fn registry_with(
        store: Arc<dyn CredentialStore>,
        filters: Vec<&str>,
        transport: Arc<ScriptedTransport>,
    ) -> Registry {
        let mut registry = Registry::new();
        let pr_transport = transport.clone();
        registry.register(list_pull_requests_capability(
            store.clone(),
            settings_capability(filters.clone()),
            Arc::new(move |_tls| {
                Ok(pr_transport.clone() as Arc<dyn BitbucketTransport + Send + Sync>)
            }),
        ));
        let commits_transport = transport.clone();
        registry.register(list_commits_capability(
            store.clone(),
            settings_capability(filters.clone()),
            Arc::new(move |_tls| Ok(commits_transport.clone() as Arc<dyn BitbucketTransport + Send + Sync>)),
        ));
        let branches_transport = transport.clone();
        registry.register(list_branches_capability(
            store.clone(),
            settings_capability(filters.clone()),
            Arc::new(move |_tls| {
                Ok(branches_transport.clone() as Arc<dyn BitbucketTransport + Send + Sync>)
            }),
        ));
        registry.register(get_pull_request_diff_capability(
            store,
            settings_capability(filters),
            Arc::new(move |_tls| Ok(transport.clone() as Arc<dyn BitbucketTransport + Send + Sync>)),
        ));
        registry
    }

    #[tokio::test]
    async fn lists_pull_requests_of_the_profiles_projects_without_echoing_the_token() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let registry = registry_with(store_with_token(), vec!["KOMUS"], transport.clone());

        let out = registry
            .invoke("bitbucket.listPullRequests", json!({}))
            .await
            .expect("the profile resolves");

        assert_eq!(out["projects"], json!(["KOMUS"]));
        assert_eq!(
            out["pullRequests"][0]["id"],
            "bitbucket:pr:KOMUS/komusoffice-cicd:42"
        );
        assert_eq!(out["truncated"], json!(false));
        assert!(!out.to_string().contains("must-not-appear"));
        assert!(transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("/pull-requests")));

        let wrong = registry
            .invoke("bitbucket.listPullRequests", json!({ "project_filters": [] }))
            .await;
        assert!(matches!(wrong, Err(CapabilityError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn soft_caps_repository_fanout_per_project() {
        struct ManyReposTransport {
            urls: std::sync::Mutex<Vec<String>>,
        }

        impl BitbucketTransport for ManyReposTransport {
            fn get(&self, request: BitbucketRequest) -> Result<BitbucketResponse, BitbucketError> {
                self.urls.lock().unwrap().push(request.url.clone());
                if request.url.contains("/repos?") {
                    let values: Vec<_> = (0..(MAX_REPOS_PER_PROJECT + 15))
                        .map(|i| json!({ "slug": format!("repo-{i}") }))
                        .collect();
                    return Ok(BitbucketResponse::json(200, None, json!({ "values": values })));
                }
                if request.url.contains("/pull-requests") {
                    return Ok(BitbucketResponse::json(
                        200,
                        None,
                        json!({
                            "values": [{
                                "id": 1,
                                "title": "cap",
                                "state": "OPEN",
                                "links": { "self": [{ "href": "https://bitbucket.example.test/pr/1" }] },
                                "fromRef": { "displayId": "a", "latestCommit": "abc" },
                                "toRef": { "displayId": "master" }
                            }]
                        }),
                    ));
                }
                Ok(BitbucketResponse::json(200, None, json!({ "values": [] })))
            }
        }

        let transport = Arc::new(ManyReposTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let mut registry = Registry::new();
        let pr_transport = transport.clone();
        registry.register(list_pull_requests_capability(
            store_with_token(),
            settings_capability(vec!["CORP"]),
            Arc::new(move |_tls| {
                Ok(pr_transport.clone() as Arc<dyn BitbucketTransport + Send + Sync>)
            }),
        ));

        let out = registry
            .invoke("bitbucket.listPullRequests", json!({}))
            .await
            .expect("capped fan-out succeeds");

        assert_eq!(out["truncated"], json!(true));
        let pr_urls: Vec<_> = transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .filter(|url| url.contains("/pull-requests"))
            .cloned()
            .collect();
        assert_eq!(pr_urls.len(), MAX_REPOS_PER_PROJECT);
        assert!(!pr_urls.iter().any(|url| url.contains("repo-40")));
    }

    #[tokio::test]
    async fn lists_commits_using_the_callers_camel_case_payload() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let registry = registry_with(store_with_token(), vec!["KOMUS"], transport.clone());

        let commits = registry
            .invoke("bitbucket.listCommits", json!({ "projectFilters": ["KOMUS"] }))
            .await
            .expect("commits are listed");
        assert_eq!(
            commits["entities"][0]["id"],
            "bitbucket:commit:KOMUS/komusoffice-cicd:abc123def456"
        );
        assert!(transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("/commits")));
    }

    #[tokio::test]
    async fn lists_branches_using_the_callers_camel_case_payload() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let registry = registry_with(store_with_token(), vec!["KOMUS"], transport.clone());

        let branches = registry
            .invoke("bitbucket.listBranches", json!({ "projectFilters": ["KOMUS"] }))
            .await
            .expect("branches are listed");
        assert_eq!(
            branches["entities"][0]["id"],
            "bitbucket:branch:KOMUS/komusoffice-cicd:feature/OPS-142"
        );
        assert!(transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("/branches")));
        assert!(registry
            .invoke("bitbucket.listBranches", json!({ "project_filters": [] }))
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
            .invoke("bitbucket.listPullRequests", json!({}))
            .await
            .expect_err("no project is named");

        assert!(error.to_string().contains("refusing to scan everything"));
        assert!(transport.urls.lock().unwrap().is_empty(), "no request is made");
    }

    #[tokio::test]
    async fn pull_request_diff_uses_the_callers_camel_case_payload() {
        let transport = Arc::new(ScriptedTransport {
            urls: std::sync::Mutex::new(vec![]),
        });
        let registry = registry_with(store_with_token(), vec!["KOMUS"], transport.clone());

        let out = registry
            .invoke(
                "bitbucket.getPullRequestDiff",
                json!({
                    "projectKey": "KOMUS",
                    "repositorySlug": "komusoffice-cicd",
                    "pullRequestId": 42,
                    "maxFiles": 10
                }),
            )
            .await
            .expect("pr diff");
        assert_eq!(out["truncated"], false);
        assert_eq!(out["totalFiles"], 2);
        assert_eq!(out["files"][0]["path"], "src/gate.java");
        assert_eq!(out["files"][0]["status"], "modified");
        assert!(out["files"][0]["patch"].as_str().unwrap().contains("+new"));
        assert!(!out.to_string().contains("must-not-appear"));
        assert!(transport
            .urls
            .lock()
            .unwrap()
            .iter()
            .any(|url| url.contains("/pull-requests/42/changes")));

        assert!(registry
            .invoke(
                "bitbucket.getPullRequestDiff",
                json!({
                    "project_key": "KOMUS",
                    "repository_slug": "komusoffice-cicd",
                    "pull_request_id": 42
                }),
            )
            .await
            .is_err());
    }
}
