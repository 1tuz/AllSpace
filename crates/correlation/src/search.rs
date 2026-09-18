use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use srelens_capability::{Annotations, Capability};
use srelens_devops_model::{DeliveryAnchor, Source, SourceError};

/// Sibling read capabilities used to confirm local suggestions against live
/// providers. Absence of a sibling must not invent hits; unconfigured providers
/// stay silent (configuration, not a failed source).
#[derive(Clone, Default)]
pub struct SearchSourceCaps {
    pub jira_search: Option<Capability>,
    pub gitlab_mrs: Option<Capability>,
    pub gitlab_commits: Option<Capability>,
    pub gitlab_pipelines: Option<Capability>,
    pub bitbucket_prs: Option<Capability>,
    pub bitbucket_commits: Option<Capability>,
    pub jenkins_builds: Option<Capability>,
}

/// Cap how many provider-confirmed anchors one search may add. List siblings
/// are already profile-filtered; this bounds what we keep after matching.
const MAX_PROVIDER_ANCHORS: usize = 25;

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SearchIn {
    pub query: String,
    /// Contour hint. Live siblings resolve the active DevOps profile; callers
    /// that need another contour must select it before search.
    #[serde(default)]
    pub profile_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeliverySearch {
    pub anchors: Vec<DeliveryAnchor>,
    pub partial: bool,
    pub source_errors: Vec<SourceError>,
}

/// Needles extracted from the query that decide which siblings to call.
#[derive(Debug, Default)]
struct SearchNeedles {
    issue_keys: Vec<String>,
    shas: Vec<String>,
    pull_requests: Vec<String>,
    builds: Vec<String>,
}

impl SearchNeedles {
    fn from_query_and_anchors(query: &str, anchors: &[DeliveryAnchor]) -> Self {
        let mut needles = Self::default();
        for anchor in anchors {
            match anchor {
                DeliveryAnchor::Issue { value, .. } => {
                    push_unique_str(&mut needles.issue_keys, value.clone());
                }
                DeliveryAnchor::Commit { value, .. } => {
                    push_unique_str(&mut needles.shas, value.clone());
                }
                DeliveryAnchor::PullRequest { value, .. } => {
                    push_unique_str(&mut needles.pull_requests, value.clone());
                }
                DeliveryAnchor::Build { value, .. } => {
                    push_unique_str(&mut needles.builds, value.clone());
                }
                _ => {}
            }
        }
        // Free-text may carry PR/build tokens that local heuristics already
        // folded into anchors; re-scan tokens only adds nothing new.
        let _ = query;
        needles
    }

    fn wants_changes(&self) -> bool {
        !self.issue_keys.is_empty() || !self.pull_requests.is_empty() || !self.shas.is_empty()
    }

    fn wants_commits(&self) -> bool {
        !self.shas.is_empty() || !self.issue_keys.is_empty()
    }

    fn wants_builds(&self) -> bool {
        !self.builds.is_empty() || !self.shas.is_empty() || !self.issue_keys.is_empty()
    }

    fn wants_git_ci(&self) -> bool {
        self.wants_changes() || self.wants_commits() || self.wants_builds()
    }
}

/// `devops.search` — provider-neutral delivery search seam.
///
/// Local issue-key / SHA / PR / build heuristics always run. Matching needles
/// fan out to injected siblings (`jira.searchIssues`, GitLab/Bitbucket list
/// MRs/PRs/commits, Jenkins/GitLab builds) for confirmation. Failures become
/// `sourceErrors` with the provider `Source`. Answers stay `partial` because
/// list siblings are profile-scoped snapshots, not exhaustive history search.
pub fn search_capability(sources: SearchSourceCaps) -> Capability {
    Capability::typed::<SearchIn, DeliverySearch, _, _>(
        "devops.search",
        "search deliveries by query; local issue-key/SHA/PR/build anchors plus Jira, GitLab, Bitbucket, and Jenkins confirmation when the active profile configures them",
        Annotations::READ_ONLY,
        move |input| {
            let sources = sources.clone();
            async move { Ok(search_deliveries(&sources, &input).await) }
        },
    )
}

pub async fn search_deliveries(sources: &SearchSourceCaps, input: &SearchIn) -> DeliverySearch {
    let _profile = input.profile_id.as_deref();
    let mut anchors = suggest_anchors(&input.query);
    let mut source_errors = Vec::new();
    let mut provider_hits = 0usize;

    let needles = SearchNeedles::from_query_and_anchors(&input.query, &anchors);

    if !needles.issue_keys.is_empty() {
        match &sources.jira_search {
            Some(jira) => match call_jira_issue_keys(jira, &needles.issue_keys).await {
                Ok(confirmed) => {
                    for key in confirmed {
                        if confirm_issue_anchor(&mut anchors, key) {
                            provider_hits = provider_hits.saturating_add(1);
                        }
                    }
                }
                Err(error) => {
                    if !is_unconfigured_provider(&error.message) {
                        push_unique_error(&mut source_errors, error);
                    }
                }
            },
            None => push_unique_error(
                &mut source_errors,
                SourceError {
                    source: Source::Workspace,
                    message: "Jira issue lookup unavailable in this registry; local issue-key suggestions only"
                        .into(),
                },
            ),
        }
    }

    if needles.wants_git_ci() {
        let any_git_ci = sources.gitlab_mrs.is_some()
            || sources.gitlab_commits.is_some()
            || sources.gitlab_pipelines.is_some()
            || sources.bitbucket_prs.is_some()
            || sources.bitbucket_commits.is_some()
            || sources.jenkins_builds.is_some();

        if !any_git_ci {
            push_unique_error(
                &mut source_errors,
                SourceError {
                    source: Source::Workspace,
                    message:
                        "Git and CI search siblings unavailable in this registry; local suggestions only"
                            .into(),
                },
            );
        } else {
            let mut needles = needles;
            if needles.wants_changes() {
                fanout_changes(
                    sources,
                    &mut needles,
                    &mut anchors,
                    &mut source_errors,
                    &mut provider_hits,
                )
                .await;
            }
            if needles.wants_commits() {
                fanout_commits(
                    sources,
                    &needles,
                    &mut anchors,
                    &mut source_errors,
                    &mut provider_hits,
                )
                .await;
            }
            if needles.wants_builds() {
                fanout_builds(
                    sources,
                    &needles,
                    &mut anchors,
                    &mut source_errors,
                    &mut provider_hits,
                )
                .await;
            }
        }
    }

    let _ = provider_hits;

    DeliverySearch {
        anchors,
        // List confirmation is never an exhaustive history search.
        partial: true,
        source_errors,
    }
}

async fn fanout_changes(
    sources: &SearchSourceCaps,
    needles: &mut SearchNeedles,
    anchors: &mut Vec<DeliveryAnchor>,
    source_errors: &mut Vec<SourceError>,
    provider_hits: &mut usize,
) {
    if let Some(cap) = &sources.gitlab_mrs {
        match call_entity_list(cap, json!({}), Source::Gitlab, "mergeRequests").await {
            Ok(entities) => {
                for entity in entities {
                    if *provider_hits >= MAX_PROVIDER_ANCHORS {
                        break;
                    }
                    if change_matches_needles(&entity, needles) {
                        if confirm_pr_anchor(anchors, &entity, "gitlab") {
                            *provider_hits = provider_hits.saturating_add(1);
                            if let Some(sha) = entity_sha(&entity) {
                                push_unique_str(&mut needles.shas, sha.to_ascii_lowercase());
                            }
                        }
                    }
                }
            }
            Err(error) => push_if_configured(source_errors, error),
        }
    }
    if let Some(cap) = &sources.bitbucket_prs {
        match call_entity_list(cap, json!({}), Source::Bitbucket, "pullRequests").await {
            Ok(entities) => {
                for entity in entities {
                    if *provider_hits >= MAX_PROVIDER_ANCHORS {
                        break;
                    }
                    if change_matches_needles(&entity, needles) {
                        if confirm_pr_anchor(anchors, &entity, "bitbucket") {
                            *provider_hits = provider_hits.saturating_add(1);
                            if let Some(sha) = entity_sha(&entity) {
                                push_unique_str(&mut needles.shas, sha.to_ascii_lowercase());
                            }
                        }
                    }
                }
            }
            Err(error) => push_if_configured(source_errors, error),
        }
    }
}

async fn fanout_commits(
    sources: &SearchSourceCaps,
    needles: &SearchNeedles,
    anchors: &mut Vec<DeliveryAnchor>,
    source_errors: &mut Vec<SourceError>,
    provider_hits: &mut usize,
) {
    if let Some(cap) = &sources.gitlab_commits {
        match call_entity_list(cap, json!({}), Source::Gitlab, "entities").await {
            Ok(entities) => {
                for entity in entities {
                    if *provider_hits >= MAX_PROVIDER_ANCHORS {
                        break;
                    }
                    if commit_matches_needles(&entity, needles) {
                        if confirm_commit_anchor(anchors, &entity, "gitlab") {
                            *provider_hits = provider_hits.saturating_add(1);
                        }
                    }
                }
            }
            Err(error) => push_if_configured(source_errors, error),
        }
    }
    if let Some(cap) = &sources.bitbucket_commits {
        match call_entity_list(cap, json!({}), Source::Bitbucket, "entities").await {
            Ok(entities) => {
                for entity in entities {
                    if *provider_hits >= MAX_PROVIDER_ANCHORS {
                        break;
                    }
                    if commit_matches_needles(&entity, needles) {
                        if confirm_commit_anchor(anchors, &entity, "bitbucket") {
                            *provider_hits = provider_hits.saturating_add(1);
                        }
                    }
                }
            }
            Err(error) => push_if_configured(source_errors, error),
        }
    }
}

async fn fanout_builds(
    sources: &SearchSourceCaps,
    needles: &SearchNeedles,
    anchors: &mut Vec<DeliveryAnchor>,
    source_errors: &mut Vec<SourceError>,
    provider_hits: &mut usize,
) {
    if let Some(cap) = &sources.gitlab_pipelines {
        match call_entity_list(cap, json!({}), Source::Gitlab, "entities").await {
            Ok(entities) => {
                for entity in entities {
                    if *provider_hits >= MAX_PROVIDER_ANCHORS {
                        break;
                    }
                    if build_matches_needles(&entity, needles) {
                        if confirm_build_anchor(anchors, &entity, "gitlab") {
                            *provider_hits = provider_hits.saturating_add(1);
                        }
                    }
                }
            }
            Err(error) => push_if_configured(source_errors, error),
        }
    }
    if let Some(cap) = &sources.jenkins_builds {
        match call_entity_list(cap, json!({}), Source::Jenkins, "builds").await {
            Ok(entities) => {
                for entity in entities {
                    if *provider_hits >= MAX_PROVIDER_ANCHORS {
                        break;
                    }
                    if build_matches_needles(&entity, needles) {
                        if confirm_build_anchor(anchors, &entity, "jenkins") {
                            *provider_hits = provider_hits.saturating_add(1);
                        }
                    }
                }
            }
            Err(error) => push_if_configured(source_errors, error),
        }
    }
}

async fn call_jira_issue_keys(
    capability: &Capability,
    keys: &[String],
) -> Result<Vec<String>, SourceError> {
    let value = (capability.handler)(json!({ "issueKeys": keys }))
        .await
        .map_err(|error| SourceError {
            source: Source::Jira,
            message: error.to_string(),
        })?;
    let issues = value.get("issues").cloned().ok_or_else(|| SourceError {
        source: Source::Jira,
        message: "response missing issues".into(),
    })?;
    let issues: Vec<Value> = serde_json::from_value(issues).map_err(|error| SourceError {
        source: Source::Jira,
        message: error.to_string(),
    })?;
    Ok(issues
        .iter()
        .filter_map(issue_key_from_entity_value)
        .collect())
}

async fn call_entity_list(
    capability: &Capability,
    input: Value,
    source: Source,
    field: &str,
) -> Result<Vec<Value>, SourceError> {
    let value = (capability.handler)(input)
        .await
        .map_err(|error| SourceError {
            source: source.clone(),
            message: error.to_string(),
        })?;
    let entities = value.get(field).cloned().ok_or_else(|| SourceError {
        source: source.clone(),
        message: format!("response missing {field}"),
    })?;
    serde_json::from_value(entities).map_err(|error| SourceError {
        source,
        message: error.to_string(),
    })
}

fn issue_key_from_entity_value(entity: &Value) -> Option<String> {
    if let Some(key) = entity
        .pointer("/attributes/key")
        .and_then(|value| value.as_str())
        .filter(|key| !key.is_empty())
    {
        return Some(key.to_ascii_uppercase());
    }
    let id = entity.get("id")?.as_str()?;
    id.strip_prefix("jira:issue:")
        .filter(|key| !key.is_empty())
        .map(|key| key.to_ascii_uppercase())
}

fn change_matches_needles(entity: &Value, needles: &SearchNeedles) -> bool {
    for key in &needles.pull_requests {
        if pr_entity_matches(entity, key) {
            return true;
        }
    }
    for sha in &needles.shas {
        if entity_sha(entity).is_some_and(|have| sha_prefix_match(&have, sha)) {
            return true;
        }
    }
    for issue in &needles.issue_keys {
        if entity_mentions(entity, issue) {
            return true;
        }
    }
    false
}

fn commit_matches_needles(entity: &Value, needles: &SearchNeedles) -> bool {
    for sha in &needles.shas {
        if entity_sha(entity).is_some_and(|have| sha_prefix_match(&have, sha)) {
            return true;
        }
    }
    for issue in &needles.issue_keys {
        if entity_mentions(entity, issue) {
            return true;
        }
    }
    false
}

fn build_matches_needles(entity: &Value, needles: &SearchNeedles) -> bool {
    for build in &needles.builds {
        if build_entity_matches(entity, build) {
            return true;
        }
    }
    for sha in &needles.shas {
        if entity_sha(entity).is_some_and(|have| sha_prefix_match(&have, sha)) {
            return true;
        }
    }
    for issue in &needles.issue_keys {
        if entity_mentions(entity, issue) {
            return true;
        }
    }
    false
}

fn pr_entity_matches(entity: &Value, needle: &str) -> bool {
    let needle = needle.to_ascii_lowercase();
    if id_str(entity)
        .map(|id| id.to_ascii_lowercase().contains(&needle))
        .unwrap_or(false)
    {
        return true;
    }
    if title_str(entity)
        .map(|title| title.to_ascii_lowercase().contains(&needle))
        .unwrap_or(false)
    {
        return true;
    }
    for key in ["iid", "pullRequestId", "number", "id"] {
        if attr_as_string(entity, key)
            .map(|value| value.eq_ignore_ascii_case(&needle))
            .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

fn build_entity_matches(entity: &Value, needle: &str) -> bool {
    let needle_lc = needle.to_ascii_lowercase();
    if id_str(entity)
        .map(|id| id.to_ascii_lowercase().contains(&needle_lc))
        .unwrap_or(false)
    {
        return true;
    }
    if title_str(entity)
        .map(|title| title.to_ascii_lowercase().contains(&needle_lc))
        .unwrap_or(false)
    {
        return true;
    }
    if attr_as_string(entity, "buildNumber")
        .map(|n| n.eq_ignore_ascii_case(needle))
        .unwrap_or(false)
    {
        return true;
    }
    if let Some((job, number)) = needle.rsplit_once('#') {
        let job_ok = attr_as_string(entity, "jobPath")
            .map(|path| {
                path.eq_ignore_ascii_case(job)
                    || path
                        .to_ascii_lowercase()
                        .contains(&job.to_ascii_lowercase())
            })
            .unwrap_or(false)
            || id_str(entity)
                .map(|id| id.to_ascii_lowercase().contains(&job.to_ascii_lowercase()))
                .unwrap_or(false);
        let number_ok = attr_as_string(entity, "buildNumber")
            .map(|n| n.eq_ignore_ascii_case(number))
            .unwrap_or(false);
        return job_ok && number_ok;
    }
    false
}

fn entity_mentions(entity: &Value, mention: &str) -> bool {
    let mention = mention.to_ascii_lowercase();
    if title_str(entity)
        .map(|title| title.to_ascii_lowercase().contains(&mention))
        .unwrap_or(false)
    {
        return true;
    }
    for key in [
        "sourceBranch",
        "fromBranch",
        "branch",
        "key",
        "message",
        "ref",
        "jobPath",
    ] {
        if attr_as_string(entity, key)
            .map(|value| value.to_ascii_lowercase().contains(&mention))
            .unwrap_or(false)
        {
            return true;
        }
    }
    id_str(entity)
        .map(|id| id.to_ascii_lowercase().contains(&mention))
        .unwrap_or(false)
}

fn entity_sha(entity: &Value) -> Option<String> {
    attr_as_string(entity, "sha")
        .or_else(|| attr_as_string(entity, "scmRevision"))
        .filter(|sha| !sha.is_empty())
}

fn sha_prefix_match(left: &str, right: &str) -> bool {
    if left.is_empty() || right.is_empty() {
        return false;
    }
    if left.eq_ignore_ascii_case(right) {
        return true;
    }
    let (longer, shorter) = if left.len() >= right.len() {
        (left, right)
    } else {
        (right, left)
    };
    shorter.len() >= 7
        && longer
            .to_ascii_lowercase()
            .starts_with(&shorter.to_ascii_lowercase())
}

fn confirm_issue_anchor(anchors: &mut Vec<DeliveryAnchor>, key: String) -> bool {
    let key = key.to_ascii_uppercase();
    if let Some(existing) = anchors.iter_mut().find(|anchor| {
        matches!(
            anchor,
            DeliveryAnchor::Issue { value, .. } if value.eq_ignore_ascii_case(&key)
        )
    }) {
        if let DeliveryAnchor::Issue { source, value, .. } = existing {
            *value = key;
            *source = Some("jira".into());
        }
        return true;
    }
    anchors.push(DeliveryAnchor::Issue {
        value: key,
        source: Some("jira".into()),
    });
    true
}

fn confirm_pr_anchor(anchors: &mut Vec<DeliveryAnchor>, entity: &Value, source: &str) -> bool {
    let Some(value) = pr_anchor_value(entity) else {
        return false;
    };
    upsert_anchor(
        anchors,
        DeliveryAnchor::PullRequest {
            value,
            source: Some(source.into()),
        },
    )
}

fn confirm_commit_anchor(anchors: &mut Vec<DeliveryAnchor>, entity: &Value, source: &str) -> bool {
    let Some(sha) = entity_sha(entity) else {
        return false;
    };
    upsert_anchor(
        anchors,
        DeliveryAnchor::Commit {
            value: sha.to_ascii_lowercase(),
            source: Some(source.into()),
        },
    )
}

fn confirm_build_anchor(anchors: &mut Vec<DeliveryAnchor>, entity: &Value, source: &str) -> bool {
    let Some(value) = build_anchor_value(entity) else {
        return false;
    };
    upsert_anchor(
        anchors,
        DeliveryAnchor::Build {
            value,
            source: Some(source.into()),
        },
    )
}

fn pr_anchor_value(entity: &Value) -> Option<String> {
    for key in ["iid", "pullRequestId", "number"] {
        if let Some(value) = attr_as_string(entity, key).filter(|v| !v.is_empty()) {
            return Some(value);
        }
    }
    let id = id_str(entity)?;
    id.rsplit(':')
        .next()
        .map(str::to_owned)
        .filter(|v| !v.is_empty())
}

fn build_anchor_value(entity: &Value) -> Option<String> {
    if let (Some(job), Some(number)) = (
        attr_as_string(entity, "jobPath"),
        attr_as_string(entity, "buildNumber"),
    ) {
        return Some(format!("{job}#{number}"));
    }
    if let Some(number) =
        attr_as_string(entity, "buildNumber").or_else(|| attr_as_string(entity, "id"))
    {
        if let Some(job) = attr_as_string(entity, "jobPath") {
            return Some(format!("{job}#{number}"));
        }
        return Some(number);
    }
    let id = id_str(entity)?;
    // jenkins:job/path:9182 → job/path#9182
    if let Some(rest) = id.strip_prefix("jenkins:") {
        if let Some((job, number)) = rest.rsplit_once(':') {
            return Some(format!("{job}#{number}"));
        }
    }
    id.rsplit(':')
        .next()
        .map(str::to_owned)
        .filter(|v| !v.is_empty())
}

fn upsert_anchor(anchors: &mut Vec<DeliveryAnchor>, anchor: DeliveryAnchor) -> bool {
    let kind = anchor.kind_name();
    let value = anchor.value().to_string();
    if let Some(existing) = anchors.iter_mut().find(|existing| {
        existing.kind_name() == kind && existing.value().eq_ignore_ascii_case(&value)
    }) {
        match (existing, anchor) {
            (
                DeliveryAnchor::PullRequest {
                    source,
                    value: slot,
                    ..
                },
                DeliveryAnchor::PullRequest {
                    source: new_source,
                    value: new_value,
                    ..
                },
            )
            | (
                DeliveryAnchor::Commit {
                    source,
                    value: slot,
                    ..
                },
                DeliveryAnchor::Commit {
                    source: new_source,
                    value: new_value,
                    ..
                },
            )
            | (
                DeliveryAnchor::Build {
                    source,
                    value: slot,
                    ..
                },
                DeliveryAnchor::Build {
                    source: new_source,
                    value: new_value,
                    ..
                },
            ) => {
                *slot = new_value;
                *source = new_source;
            }
            _ => {}
        }
        return true;
    }
    // Prefer prefix-merge for short SHA locals against full provider SHAs.
    if let DeliveryAnchor::Commit {
        value: ref full,
        source: ref new_source,
    } = anchor
    {
        if let Some(existing) = anchors.iter_mut().find(|existing| {
            matches!(
                existing,
                DeliveryAnchor::Commit { value, .. }
                    if sha_prefix_match(value, full)
            )
        }) {
            if let DeliveryAnchor::Commit { value, source } = existing {
                *value = full.clone();
                *source = new_source.clone();
            }
            return true;
        }
    }
    anchors.push(anchor);
    true
}

fn id_str(entity: &Value) -> Option<&str> {
    entity.get("id").and_then(|value| value.as_str())
}

fn title_str(entity: &Value) -> Option<&str> {
    entity.get("title").and_then(|value| value.as_str())
}

fn attr_as_string(entity: &Value, key: &str) -> Option<String> {
    let attrs = entity.get("attributes")?;
    let value = attrs.get(key)?;
    if let Some(text) = value.as_str() {
        return Some(text.to_owned());
    }
    if let Some(number) = value.as_u64() {
        return Some(number.to_string());
    }
    if let Some(number) = value.as_i64() {
        return Some(number.to_string());
    }
    None
}

/// Suggest delivery anchors from issue-key / commit-SHA / PR / build tokens.
pub fn suggest_anchors(query: &str) -> Vec<DeliveryAnchor> {
    let q = query.trim();
    if q.is_empty() {
        return vec![];
    }

    let mut anchors = Vec::new();
    if looks_like_issue(q) {
        push_unique(&mut anchors, DeliveryAnchor::issue(q.to_ascii_uppercase()));
        return anchors;
    }
    if looks_like_sha(q) {
        push_unique(
            &mut anchors,
            DeliveryAnchor::Commit {
                value: q.to_ascii_lowercase(),
                source: None,
            },
        );
        return anchors;
    }
    if let Some(pr) = looks_like_pr(q) {
        push_unique(
            &mut anchors,
            DeliveryAnchor::PullRequest {
                value: pr,
                source: None,
            },
        );
        return anchors;
    }
    if let Some(build) = looks_like_build(q) {
        push_unique(
            &mut anchors,
            DeliveryAnchor::Build {
                value: build,
                source: None,
            },
        );
        return anchors;
    }

    for token in q.split(|c: char| {
        !(c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '#' || c == '!' || c == '/')
    }) {
        if token.is_empty() {
            continue;
        }
        if looks_like_issue(token) {
            push_unique(
                &mut anchors,
                DeliveryAnchor::issue(token.to_ascii_uppercase()),
            );
        } else if looks_like_sha(token) {
            push_unique(
                &mut anchors,
                DeliveryAnchor::Commit {
                    value: token.to_ascii_lowercase(),
                    source: None,
                },
            );
        } else if let Some(pr) = looks_like_pr(token) {
            push_unique(
                &mut anchors,
                DeliveryAnchor::PullRequest {
                    value: pr,
                    source: None,
                },
            );
        } else if let Some(build) = looks_like_build(token) {
            push_unique(
                &mut anchors,
                DeliveryAnchor::Build {
                    value: build,
                    source: None,
                },
            );
        }
    }
    anchors
}

fn looks_like_issue(token: &str) -> bool {
    let bytes = token.as_bytes();
    if bytes.len() < 3 {
        return false;
    }
    let Some(dash) = token.find('-') else {
        return false;
    };
    if dash == 0 || dash + 1 >= token.len() {
        return false;
    }
    let (project, number) = token.split_at(dash);
    let number = &number[1..];
    let mut chars = project.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() {
        return false;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric()) {
        return false;
    }
    !number.is_empty() && number.chars().all(|c| c.is_ascii_digit())
}

fn looks_like_sha(token: &str) -> bool {
    let len = token.len();
    (7..=40).contains(&len) && token.chars().all(|c| c.is_ascii_hexdigit())
}

/// `!42`, `#42`, `pr-42`, `pr/42`, `mr-42`, `MR!42`.
fn looks_like_pr(token: &str) -> Option<String> {
    let lower = token.to_ascii_lowercase();
    let number = if let Some(rest) = lower.strip_prefix('!') {
        rest
    } else if let Some(rest) = lower.strip_prefix('#') {
        rest
    } else if let Some(rest) = lower.strip_prefix("pr-") {
        rest
    } else if let Some(rest) = lower.strip_prefix("pr/") {
        rest
    } else if let Some(rest) = lower.strip_prefix("mr-") {
        rest
    } else if let Some(rest) = lower.strip_prefix("mr!") {
        rest
    } else {
        return None;
    };
    if number.is_empty() || !number.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(number.to_owned())
}

/// `job#9182`, `payments-api/main#9182`, `build#9182`.
fn looks_like_build(token: &str) -> Option<String> {
    let Some((job, number)) = token.rsplit_once('#') else {
        return None;
    };
    if job.is_empty() || number.is_empty() || !number.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    // Bare `#9182` is handled as a PR candidate via looks_like_pr.
    if job.eq_ignore_ascii_case("build") {
        return Some(number.to_owned());
    }
    Some(format!("{job}#{number}"))
}

fn push_unique(anchors: &mut Vec<DeliveryAnchor>, anchor: DeliveryAnchor) {
    let kind = anchor.kind_name();
    let value = anchor.value().to_string();
    if anchors
        .iter()
        .any(|existing| existing.kind_name() == kind && existing.value() == value)
    {
        return;
    }
    anchors.push(anchor);
}

fn push_unique_str(values: &mut Vec<String>, value: String) {
    if values
        .iter()
        .any(|existing| existing.eq_ignore_ascii_case(&value))
    {
        return;
    }
    values.push(value);
}

fn push_unique_error(errors: &mut Vec<SourceError>, error: SourceError) {
    if errors
        .iter()
        .any(|existing| existing.source == error.source && existing.message == error.message)
    {
        return;
    }
    errors.push(error);
}

fn is_unconfigured_provider(message: &str) -> bool {
    message.contains("does not configure the ")
}

fn push_if_configured(errors: &mut Vec<SourceError>, error: SourceError) {
    if !is_unconfigured_provider(&error.message) {
        push_unique_error(errors, error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use srelens_capability::CapabilityError;

    #[test]
    fn search_in_deserializes_caller_camel_case() {
        let input: SearchIn = serde_json::from_value(json!({
            "query": "OPS-142",
            "profileId": "appfarm",
        }))
        .expect("camelCase");
        assert_eq!(input.query, "OPS-142");
        assert_eq!(input.profile_id.as_deref(), Some("appfarm"));
    }

    #[test]
    fn search_in_rejects_snake_case_profile_id() {
        let err = serde_json::from_value::<SearchIn>(json!({
            "query": "OPS-142",
            "profile_id": "appfarm",
        }));
        assert!(err.is_err(), "snake_case must not deserialize");
    }

    #[test]
    fn suggests_issue_and_sha_from_free_text() {
        let anchors = suggest_anchors("see OPS-142 and abcdef1 please");
        assert_eq!(
            anchors,
            vec![
                DeliveryAnchor::issue("OPS-142"),
                DeliveryAnchor::Commit {
                    value: "abcdef1".into(),
                    source: None,
                },
            ]
        );
    }

    #[test]
    fn suggests_pr_and_build_tokens() {
        assert_eq!(
            suggest_anchors("!42"),
            vec![DeliveryAnchor::PullRequest {
                value: "42".into(),
                source: None,
            }]
        );
        assert_eq!(
            suggest_anchors("payments-api#9182"),
            vec![DeliveryAnchor::Build {
                value: "payments-api#9182".into(),
                source: None,
            }]
        );
    }

    #[tokio::test]
    async fn search_deliveries_stays_partial_without_jira_cap() {
        let out = search_deliveries(
            &SearchSourceCaps::default(),
            &SearchIn {
                query: "OPS-142".into(),
                profile_id: None,
            },
        )
        .await;
        assert_eq!(out.anchors, vec![DeliveryAnchor::issue("OPS-142")]);
        assert!(out.partial);
        assert!(out
            .source_errors
            .iter()
            .any(|error| error.source == Source::Workspace
                && error.message.contains("Jira issue lookup unavailable")));
        assert!(out.source_errors.iter().any(|error| error
            .message
            .contains("Git and CI search siblings unavailable")));
        assert!(!out
            .source_errors
            .iter()
            .any(|error| error.source == Source::Jira));
    }

    #[tokio::test]
    async fn empty_query_returns_no_anchors_but_stays_honest() {
        let out = search_deliveries(
            &SearchSourceCaps::default(),
            &SearchIn {
                query: "   ".into(),
                profile_id: Some("appfarm".into()),
            },
        )
        .await;
        assert!(out.anchors.is_empty());
        assert!(out.partial);
        assert!(out.source_errors.is_empty());
    }

    #[tokio::test]
    async fn jira_success_confirms_issue_anchor_source() {
        let jira = Capability::read_only("jira.searchIssues", "", |_| async {
            Ok(json!({
                "issues": [{
                    "id": "jira:issue:OPS-142",
                    "kind": "issue",
                    "source": "jira",
                    "title": "Cache invalidation",
                    "attributes": {}
                }]
            }))
        });
        let out = search_deliveries(
            &SearchSourceCaps {
                jira_search: Some(jira),
                ..SearchSourceCaps::default()
            },
            &SearchIn {
                query: "OPS-142".into(),
                profile_id: None,
            },
        )
        .await;

        assert_eq!(
            out.anchors,
            vec![DeliveryAnchor::Issue {
                value: "OPS-142".into(),
                source: Some("jira".into()),
            }]
        );
        assert!(out.partial);
        assert!(out
            .source_errors
            .iter()
            .all(|error| error.source != Source::Jira));
        assert!(out.source_errors.iter().any(|error| error
            .message
            .contains("Git and CI search siblings unavailable")));
    }

    #[tokio::test]
    async fn jira_failure_records_source_jira_and_keeps_local_anchor() {
        let jira = Capability::read_only("jira.searchIssues", "", |_| async {
            Err(CapabilityError::Handler("request timed out".into()))
        });
        let out = search_deliveries(
            &SearchSourceCaps {
                jira_search: Some(jira),
                ..SearchSourceCaps::default()
            },
            &SearchIn {
                query: "see OPS-142".into(),
                profile_id: None,
            },
        )
        .await;

        assert_eq!(out.anchors, vec![DeliveryAnchor::issue("OPS-142")]);
        assert!(out.partial);
        assert!(out.source_errors.iter().any(
            |error| error.source == Source::Jira && error.message.contains("request timed out")
        ));
    }

    #[tokio::test]
    async fn unconfigured_jira_does_not_fake_jira_source_error() {
        let jira = Capability::read_only("jira.searchIssues", "", |_| async {
            Err(CapabilityError::Handler(
                "profile appfarm does not configure the jira provider".into(),
            ))
        });
        let out = search_deliveries(
            &SearchSourceCaps {
                jira_search: Some(jira),
                ..SearchSourceCaps::default()
            },
            &SearchIn {
                query: "OPS-142".into(),
                profile_id: None,
            },
        )
        .await;

        assert!(!out
            .source_errors
            .iter()
            .any(|error| error.source == Source::Jira));
        assert!(out.partial);
    }

    #[tokio::test]
    async fn sha_only_query_skips_jira_call() {
        let jira = Capability::read_only("jira.searchIssues", "", |_| async {
            panic!("jira must not be called for SHA-only queries");
        });
        let out = search_deliveries(
            &SearchSourceCaps {
                jira_search: Some(jira),
                ..SearchSourceCaps::default()
            },
            &SearchIn {
                query: "abcdef1".into(),
                profile_id: None,
            },
        )
        .await;

        assert_eq!(
            out.anchors,
            vec![DeliveryAnchor::Commit {
                value: "abcdef1".into(),
                source: None,
            }]
        );
        assert!(out.partial);
        assert!(out.source_errors.iter().any(|error| error
            .message
            .contains("Git and CI search siblings unavailable")));
    }

    #[tokio::test]
    async fn komus_without_jira_confirms_bitbucket_and_jenkins_anchors() {
        let jira = Capability::read_only("jira.searchIssues", "", |_| async {
            Err(CapabilityError::Handler(
                "profile komus does not configure the jira provider".into(),
            ))
        });
        let bitbucket_prs = Capability::read_only("bitbucket.listPullRequests", "", |_| async {
            Ok(json!({
                "pullRequests": [{
                    "id": "bitbucket:pr:KOMUS/api:482",
                    "kind": "pullRequest",
                    "source": "bitbucket",
                    "title": "OPS-142 gate",
                    "attributes": {
                        "pullRequestId": 482,
                        "fromBranch": "feature/OPS-142-gate",
                        "sha": "deadbeefdeadbeef"
                    }
                }]
            }))
        });
        let jenkins = Capability::read_only("jenkins.listBuilds", "", |_| async {
            Ok(json!({
                "builds": [{
                    "id": "jenkins:payments-api:9182",
                    "kind": "build",
                    "source": "jenkins",
                    "title": "payments-api #9182",
                    "attributes": {
                        "jobPath": "payments-api",
                        "buildNumber": 9182,
                        "sha": "deadbeefdeadbeef"
                    }
                }]
            }))
        });

        let out = search_deliveries(
            &SearchSourceCaps {
                jira_search: Some(jira),
                bitbucket_prs: Some(bitbucket_prs),
                jenkins_builds: Some(jenkins),
                ..SearchSourceCaps::default()
            },
            &SearchIn {
                query: "OPS-142".into(),
                profile_id: Some("komus".into()),
            },
        )
        .await;

        assert!(out.anchors.iter().any(|anchor| matches!(
            anchor,
            DeliveryAnchor::PullRequest {
                value,
                source: Some(source)
            } if value == "482" && source == "bitbucket"
        )));
        assert!(out.anchors.iter().any(|anchor| matches!(
            anchor,
            DeliveryAnchor::Build {
                value,
                source: Some(source)
            } if value == "payments-api#9182" && source == "jenkins"
        )));
        assert!(!out
            .source_errors
            .iter()
            .any(|error| error.source == Source::Jira));
        assert!(!out
            .source_errors
            .iter()
            .any(|error| error.message.contains("fan-out not implemented")));
        assert!(out.partial);
    }

    #[tokio::test]
    async fn sha_query_confirms_gitlab_commit_without_blanket_deferred_error() {
        let gitlab_commits = Capability::read_only("gitlab.listCommits", "", |_| async {
            Ok(json!({
                "entities": [{
                    "id": "gitlab:commit:7:abcdef1234567890",
                    "kind": "commit",
                    "source": "gitlab",
                    "title": "fix cache",
                    "attributes": { "sha": "abcdef1234567890" }
                }]
            }))
        });
        let out = search_deliveries(
            &SearchSourceCaps {
                gitlab_commits: Some(gitlab_commits),
                ..SearchSourceCaps::default()
            },
            &SearchIn {
                query: "abcdef1".into(),
                profile_id: Some("appfarm".into()),
            },
        )
        .await;

        assert_eq!(
            out.anchors,
            vec![DeliveryAnchor::Commit {
                value: "abcdef1234567890".into(),
                source: Some("gitlab".into()),
            }]
        );
        assert!(!out
            .source_errors
            .iter()
            .any(|error| error.message.contains("fan-out not implemented")));
        assert!(!out
            .source_errors
            .iter()
            .any(|error| error.message.contains("siblings unavailable")));
    }

    #[tokio::test]
    async fn pr_query_confirms_gitlab_mr() {
        let gitlab_mrs = Capability::read_only("gitlab.listMergeRequests", "", |_| async {
            Ok(json!({
                "mergeRequests": [{
                    "id": "gitlab:merge-request:7:42",
                    "kind": "pullRequest",
                    "source": "gitlab",
                    "title": "Cache invalidation",
                    "attributes": { "iid": 42, "sha": "deadbeef" }
                }]
            }))
        });
        let out = search_deliveries(
            &SearchSourceCaps {
                gitlab_mrs: Some(gitlab_mrs),
                ..SearchSourceCaps::default()
            },
            &SearchIn {
                query: "!42".into(),
                profile_id: None,
            },
        )
        .await;

        assert_eq!(
            out.anchors,
            vec![DeliveryAnchor::PullRequest {
                value: "42".into(),
                source: Some("gitlab".into()),
            }]
        );
    }

    #[tokio::test]
    async fn bitbucket_failure_records_source_without_inventing_hit() {
        let bitbucket = Capability::read_only("bitbucket.listPullRequests", "", |_| async {
            Err(CapabilityError::Handler("request timed out".into()))
        });
        let out = search_deliveries(
            &SearchSourceCaps {
                bitbucket_prs: Some(bitbucket),
                ..SearchSourceCaps::default()
            },
            &SearchIn {
                query: "!482".into(),
                profile_id: Some("komus".into()),
            },
        )
        .await;

        assert_eq!(
            out.anchors,
            vec![DeliveryAnchor::PullRequest {
                value: "482".into(),
                source: None,
            }]
        );
        assert!(out
            .source_errors
            .iter()
            .any(|error| error.source == Source::Bitbucket
                && error.message.contains("request timed out")));
    }

    #[tokio::test]
    async fn provider_anchor_cap_bounds_hits() {
        let prs: Vec<Value> = (1..=40)
            .map(|id| {
                json!({
                    "id": format!("bitbucket:pr:KOMUS/api:{id}"),
                    "kind": "pullRequest",
                    "source": "bitbucket",
                    "title": format!("OPS-142 change {id}"),
                    "attributes": { "pullRequestId": id, "fromBranch": "feature/OPS-142" }
                })
            })
            .collect();
        let bitbucket = Capability::read_only("bitbucket.listPullRequests", "", move |_| {
            let prs = prs.clone();
            async move { Ok(json!({ "pullRequests": prs })) }
        });
        let out = search_deliveries(
            &SearchSourceCaps {
                bitbucket_prs: Some(bitbucket),
                ..SearchSourceCaps::default()
            },
            &SearchIn {
                query: "OPS-142".into(),
                profile_id: Some("komus".into()),
            },
        )
        .await;

        let pr_count = out
            .anchors
            .iter()
            .filter(|anchor| matches!(anchor, DeliveryAnchor::PullRequest { .. }))
            .count();
        assert!(pr_count <= MAX_PROVIDER_ANCHORS);
        assert_eq!(pr_count, MAX_PROVIDER_ANCHORS);
    }
}
