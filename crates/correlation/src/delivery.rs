use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};
use srelens_capability::{Annotations, Capability};
use srelens_devops_model::{Entity, Source, SourceError, Trace};

use crate::join::{build_image_ref, join_delivery_trace, DeliveryBundles};

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
    pub kube_deployments_by_image: Capability,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TraceDeliveryIn {
    pub issue_key: String,
    /// Runtime fan-out is opt-in: callers must name one kube context rather
    /// than letting a delivery trace guess where it was deployed.
    #[serde(default)]
    pub kube_context: Option<String>,
    #[serde(default)]
    pub namespaces: Vec<String>,
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
            async move { Ok(trace_delivery_live(&sources, &input).await) }
        },
    )
}

async fn trace_delivery_live(sources: &DeliverySourceCaps, input: &TraceDeliveryIn) -> Trace {
    let issue_key = &input.issue_key;
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

    // A Kubernetes call is only made when a caller explicitly scopes it. The
    // join later keeps only workloads actually matched to the issue's artifacts.
    if let Some(context) = input.kube_context.as_deref().filter(|context| !context.trim().is_empty()) {
        let images = bundles
            .builds
            .iter()
            .filter_map(build_image_ref)
            .collect::<Vec<_>>();
        if !images.is_empty() {
            match call_workloads(
                &sources.kube_deployments_by_image,
                json!({ "context": context, "images": images, "namespaces": input.namespaces }),
                context,
            )
            .await
            {
                Ok(workloads) => bundles.workloads.extend(workloads),
                Err(error) => push_unique(&mut bundles.source_errors, error),
            }
        }
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeploymentImageMatch {
    name: String,
    namespace: String,
    ready: String,
    images: Vec<String>,
}

async fn call_workloads(
    capability: &Capability,
    input: Value,
    context: &str,
) -> Result<Vec<Entity>, SourceError> {
    let value = (capability.handler)(input).await.map_err(|error| SourceError {
        source: Source::Kubernetes,
        message: error.to_string(),
    })?;
    let deployments: Vec<DeploymentImageMatch> = serde_json::from_value(
        value.get("deployments").cloned().ok_or_else(|| SourceError {
            source: Source::Kubernetes,
            message: "response missing deployments".into(),
        })?,
    )
    .map_err(|error| SourceError {
        source: Source::Kubernetes,
        message: error.to_string(),
    })?;
    Ok(deployments
        .into_iter()
        .map(|deployment| Entity {
            id: format!("runtime:{context}/{}/{}", deployment.namespace, deployment.name),
            kind: srelens_devops_model::EntityKind::Workload,
            source: Source::Kubernetes,
            title: format!("Deployment {}/{}", deployment.namespace, deployment.name),
            url: None,
            attributes: json!({
                "cluster": context,
                "kind": "Deployment",
                "namespace": deployment.namespace,
                "name": deployment.name,
                "ready": deployment.ready,
                "images": deployment.images,
            }),
        })
        .collect())
}

fn push_unique(errors: &mut Vec<SourceError>, error: SourceError) {
    if !errors
        .iter()
        .any(|existing| existing.source == error.source && existing.message == error.message)
    {
        errors.push(error);
    }
}
