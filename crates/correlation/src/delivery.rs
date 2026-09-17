use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};
use srelens_capability::{Annotations, Capability};
use srelens_devops_model::{Entity, Source, SourceError, Trace};

use crate::join::{join_delivery_trace, DeliveryBundles};

/// Sibling read capabilities the live delivery trace fans out to. Each adapter
/// stays registered on its own; this capability only joins what they return.
#[derive(Clone)]
pub struct DeliverySourceCaps {
    pub jira_search: Capability,
    pub gitlab_mrs: Capability,
    pub gitlab_commits: Capability,
    pub gitlab_pipelines: Capability,
    pub bitbucket_prs: Capability,
    pub bitbucket_commits: Capability,
    pub jenkins_builds: Capability,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TraceDeliveryIn {
    pub issue_key: String,
}

/// `devops.traceDelivery` — live join across configured DevOps sources.
///
/// Failures from one source become `sourceErrors` and `partial: true`; they do
/// not invent provider facts. An empty live answer stays empty — the fixture
/// path remains `devops.traceIssue`.
pub fn trace_delivery_capability(sources: DeliverySourceCaps) -> Capability {
    Capability::typed::<TraceDeliveryIn, Trace, _, _>(
        "devops.traceDelivery",
        "trace a work item across live Jira, GitLab, Bitbucket, and Jenkins sources with evidence",
        Annotations::READ_ONLY,
        move |input| {
            let sources = sources.clone();
            async move { Ok(trace_delivery_live(&sources, &input.issue_key).await) }
        },
    )
}

async fn trace_delivery_live(sources: &DeliverySourceCaps, issue_key: &str) -> Trace {
    let mut bundles = DeliveryBundles::default();

    match call_entities(
        &sources.jira_search,
        json!({ "issueKeys": [issue_key] }),
        Source::Jira,
        "issues",
    )
    .await
    {
        Ok(entities) => bundles.issues.extend(entities),
        Err(error) => bundles.source_errors.push(error),
    }

    match call_entities(
        &sources.gitlab_mrs,
        json!({}),
        Source::Gitlab,
        "mergeRequests",
    )
    .await
    {
        Ok(entities) => bundles.changes.extend(entities),
        Err(error) => push_unique(&mut bundles.source_errors, error),
    }

    match call_entities(&sources.gitlab_commits, json!({}), Source::Gitlab, "entities").await {
        Ok(entities) => bundles.commits.extend(entities),
        Err(error) => push_unique(&mut bundles.source_errors, error),
    }

    match call_entities(
        &sources.gitlab_pipelines,
        json!({}),
        Source::Gitlab,
        "entities",
    )
    .await
    {
        Ok(entities) => bundles.builds.extend(entities),
        Err(error) => push_unique(&mut bundles.source_errors, error),
    }

    match call_entities(
        &sources.bitbucket_prs,
        json!({}),
        Source::Bitbucket,
        "pullRequests",
    )
    .await
    {
        Ok(entities) => bundles.changes.extend(entities),
        Err(error) => push_unique(&mut bundles.source_errors, error),
    }

    match call_entities(
        &sources.bitbucket_commits,
        json!({}),
        Source::Bitbucket,
        "entities",
    )
    .await
    {
        Ok(entities) => bundles.commits.extend(entities),
        Err(error) => push_unique(&mut bundles.source_errors, error),
    }

    match call_entities(&sources.jenkins_builds, json!({}), Source::Jenkins, "builds").await {
        Ok(entities) => bundles.builds.extend(entities),
        Err(error) => push_unique(&mut bundles.source_errors, error),
    }

    join_delivery_trace(issue_key, bundles)
}

// artifacts / workloads stay empty here — no live kube fan-out yet.
// join_delivery_trace still synthesizes Artifact nodes from build image attrs.

async fn call_entities(
    capability: &Capability,
    input: Value,
    source: Source,
    field: &str,
) -> Result<Vec<Entity>, SourceError> {
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

fn push_unique(errors: &mut Vec<SourceError>, error: SourceError) {
    if !errors
        .iter()
        .any(|existing| existing.source == error.source && existing.message == error.message)
    {
        errors.push(error);
    }
}
