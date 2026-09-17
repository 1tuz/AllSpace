#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn creates_session_then_fetches_and_normalizes_an_issue() {
        struct FakeTransport;

        impl JiraTransport for FakeTransport {
            fn send(&self, request: JiraRequest) -> Result<JiraResponse, JiraError> {
                match request.url.as_str() {
                    "https://jira.example.test/rest/auth/1/session" => {
                        assert_eq!(request.method, "POST");
                        assert_eq!(
                            request.body,
                            Some(json!({ "username": "operator", "password": "fixture-password" }))
                        );
                        Ok(JiraResponse::json(
                            201,
                            json!({ "session": { "name": "JSESSIONID", "value": "session-cookie" } }),
                        ))
                    }
                    "https://jira.example.test/rest/api/2/issue/OPS-142" => {
                        assert_eq!(
                            request.headers.get("Cookie"),
                            Some(&"JSESSIONID=session-cookie".into())
                        );
                        Ok(JiraResponse::json(
                            200,
                            json!({
                                "key": "OPS-142",
                                "fields": {
                                    "summary": "Cache invalidation",
                                    "status": { "name": "In Progress" },
                                    "project": { "key": "OPS" }
                                }
                            }),
                        ))
                    }
                    url => panic!("unexpected Jira URL: {url}"),
                }
            }
        }

        let client = JiraClient::new(
            "https://jira.example.test",
            "operator",
            "fixture-password",
            FakeTransport,
        )
        .unwrap();
        let issue = client.get_issue("OPS-142").unwrap();

        assert_eq!(issue.key, "OPS-142");
        assert_eq!(normalize_issue(&issue).id, "jira:issue:OPS-142");
        assert_eq!(
            normalize_issue(&issue).attributes,
            json!({ "projectKey": "OPS", "status": "In Progress" })
        );
    }

    #[test]
    fn searches_issues_by_jql_with_a_fresh_session() {
        struct SearchTransport;

        impl JiraTransport for SearchTransport {
            fn send(&self, request: JiraRequest) -> Result<JiraResponse, JiraError> {
                if request.url.ends_with("/rest/auth/1/session") {
                    return Ok(JiraResponse::json(
                        201,
                        json!({ "session": { "name": "JSESSIONID", "value": "session-cookie" } }),
                    ));
                }
                assert_eq!(
                    request.url,
                    "https://jira.example.test/rest/api/2/search?jql=key%20in%20(OPS-142%2C%20OPS-143)&fields=summary,status,project"
                );
                assert_eq!(
                    request.headers.get("Cookie"),
                    Some(&"JSESSIONID=session-cookie".into())
                );
                Ok(JiraResponse::json(
                    200,
                    json!({ "issues": [{
                    "key": "OPS-142",
                    "fields": { "summary": "Cache invalidation", "status": { "name": "In Progress" }, "project": { "key": "OPS" } }
                }] }),
                ))
            }
        }

        let client = JiraClient::new(
            "https://jira.example.test",
            "operator",
            "fixture-password",
            SearchTransport,
        )
        .unwrap();
        let issues = client.search_issue_keys(&["OPS-142", "OPS-143"]).unwrap();

        assert_eq!(
            issues
                .iter()
                .map(|issue| issue.key.as_str())
                .collect::<Vec<_>>(),
            vec!["OPS-142"]
        );
    }
}
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use srelens_capability::{Annotations, Capability, CapabilityError};
use srelens_devops_model::{Entity, EntityKind, Source};
use srelens_devops_profiles::{active_connection, CredentialStore, Provider};
use std::sync::Arc;
use std::{collections::BTreeMap, time::Duration};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JiraRequest {
    pub method: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: Option<Value>,
}
#[derive(Debug, Clone)]
pub struct JiraResponse {
    pub status: u16,
    pub body: Value,
}
impl JiraResponse {
    pub fn json(status: u16, body: Value) -> Self {
        Self { status, body }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JiraError {
    InvalidBaseUrl,
    InvalidIssueKey,
    Transport(String),
    UnexpectedStatus(u16),
    InvalidResponse(String),
}
pub trait JiraTransport: Send + Sync {
    fn send(&self, request: JiraRequest) -> Result<JiraResponse, JiraError>;
}

/// An `Arc` is a transport too, so a capability can share one across calls.
impl<T: JiraTransport + ?Sized> JiraTransport for Arc<T> {
    fn send(&self, request: JiraRequest) -> Result<JiraResponse, JiraError> {
        (**self).send(request)
    }
}

pub struct ReqwestJiraTransport {
    client: reqwest::blocking::Client,
}
impl ReqwestJiraTransport {
    pub fn new() -> Result<Self, JiraError> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        // Corporate Jira (AppFarm/Komus) serves private-CA TLS. Sibling tools use
        // requests verify=False; without this, rustls fails before auth.
        let client = reqwest::blocking::Client::builder()
            .danger_accept_invalid_certs(true)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| JiraError::Transport(e.to_string()))?;
        Ok(Self { client })
    }
}
impl JiraTransport for ReqwestJiraTransport {
    fn send(&self, request: JiraRequest) -> Result<JiraResponse, JiraError> {
        let mut builder = match request.method.as_str() {
            "POST" => self.client.post(&request.url),
            "GET" => self.client.get(&request.url),
            _ => return Err(JiraError::Transport("unsupported Jira method".into())),
        };
        for (name, value) in request.headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = request.body {
            builder = builder.json(&body);
        }
        let response = builder
            .send()
            .map_err(|e| JiraError::Transport(e.to_string()))?;
        let status = response.status().as_u16();
        let body = response
            .json()
            .map_err(|e| JiraError::InvalidResponse(e.to_string()))?;
        Ok(JiraResponse { status, body })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JiraIssue {
    pub key: String,
    pub fields: JiraIssueFields,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JiraIssueFields {
    pub summary: String,
    pub status: JiraNamedValue,
    pub project: JiraProject,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JiraNamedValue {
    pub name: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JiraProject {
    pub key: String,
}
pub fn normalize_issue(issue: &JiraIssue) -> Entity {
    Entity {
        id: format!("jira:issue:{}", issue.key),
        kind: EntityKind::Issue,
        source: Source::Jira,
        title: issue.fields.summary.clone(),
        url: None,
        attributes: json!({ "projectKey": issue.fields.project.key, "status": issue.fields.status.name }),
    }
}

pub struct JiraClient<T> {
    base_url: String,
    username: String,
    password: String,
    transport: T,
}
impl<T: JiraTransport> JiraClient<T> {
    pub fn new(
        base_url: &str,
        username: &str,
        password: &str,
        transport: T,
    ) -> Result<Self, JiraError> {
        let base_url = base_url.trim_end_matches('/');
        if !base_url.starts_with("https://") || username.is_empty() || password.is_empty() {
            return Err(JiraError::InvalidBaseUrl);
        }
        Ok(Self {
            base_url: base_url.into(),
            username: username.into(),
            password: password.into(),
            transport,
        })
    }
    pub fn get_issue(&self, key: &str) -> Result<JiraIssue, JiraError> {
        if key.is_empty() || key.contains('/') {
            return Err(JiraError::InvalidIssueKey);
        }
        let cookie = self.session_cookie()?;
        let issue = self.transport.send(JiraRequest {
            method: "GET".into(),
            url: format!("{}/rest/api/2/issue/{key}", self.base_url),
            headers: BTreeMap::from([("Cookie".into(), cookie)]),
            body: None,
        })?;
        if !(200..300).contains(&issue.status) {
            return Err(JiraError::UnexpectedStatus(issue.status));
        }
        serde_json::from_value(issue.body).map_err(|e| JiraError::InvalidResponse(e.to_string()))
    }

    pub fn search_issue_keys(&self, keys: &[&str]) -> Result<Vec<JiraIssue>, JiraError> {
        if keys.is_empty() || keys.iter().any(|key| key.is_empty() || key.contains('/')) {
            return Err(JiraError::InvalidIssueKey);
        }
        let jql = format!("key in ({})", keys.join(", "))
            .replace(' ', "%20")
            .replace(',', "%2C");
        let search = self.transport.send(JiraRequest {
            method: "GET".into(),
            url: format!(
                "{}/rest/api/2/search?jql={jql}&fields=summary,status,project",
                self.base_url
            ),
            headers: BTreeMap::from([("Cookie".into(), self.session_cookie()?)]),
            body: None,
        })?;
        if !(200..300).contains(&search.status) {
            return Err(JiraError::UnexpectedStatus(search.status));
        }
        serde_json::from_value(search.body["issues"].clone())
            .map_err(|e| JiraError::InvalidResponse(e.to_string()))
    }

    fn session_cookie(&self) -> Result<String, JiraError> {
        let session = self.transport.send(JiraRequest {
            method: "POST".into(),
            url: format!("{}/rest/auth/1/session", self.base_url),
            headers: BTreeMap::new(),
            body: Some(json!({ "username": self.username, "password": self.password })),
        })?;
        // Jira Data Center answers `201 Created` here; Jira Server 8.x answers
        // `200 OK` with the same body. Accepting only 201 refused every session
        // on a Server deployment.
        if session.status != 200 && session.status != 201 {
            return Err(JiraError::UnexpectedStatus(session.status));
        }
        let name = session.body["session"]["name"]
            .as_str()
            .ok_or_else(|| JiraError::InvalidResponse("missing session cookie name".into()))?;
        let value = session.body["session"]["value"]
            .as_str()
            .ok_or_else(|| JiraError::InvalidResponse("missing session cookie value".into()))?;
        Ok(format!("{name}={value}"))
    }
}

impl std::fmt::Display for JiraError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JiraError::InvalidBaseUrl => write!(f, "the Jira base URL or credential is unusable"),
            JiraError::InvalidIssueKey => write!(f, "an issue key is empty or malformed"),
            JiraError::Transport(reason) => write!(f, "the Jira request failed: {reason}"),
            JiraError::UnexpectedStatus(status) => {
                write!(f, "Jira answered with HTTP {status}")
            }
            JiraError::InvalidResponse(reason) => {
                write!(f, "Jira returned an unexpected payload: {reason}")
            }
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SearchIssuesIn {
    pub issue_keys: Vec<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchIssuesOut {
    pub issues: Vec<Entity>,
}

/// `jira.searchIssues` — read the active profile's Jira Data Center issues by key.
///
/// Public configuration is read fresh from durable settings and the credential
/// from the store, so switching profile can never reuse another contour's
/// connection. A profile that is unselected, unconfigured, or missing a
/// credential fails with that reason — it is never rendered as "no issues".
pub fn search_issues_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<dyn Fn() -> Result<Arc<dyn JiraTransport>, JiraError> + Send + Sync>,
) -> Capability {
    Capability::typed::<SearchIssuesIn, SearchIssuesOut, _, _>(
        "jira.searchIssues",
        "search Jira Data Center issues by key through the active DevOps profile",
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                let connection = active_connection(&settings, store.as_ref(), Provider::Jira)
                    .await
                    .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let keys = input.issue_keys.clone();

                // The client is blocking; the request itself runs off the async
                // worker, the way the rest of the registry treats blocking I/O.
                let issues = tokio::task::spawn_blocking(move || {
                    let transport = transport().map_err(|error| error.to_string())?;
                    let client = JiraClient::new(
                        &connection.base_url,
                        &connection.credential.username,
                        &connection.credential.secret,
                        transport,
                    )
                    .map_err(|error| error.to_string())?;
                    let keys = keys.iter().map(String::as_str).collect::<Vec<_>>();
                    client
                        .search_issue_keys(&keys)
                        .map_err(|error| error.to_string())
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the Jira request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)?;

                Ok(SearchIssuesOut {
                    issues: issues.iter().map(normalize_issue).collect(),
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
        status: u16,
        urls: std::sync::Mutex<Vec<String>>,
    }

    impl ScriptedTransport {
        fn answering(status: u16) -> Arc<Self> {
            Arc::new(Self {
                status,
                urls: std::sync::Mutex::new(vec![]),
            })
        }
    }

    impl JiraTransport for ScriptedTransport {
        fn send(&self, request: JiraRequest) -> Result<JiraResponse, JiraError> {
            self.urls.lock().unwrap().push(request.url.clone());
            if request.url.ends_with("/rest/auth/1/session") {
                return Ok(JiraResponse::json(
                    201,
                    json!({ "session": { "name": "JSESSIONID", "value": "session-value" } }),
                ));
            }
            if self.status != 200 {
                return Ok(JiraResponse::json(self.status, json!({})));
            }
            Ok(JiraResponse::json(
                200,
                json!({ "issues": [{
                    "key": "OPS-142",
                    "fields": {
                        "summary": "Cache invalidation",
                        "status": { "name": "In Progress" },
                        "project": { "key": "OPS" }
                    }
                }] }),
            ))
        }
    }

    fn settings_capability() -> Capability {
        Capability::read_only("settings.get", "", |_| async {
            Ok(json!({ "values": { "devops.profiles": {
                "activeProfileId": "appfarm",
                "profiles": [{
                    "id": "appfarm", "label": "AppFarm", "providers": [{
                        "provider": "jira", "baseUrl": "https://jira.example.test",
                        "authMethod": "session"
                    }]
                }]
            } } }))
        })
    }

    fn registry_with(
        store: Arc<dyn CredentialStore>,
        transport: Arc<ScriptedTransport>,
    ) -> Registry {
        let mut registry = Registry::new();
        registry.register(search_issues_capability(
            store,
            settings_capability(),
            Arc::new(move || Ok(transport.clone() as Arc<dyn JiraTransport>)),
        ));
        registry
    }

    fn store_with_credential() -> Arc<SessionCredentials> {
        let store = SessionCredentials::new();
        store.remember(
            &CredentialRef::new("appfarm", Provider::Jira),
            Credential {
                username: "operator".into(),
                secret: "must-not-appear".into(),
            },
        );
        Arc::new(store)
    }

    #[test]
    fn accepts_the_session_statuses_both_jira_deployments_answer() {
        struct SessionTransport(u16);

        impl JiraTransport for SessionTransport {
            fn send(&self, request: JiraRequest) -> Result<JiraResponse, JiraError> {
                if request.url.ends_with("/rest/auth/1/session") {
                    return Ok(JiraResponse::json(
                        self.0,
                        json!({ "session": { "name": "JSESSIONID", "value": "v" } }),
                    ));
                }
                Ok(JiraResponse::json(200, json!({ "issues": [] })))
            }
        }

        for status in [200u16, 201] {
            let client =
                JiraClient::new("https://jira.example.test", "u", "p", SessionTransport(status))
                    .expect("client builds");
            assert!(
                client.search_issue_keys(&["OPS-142"]).is_ok(),
                "a session created with {status} must be accepted"
            );
        }

        let refused =
            JiraClient::new("https://jira.example.test", "u", "p", SessionTransport(401))
                .expect("client builds");
        assert!(matches!(
            refused.search_issue_keys(&["OPS-142"]),
            Err(JiraError::UnexpectedStatus(401))
        ));
    }

    #[tokio::test]
    async fn the_production_transport_builds_off_the_async_worker() {
        // `reqwest::blocking` cannot be constructed on an async worker; the
        // capability builds it inside `spawn_blocking` for exactly that reason,
        // and this is the check that says so.
        let built = tokio::task::spawn_blocking(|| ReqwestJiraTransport::new().map(|_| ()))
            .await
            .expect("the blocking task itself runs");

        assert!(built.is_ok(), "{built:?}");
    }

    #[tokio::test]
    async fn searches_by_issue_key_with_the_wrapper_spelling_and_never_echoes_the_secret() {
        let registry = registry_with(store_with_credential(), ScriptedTransport::answering(200));

        let out = registry
            .invoke("jira.searchIssues", json!({ "issueKeys": ["OPS-142"] }))
            .await
            .expect("fixture profile resolves");

        assert_eq!(out["issues"][0]["id"], "jira:issue:OPS-142");
        assert!(!out.to_string().contains("must-not-appear"));

        // The Rust spelling is not the contract the wrapper speaks.
        let wrong = registry
            .invoke("jira.searchIssues", json!({ "issue_keys": ["OPS-142"] }))
            .await;
        assert!(matches!(wrong, Err(CapabilityError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn a_profile_without_a_stored_credential_fails_with_that_reason() {
        let registry = registry_with(
            Arc::new(SessionCredentials::new()),
            ScriptedTransport::answering(200),
        );

        let error = registry
            .invoke("jira.searchIssues", json!({ "issueKeys": ["OPS-142"] }))
            .await
            .expect_err("no credential is stored");

        assert!(error
            .to_string()
            .contains("no credential is stored for appfarm/jira"));
    }

    #[tokio::test]
    async fn a_jira_rejection_is_reported_with_its_status_not_as_an_empty_result() {
        let registry = registry_with(store_with_credential(), ScriptedTransport::answering(401));

        let error = registry
            .invoke("jira.searchIssues", json!({ "issueKeys": ["OPS-142"] }))
            .await
            .expect_err("the session was refused");

        assert!(error.to_string().contains("401"));
    }
}
