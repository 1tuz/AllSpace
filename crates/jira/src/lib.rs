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
            json!({ "key": "OPS-142", "projectKey": "OPS", "status": "In Progress" })
        );
    }

    #[test]
    fn get_issue_detail_bounds_links_and_keeps_newest_comments() {
        struct DetailTransport;

        impl JiraTransport for DetailTransport {
            fn send(&self, request: JiraRequest) -> Result<JiraResponse, JiraError> {
                if request.url.ends_with("/rest/auth/1/session") {
                    return Ok(JiraResponse::json(
                        201,
                        json!({ "session": { "name": "JSESSIONID", "value": "session-cookie" } }),
                    ));
                }
                assert_eq!(
                    request.url,
                    "https://jira.example.test/rest/api/2/issue/OPS-142?fields=summary,status,project,assignee,issuelinks,comment"
                );
                let mut links = Vec::new();
                for i in 0..(MAX_ISSUE_LINKS + 3) {
                    links.push(json!({
                        "type": { "name": "Relates", "outward": "relates to", "inward": "relates to" },
                        "outwardIssue": { "key": format!("OPS-{i}"), "fields": { "summary": format!("Linked {i}") } }
                    }));
                }
                let mut comments = Vec::new();
                for i in 0..(MAX_ISSUE_ACTIVITY + 4) {
                    comments.push(json!({
                        "author": { "displayName": format!("Author {i}") },
                        "body": format!("Comment body {i}"),
                        "created": format!("2024-01-{:02}T12:00:00.000+0000", i + 1)
                    }));
                }
                Ok(JiraResponse::json(
                    200,
                    json!({
                        "key": "OPS-142",
                        "fields": {
                            "summary": "Cache invalidation",
                            "status": { "name": "In Progress" },
                            "project": { "key": "OPS" },
                            "assignee": { "displayName": "Ada Operator" },
                            "issuelinks": links,
                            "comment": { "comments": comments }
                        }
                    }),
                ))
            }
        }

        let client = JiraClient::new(
            "https://jira.example.test",
            "operator",
            "fixture-password",
            DetailTransport,
        )
        .unwrap();
        let detail = client.get_issue_detail("OPS-142").unwrap();

        assert_eq!(detail.issue.attributes["assignee"], "Ada Operator");
        assert_eq!(
            detail.issue.url.as_deref(),
            Some("https://jira.example.test/browse/OPS-142")
        );
        assert_eq!(detail.links.len(), MAX_ISSUE_LINKS);
        assert_eq!(detail.activity.len(), MAX_ISSUE_ACTIVITY);
        assert_eq!(detail.activity[0].summary, "Comment body 4");
        assert_eq!(
            detail.activity.last().map(|a| a.summary.as_str()),
            Some("Comment body 13")
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

    #[test]
    fn search_issue_keys_skips_empty_or_slash_keys_instead_of_failing_the_batch() {
        struct PanicIfCalled;

        impl JiraTransport for PanicIfCalled {
            fn send(&self, _request: JiraRequest) -> Result<JiraResponse, JiraError> {
                panic!("malformed-only batches must not hit the transport");
            }
        }

        let client =
            JiraClient::new("https://jira.example.test", "u", "p", PanicIfCalled).unwrap();
        assert_eq!(client.search_issue_keys(&["", "group/project"]).unwrap(), vec![]);
    }

    #[test]
    fn search_recent_issues_uses_bounded_updated_jql() {
        struct RecentTransport;

        impl JiraTransport for RecentTransport {
            fn send(&self, request: JiraRequest) -> Result<JiraResponse, JiraError> {
                if request.url.ends_with("/rest/auth/1/session") {
                    return Ok(JiraResponse::json(
                        201,
                        json!({ "session": { "name": "JSESSIONID", "value": "session-cookie" } }),
                    ));
                }
                assert_eq!(
                    request.url,
                    "https://jira.example.test/rest/api/2/search?jql=updated%20%3E%3D%20-30d%20ORDER%20BY%20updated%20DESC&maxResults=5&fields=summary,status,project,assignee"
                );
                Ok(JiraResponse::json(
                    200,
                    json!({ "issues": [{
                        "key": "OPS-200",
                        "fields": {
                            "summary": "Recent work",
                            "status": { "name": "Open" },
                            "project": { "key": "OPS" }
                        }
                    }] }),
                ))
            }
        }

        let client = JiraClient::new(
            "https://jira.example.test",
            "operator",
            "fixture-password",
            RecentTransport,
        )
        .unwrap();
        let issues = client.search_recent_issues(5).unwrap();
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].key, "OPS-200");
        assert_eq!(normalize_issue(&issues[0]).attributes["key"], "OPS-200");
    }

    #[test]
    fn list_remote_links_keeps_titled_urls_only() {
        struct RemoteTransport;

        impl JiraTransport for RemoteTransport {
            fn send(&self, request: JiraRequest) -> Result<JiraResponse, JiraError> {
                if request.url.ends_with("/rest/auth/1/session") {
                    return Ok(JiraResponse::json(
                        201,
                        json!({ "session": { "name": "JSESSIONID", "value": "c" } }),
                    ));
                }
                assert!(request.url.ends_with("/rest/api/2/issue/OPS-142/remotelink"));
                Ok(JiraResponse::json(
                    200,
                    json!([
                        { "object": { "title": "Runbook", "url": "https://confluence.example/x" } },
                        { "object": { "title": "", "url": "" } },
                        { "object": { "url": "https://wiki.example/y" } }
                    ]),
                ))
            }
        }

        let client = JiraClient::new(
            "https://jira.example.test",
            "operator",
            "fixture-password",
            RemoteTransport,
        )
        .unwrap();
        let links = client.list_remote_links("OPS-142").unwrap();
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].title, "Runbook");
        assert_eq!(links[1].title, "https://wiki.example/y");
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
        Self::with_tls(&srelens_devops_profiles::TlsConfig::default())
    }

    pub fn with_tls(tls: &srelens_devops_profiles::TlsConfig) -> Result<Self, JiraError> {
        let client = srelens_devops_profiles::blocking_client(
            tls,
            JiraError::Transport,
            |builder| builder.redirect(reqwest::redirect::Policy::none()),
        )?;
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

/// Hard caps for selected-issue detail — activity/links must stay bounded.
pub const MAX_ISSUE_LINKS: usize = 20;
pub const MAX_ISSUE_ACTIVITY: usize = 10;
const ISSUE_DETAIL_FIELDS: &str = "summary,status,project,assignee,issuelinks,comment";
const COMMENT_BODY_MAX: usize = 240;

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct JiraIssue {
    pub key: String,
    pub fields: JiraIssueFields,
}
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct JiraIssueFields {
    pub summary: String,
    pub status: JiraNamedValue,
    pub project: JiraProject,
    #[serde(default)]
    pub assignee: Option<JiraUser>,
    #[serde(default)]
    pub issuelinks: Vec<JiraRawIssueLink>,
    #[serde(default)]
    pub comment: Option<JiraCommentBlock>,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JiraNamedValue {
    pub name: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JiraProject {
    pub key: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JiraUser {
    #[serde(default, rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct JiraCommentBlock {
    #[serde(default)]
    pub comments: Vec<JiraComment>,
}
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct JiraComment {
    #[serde(default)]
    pub author: Option<JiraUser>,
    #[serde(default)]
    pub body: Value,
    #[serde(default)]
    pub created: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JiraRawIssueLink {
    #[serde(rename = "type")]
    pub link_type: JiraLinkType,
    #[serde(default, rename = "outwardIssue")]
    pub outward_issue: Option<JiraLinkedIssue>,
    #[serde(default, rename = "inwardIssue")]
    pub inward_issue: Option<JiraLinkedIssue>,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JiraLinkType {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub outward: Option<String>,
    #[serde(default)]
    pub inward: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JiraLinkedIssue {
    pub key: String,
    #[serde(default)]
    pub fields: Option<JiraLinkedIssueFields>,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct JiraLinkedIssueFields {
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssueLink {
    pub relation: String,
    pub issue_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssueActivity {
    pub kind: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IssueDetail {
    pub issue: Entity,
    pub links: Vec<JiraIssueLink>,
    pub activity: Vec<JiraIssueActivity>,
}

pub fn normalize_issue(issue: &JiraIssue) -> Entity {
    normalize_issue_with_url(issue, None)
}

fn normalize_issue_with_url(issue: &JiraIssue, browse_url: Option<String>) -> Entity {
    let mut attributes = json!({
        "key": issue.key,
        "projectKey": issue.fields.project.key,
        "status": issue.fields.status.name,
    });
    if let Some(assignee) = issue.fields.assignee.as_ref().and_then(user_label) {
        attributes["assignee"] = json!(assignee);
    }
    Entity {
        id: format!("jira:issue:{}", issue.key),
        kind: EntityKind::Issue,
        source: Source::Jira,
        title: issue.fields.summary.clone(),
        url: browse_url,
        attributes,
    }
}

fn user_label(user: &JiraUser) -> Option<String> {
    user.display_name
        .as_ref()
        .filter(|name| !name.is_empty())
        .cloned()
        .or_else(|| user.name.as_ref().filter(|name| !name.is_empty()).cloned())
}

fn comment_body_text(body: &Value) -> String {
    match body {
        Value::String(text) => truncate_chars(text, COMMENT_BODY_MAX),
        Value::Null => String::new(),
        other => {
            // Jira Cloud / some DC plugins return Atlassian Document Format.
            let flat = other.to_string();
            if flat.len() <= 2 {
                String::new()
            } else {
                truncate_chars("Rich-text comment", COMMENT_BODY_MAX)
            }
        }
    }
}

fn truncate_chars(text: &str, max: usize) -> String {
    let mut out = String::new();
    for (idx, ch) in text.chars().enumerate() {
        if idx >= max {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn bound_links(raw: &[JiraRawIssueLink]) -> Vec<JiraIssueLink> {
    raw.iter()
        .filter_map(|link| {
            if let Some(outward) = &link.outward_issue {
                Some(JiraIssueLink {
                    relation: link
                        .link_type
                        .outward
                        .clone()
                        .or_else(|| link.link_type.name.clone())
                        .unwrap_or_else(|| "links to".into()),
                    issue_key: outward.key.clone(),
                    summary: outward
                        .fields
                        .as_ref()
                        .and_then(|fields| fields.summary.clone()),
                })
            } else if let Some(inward) = &link.inward_issue {
                Some(JiraIssueLink {
                    relation: link
                        .link_type
                        .inward
                        .clone()
                        .or_else(|| link.link_type.name.clone())
                        .unwrap_or_else(|| "linked from".into()),
                    issue_key: inward.key.clone(),
                    summary: inward
                        .fields
                        .as_ref()
                        .and_then(|fields| fields.summary.clone()),
                })
            } else {
                None
            }
        })
        .take(MAX_ISSUE_LINKS)
        .collect()
}

fn bound_activity(block: Option<&JiraCommentBlock>) -> Vec<JiraIssueActivity> {
    let mut comments = block
        .map(|block| block.comments.as_slice())
        .unwrap_or(&[])
        .iter()
        .map(|comment| JiraIssueActivity {
            kind: "comment".into(),
            summary: comment_body_text(&comment.body),
            author: comment.author.as_ref().and_then(user_label),
            at: comment.created.clone(),
        })
        .filter(|item| !item.summary.is_empty())
        .collect::<Vec<_>>();
    // Jira returns comments oldest-first; keep the newest N.
    if comments.len() > MAX_ISSUE_ACTIVITY {
        comments = comments.split_off(comments.len() - MAX_ISSUE_ACTIVITY);
    }
    comments
}

pub fn issue_detail_from(issue: &JiraIssue, base_url: &str) -> IssueDetail {
    let browse = format!("{}/browse/{}", base_url.trim_end_matches('/'), issue.key);
    IssueDetail {
        issue: normalize_issue_with_url(issue, Some(browse)),
        links: bound_links(&issue.fields.issuelinks),
        activity: bound_activity(issue.fields.comment.as_ref()),
    }
}

/// Attach remote-link URLs onto the issue entity for Knowledge (linked docs only).
pub fn attach_remote_links(mut detail: IssueDetail, links: &[JiraRemoteLink]) -> IssueDetail {
    if links.is_empty() {
        return detail;
    }
    detail.issue.attributes["remoteLinks"] = json!(links);
    detail
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct JiraRemoteLink {
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct JiraRawRemoteLink {
    #[serde(default)]
    object: JiraRemoteLinkObject,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
struct JiraRemoteLinkObject {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    url: Option<String>,
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

    /// Issue summary + assignee + bounded links/comments for selected-unit detail.
    pub fn get_issue_detail(&self, key: &str) -> Result<IssueDetail, JiraError> {
        if key.is_empty() || key.contains('/') {
            return Err(JiraError::InvalidIssueKey);
        }
        let cookie = self.session_cookie()?;
        let issue = self.transport.send(JiraRequest {
            method: "GET".into(),
            url: format!(
                "{}/rest/api/2/issue/{key}?fields={ISSUE_DETAIL_FIELDS}",
                self.base_url
            ),
            headers: BTreeMap::from([("Cookie".into(), cookie)]),
            body: None,
        })?;
        if !(200..300).contains(&issue.status) {
            return Err(JiraError::UnexpectedStatus(issue.status));
        }
        let parsed: JiraIssue = serde_json::from_value(issue.body)
            .map_err(|e| JiraError::InvalidResponse(e.to_string()))?;
        Ok(issue_detail_from(&parsed, &self.base_url))
    }

    pub fn search_issue_keys(&self, keys: &[&str]) -> Result<Vec<JiraIssue>, JiraError> {
        let keys: Vec<&str> = keys
            .iter()
            .copied()
            .filter(|key| !key.is_empty() && !key.contains('/'))
            .collect();
        if keys.is_empty() {
            return Ok(vec![]);
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

    /// Bounded recent-issue list for Delivery seeding when no change-derived
    /// keys exist. JQL stays fixed — callers pass only a hard cap.
    pub fn search_recent_issues(&self, max: usize) -> Result<Vec<JiraIssue>, JiraError> {
        let max = max.clamp(1, 50);
        let jql = "updated%20%3E%3D%20-30d%20ORDER%20BY%20updated%20DESC";
        let search = self.transport.send(JiraRequest {
            method: "GET".into(),
            url: format!(
                "{}/rest/api/2/search?jql={jql}&maxResults={max}&fields=summary,status,project,assignee",
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

    /// Remote / application links on an issue (Confluence pages, etc.). Failures
    /// stay failures for the caller — empty means Jira returned none.
    pub fn list_remote_links(&self, key: &str) -> Result<Vec<JiraRemoteLink>, JiraError> {
        if key.is_empty() || key.contains('/') {
            return Err(JiraError::InvalidIssueKey);
        }
        let cookie = self.session_cookie()?;
        let response = self.transport.send(JiraRequest {
            method: "GET".into(),
            url: format!("{}/rest/api/2/issue/{key}/remotelink", self.base_url),
            headers: BTreeMap::from([("Cookie".into(), cookie)]),
            body: None,
        })?;
        if !(200..300).contains(&response.status) {
            return Err(JiraError::UnexpectedStatus(response.status));
        }
        let raw: Vec<JiraRawRemoteLink> = serde_json::from_value(response.body)
            .map_err(|e| JiraError::InvalidResponse(e.to_string()))?;
        Ok(raw
            .into_iter()
            .filter_map(|link| {
                let url = link.object.url.filter(|u| !u.is_empty())?;
                let title = link
                    .object
                    .title
                    .filter(|t| !t.is_empty())
                    .unwrap_or_else(|| url.clone());
                Some(JiraRemoteLink { title, url })
            })
            .take(MAX_ISSUE_LINKS)
            .collect())
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
    /// Explicit issue keys to resolve. Empty + [`Self::limit`] seeds recent issues.
    #[serde(default)]
    pub issue_keys: Vec<String>,
    /// When `issueKeys` is empty, fetch up to this many recently updated issues
    /// for Delivery list seeding. Omitted / keys present → no recent fan-out.
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchIssuesOut {
    pub issues: Vec<Entity>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetIssueIn {
    pub issue_key: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetIssueOut {
    pub issue: Entity,
    pub links: Vec<JiraIssueLink>,
    pub activity: Vec<JiraIssueActivity>,
}

/// `jira.searchIssues` — read issues by key, or (empty keys + `limit`) recent
/// updated issues for Delivery list seeding through the active DevOps profile.
///
/// Public configuration is read fresh from durable settings and the credential
/// from the store, so switching profile can never reuse another contour's
/// connection. A profile that is unselected, unconfigured, or missing a
/// credential fails with that reason — it is never rendered as "no issues".
pub fn search_issues_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn JiraTransport>, JiraError> + Send + Sync>,
) -> Capability {
    Capability::typed::<SearchIssuesIn, SearchIssuesOut, _, _>(
        "jira.searchIssues",
        "search Jira Data Center issues by key (or recent updates when limit is set) through the active DevOps profile",
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
                let recent_limit = input.limit;
                let tls = connection.tls.clone();

                // The client is blocking; the request itself runs off the async
                // worker, the way the rest of the registry treats blocking I/O.
                let issues = tokio::task::spawn_blocking(move || {
                    let transport = transport(tls).map_err(|error| error.to_string())?;
                    let client = JiraClient::new(
                        &connection.base_url,
                        &connection.credential.username,
                        &connection.credential.secret,
                        transport,
                    )
                    .map_err(|error| error.to_string())?;
                    if !keys.is_empty() {
                        let keys = keys.iter().map(String::as_str).collect::<Vec<_>>();
                        return client
                            .search_issue_keys(&keys)
                            .map_err(|error| error.to_string());
                    }
                    if let Some(limit) = recent_limit {
                        return client
                            .search_recent_issues(limit as usize)
                            .map_err(|error| error.to_string());
                    }
                    Ok(vec![])
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

/// `jira.getIssue` — selected-issue detail: summary, status, assignee, links, recent comments.
///
/// Links and comments are hard-capped (`MAX_ISSUE_LINKS` / `MAX_ISSUE_ACTIVITY`).
/// Failures stay failures — never an empty detail pretending the issue is gone.
pub fn get_issue_capability(
    store: Arc<dyn CredentialStore>,
    settings_get: Capability,
    transport: Arc<dyn Fn(srelens_devops_profiles::TlsConfig) -> Result<Arc<dyn JiraTransport>, JiraError> + Send + Sync>,
) -> Capability {
    Capability::typed::<GetIssueIn, GetIssueOut, _, _>(
        "jira.getIssue",
        "read one Jira Data Center issue with bounded links and recent comments",
        Annotations::READ_ONLY,
        move |input| {
            let store = store.clone();
            let settings = settings_get.clone();
            let transport = transport.clone();
            async move {
                let connection = active_connection(&settings, store.as_ref(), Provider::Jira)
                    .await
                    .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let key = input.issue_key.clone();
                let tls = connection.tls.clone();

                let detail = tokio::task::spawn_blocking(move || {
                    let transport = transport(tls).map_err(|error| error.to_string())?;
                    let client = JiraClient::new(
                        &connection.base_url,
                        &connection.credential.username,
                        &connection.credential.secret,
                        transport,
                    )
                    .map_err(|error| error.to_string())?;
                    client
                        .get_issue_detail(&key)
                        .map_err(|error| error.to_string())
                        .and_then(|detail| {
                            // Remote links are best-effort Knowledge attrs — a
                            // remotes failure must not hide the issue itself.
                            match client.list_remote_links(&key) {
                                Ok(links) => Ok(attach_remote_links(detail, &links)),
                                Err(_) => Ok(detail),
                            }
                        })
                })
                .await
                .map_err(|error| {
                    CapabilityError::Handler(format!("the Jira request task failed: {error}"))
                })?
                .map_err(CapabilityError::Handler)?;

                Ok(GetIssueOut {
                    issue: detail.issue,
                    links: detail.links,
                    activity: detail.activity,
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
            if request.url.contains("/remotelink") {
                return Ok(JiraResponse::json(
                    200,
                    json!([{
                        "object": {
                            "title": "Ops runbook",
                            "url": "https://confluence.example/pages/ops-runbook"
                        }
                    }]),
                ));
            }
            if request.url.contains("/rest/api/2/issue/") {
                return Ok(JiraResponse::json(
                    200,
                    json!({
                        "key": "OPS-142",
                        "fields": {
                            "summary": "Cache invalidation",
                            "status": { "name": "In Progress" },
                            "project": { "key": "OPS" },
                            "assignee": { "displayName": "Ada Operator" },
                            "issuelinks": [{
                                "type": { "name": "Blocks", "outward": "blocks", "inward": "is blocked by" },
                                "outwardIssue": { "key": "OPS-140", "fields": { "summary": "Prior fix" } }
                            }],
                            "comment": { "comments": [{
                                "author": { "displayName": "Ada Operator" },
                                "body": "Restart the worker on failure",
                                "created": "2024-06-01T10:00:00.000+0000"
                            }] }
                        }
                    }),
                ));
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
            store.clone(),
            settings_capability(),
            Arc::new({
                let transport = transport.clone();
                move |_tls| Ok(transport.clone() as Arc<dyn JiraTransport>)
            }),
        ));
        registry.register(get_issue_capability(
            store,
            settings_capability(),
            Arc::new(move |_tls| Ok(transport.clone() as Arc<dyn JiraTransport>)),
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

    #[tokio::test]
    async fn get_issue_uses_wrapper_spelling_and_returns_bounded_detail() {
        let registry = registry_with(store_with_credential(), ScriptedTransport::answering(200));

        let out = registry
            .invoke("jira.getIssue", json!({ "issueKey": "OPS-142" }))
            .await
            .expect("fixture profile resolves");

        assert_eq!(out["issue"]["id"], "jira:issue:OPS-142");
        assert_eq!(out["issue"]["attributes"]["assignee"], "Ada Operator");
        assert_eq!(out["issue"]["attributes"]["key"], "OPS-142");
        assert_eq!(
            out["issue"]["attributes"]["remoteLinks"][0]["url"],
            "https://confluence.example/pages/ops-runbook"
        );
        assert_eq!(out["links"][0]["issueKey"], "OPS-140");
        assert_eq!(out["links"][0]["relation"], "blocks");
        assert_eq!(out["activity"][0]["kind"], "comment");
        assert_eq!(out["activity"][0]["summary"], "Restart the worker on failure");
        assert!(!out.to_string().contains("must-not-appear"));

        let wrong = registry
            .invoke("jira.getIssue", json!({ "issue_key": "OPS-142" }))
            .await;
        assert!(matches!(wrong, Err(CapabilityError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn get_issue_without_credential_names_that_reason() {
        let registry = registry_with(
            Arc::new(SessionCredentials::new()),
            ScriptedTransport::answering(200),
        );

        let error = registry
            .invoke("jira.getIssue", json!({ "issueKey": "OPS-142" }))
            .await
            .expect_err("no credential is stored");

        assert!(error
            .to_string()
            .contains("no credential is stored for appfarm/jira"));
    }
}
