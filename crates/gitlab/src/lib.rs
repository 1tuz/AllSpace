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
}

/// An `Arc` is a transport too, so a capability can share one across calls.
impl<T: GitlabTransport + ?Sized> GitlabTransport for Arc<T> {
    fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
        (**self).get(request)
    }
}

impl<T: GitlabTransport + ?Sized> GitlabTransport for &T {
    fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
        (*self).get(request)
    }
}

/// Production GitLab CE REST transport. Redirects are refused: forwarding a
/// private access token to a redirect target would leak the credential.
pub struct ReqwestGitlabTransport {
    client: reqwest::blocking::Client,
}

impl ReqwestGitlabTransport {
    pub fn new() -> Result<Self, GitlabError> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        // Same private-CA posture as crates/jira: AppFarm GitLab CE rejects default
        // rustls trust. Sibling scripts use verify=False.
        let client = reqwest::blocking::Client::builder()
            .danger_accept_invalid_certs(true)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("srelens/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| GitlabError::Transport(error.to_string()))?;
        Ok(Self { client })
    }
}

impl GitlabTransport for ReqwestGitlabTransport {
    fn get(&self, request: GitlabRequest) -> Result<GitlabResponse, GitlabError> {
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
        let body = response
            .text()
            .map_err(|error| GitlabError::Transport(error.to_string()))?;
        let body = serde_json::from_str(&body)
            .map_err(|error| GitlabError::InvalidResponse(error.to_string()))?;
        Ok(GitlabResponse {
            status,
            next_page,
            body,
        })
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
    Entity {
        id: format!("gitlab:pipeline:{project_id}:{}", pipeline.id),
        kind: EntityKind::Build,
        source: Source::Gitlab,
        title: format!("Pipeline #{} ({})", pipeline.id, pipeline.status),
        url: Some(pipeline.web_url.clone()),
        attributes: json!({
            "projectId": project_id,
            "pipelineId": pipeline.id,
            "status": pipeline.status,
            "ref": pipeline.r#ref,
            "sha": pipeline.sha,
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
            .list_projects(&["platform/api".into(), "payments/web".into()])
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
        dyn Fn() -> Result<Arc<dyn GitlabTransport + Send + Sync>, GitlabError> + Send + Sync,
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
                    let transport = transport().map_err(|error| error.to_string())?;
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
}

fn list_project_entities_capability(
    id: &'static str,
    description: &'static str,
    kind: ProjectEntityKind,
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<
        dyn Fn() -> Result<Arc<dyn GitlabTransport + Send + Sync>, GitlabError> + Send + Sync,
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
                    let transport = transport().map_err(|error| error.to_string())?;
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
        dyn Fn() -> Result<Arc<dyn GitlabTransport + Send + Sync>, GitlabError> + Send + Sync,
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
        dyn Fn() -> Result<Arc<dyn GitlabTransport + Send + Sync>, GitlabError> + Send + Sync,
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
            Arc::new(move || Ok(merge_requests_transport.clone() as Arc<dyn GitlabTransport + Send + Sync>)),
        ));
        let commits_transport = transport.clone();
        registry.register(list_commits_capability(
            store.clone(),
            settings_capability(filters.clone()),
            Arc::new(move || Ok(commits_transport.clone() as Arc<dyn GitlabTransport + Send + Sync>)),
        ));
        registry.register(list_pipelines_capability(
            store,
            settings_capability(filters),
            Arc::new(move || Ok(transport.clone() as Arc<dyn GitlabTransport + Send + Sync>)),
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
}
