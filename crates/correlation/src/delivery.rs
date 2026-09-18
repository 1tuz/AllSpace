use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};
use srelens_capability::{Annotations, Capability};
use srelens_devops_model::{DeliveryAnchor, Entity, Source, SourceError, Trace};

use crate::join::{build_image_ref, join_delivery_from_anchor, DeliveryBundles};

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
    /// Preferred: provider-neutral delivery anchor.
    #[serde(default)]
    pub anchor: Option<DeliveryAnchor>,
    /// Legacy alias for `{ kind: "issue", value }`. Prefer `anchor`.
    #[serde(default)]
    pub issue_key: Option<String>,
    /// Runtime fan-out is opt-in: callers must name one kube context rather
    /// than letting a delivery trace guess where it was deployed.
    #[serde(default)]
    pub kube_context: Option<String>,
    #[serde(default)]
    pub namespaces: Vec<String>,
}

impl TraceDeliveryIn {
    /// Resolve the preferred `anchor`, falling back to legacy `issueKey`.
    pub fn resolve_anchor(&self) -> Result<DeliveryAnchor, String> {
        if let Some(anchor) = &self.anchor {
            return Ok(anchor.clone());
        }
        if let Some(key) = self
            .issue_key
            .as_ref()
            .map(|key| key.trim())
            .filter(|key| !key.is_empty())
        {
            return Ok(DeliveryAnchor::issue(key));
        }
        Err("anchor or issueKey is required".into())
    }
}

/// `devops.traceDelivery` — live join across configured DevOps sources.
///
/// Failures from one source become `sourceErrors` and `partial: true`; they do
/// not invent provider facts. An empty live answer stays empty.
pub fn trace_delivery_capability(sources: DeliverySourceCaps) -> Capability {
    Capability::typed::<TraceDeliveryIn, Trace, _, _>(
        "devops.traceDelivery",
        "trace a delivery from a provider-neutral anchor across live Jira, GitLab, Bitbucket, and Jenkins sources with evidence",
        Annotations::READ_ONLY,
        move |input| {
            let sources = sources.clone();
            async move { Ok(trace_delivery_live(&sources, &input).await) }
        },
    )
}

async fn trace_delivery_live(sources: &DeliverySourceCaps, input: &TraceDeliveryIn) -> Trace {
    let anchor = match input.resolve_anchor() {
        Ok(anchor) => anchor,
        Err(message) => {
            return Trace {
                nodes: vec![],
                edges: vec![],
                situations: vec![],
                verdict: None,
                partial: true,
                source_errors: vec![SourceError {
                    source: Source::Workspace,
                    message,
                }],
            };
        }
    };

    let mut bundles = DeliveryBundles::default();

    // Jira is only queried when the delivery begins at an issue. Komus traces
    // that start at a PR/build must not require Jira as the root.
    if let DeliveryAnchor::Issue { value, .. } = &anchor {
        match call_entities(
            &sources.jira_search,
            json!({ "issueKeys": [value] }),
            Source::Jira,
            "issues",
        )
        .await
        {
            Ok(entities) => bundles.issues.extend(entities),
            Err(error) => push_if_configured(&mut bundles.source_errors, error),
        }
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
        Err(error) => push_if_configured(&mut bundles.source_errors, error),
    }

    match call_entities(
        &sources.gitlab_commits,
        json!({}),
        Source::Gitlab,
        "entities",
    )
    .await
    {
        Ok(entities) => bundles.commits.extend(entities),
        Err(error) => push_if_configured(&mut bundles.source_errors, error),
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
        Err(error) => push_if_configured(&mut bundles.source_errors, error),
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
        Err(error) => push_if_configured(&mut bundles.source_errors, error),
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
        Err(error) => push_if_configured(&mut bundles.source_errors, error),
    }

    match call_entities(
        &sources.jenkins_builds,
        json!({}),
        Source::Jenkins,
        "builds",
    )
    .await
    {
        Ok(entities) => bundles.builds.extend(entities),
        Err(error) => push_if_configured(&mut bundles.source_errors, error),
    }

    // A Kubernetes call is only made when a caller explicitly scopes it. The
    // join later keeps only workloads actually matched to the delivery artifacts.
    //
    // Honesty for reverse seeds: artifact reverse matches CI builds already in
    // the fan-out (digest/image attrs). Workload/deployment reverse needs those
    // workloads in `bundles` — today that means either (a) CI builds with image
    // refs so this kube-by-image call can fill them, or (b) a unit-test prefilled
    // bundle. There is no name-only kube lookup yet; a bare workload seed with
    // empty/image-less CI therefore returns `missing_seed_match`, not a silent
    // empty success.
    if let Some(context) = input
        .kube_context
        .as_deref()
        .filter(|context| !context.trim().is_empty())
    {
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

    join_delivery_from_anchor(&anchor, bundles)
}

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
    let value = (capability.handler)(input)
        .await
        .map_err(|error| SourceError {
            source: Source::Kubernetes,
            message: error.to_string(),
        })?;
    let deployments: Vec<DeploymentImageMatch> = serde_json::from_value(
        value
            .get("deployments")
            .cloned()
            .ok_or_else(|| SourceError {
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
            id: format!(
                "runtime:{context}/{}/{}",
                deployment.namespace, deployment.name
            ),
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

/// A profile may deliberately omit any optional provider. Its sibling
/// capability then says so explicitly; that is configuration, not a failed
/// source, and must not label an otherwise complete Jira/GitLab trace partial.
fn push_if_configured(errors: &mut Vec<SourceError>, error: SourceError) {
    if !error.message.contains("does not configure the ") {
        push_unique(errors, error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use srelens_devops_model::EntityKind;

    fn empty_field(field: &'static str) -> Capability {
        Capability::read_only("stub", "", move |_| async move { Ok(json!({ field: [] })) })
    }

    fn stub_sources() -> DeliverySourceCaps {
        DeliverySourceCaps {
            jira_search: empty_field("issues"),
            gitlab_mrs: empty_field("mergeRequests"),
            gitlab_commits: empty_field("entities"),
            gitlab_pipelines: empty_field("entities"),
            bitbucket_prs: empty_field("pullRequests"),
            bitbucket_commits: empty_field("entities"),
            jenkins_builds: empty_field("builds"),
            kube_deployments_by_image: empty_field("deployments"),
        }
    }

    #[test]
    fn unconfigured_optional_provider_does_not_make_a_trace_partial() {
        let mut errors = Vec::new();
        push_if_configured(
            &mut errors,
            SourceError {
                source: Source::Bitbucket,
                message:
                    "handler error: profile appfarm does not configure the bitbucketDc provider"
                        .into(),
            },
        );
        push_if_configured(
            &mut errors,
            SourceError {
                source: Source::Gitlab,
                message: "handler error: request timed out".into(),
            },
        );

        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].source, Source::Gitlab);
    }

    #[test]
    fn resolve_anchor_prefers_anchor_over_legacy_issue_key() {
        let input = TraceDeliveryIn {
            anchor: Some(DeliveryAnchor::PullRequest {
                value: "8821".into(),
                source: None,
            }),
            issue_key: Some("OPS-142".into()),
            kube_context: None,
            namespaces: vec![],
        };
        let anchor = input.resolve_anchor().expect("anchor");
        assert_eq!(anchor.kind_name(), "pullRequest");
        assert_eq!(anchor.value(), "8821");
    }

    #[test]
    fn resolve_anchor_accepts_legacy_issue_key() {
        let input = TraceDeliveryIn {
            anchor: None,
            issue_key: Some("OPS-142".into()),
            kube_context: None,
            namespaces: vec![],
        };
        let anchor = input.resolve_anchor().expect("anchor");
        assert_eq!(anchor, DeliveryAnchor::issue("OPS-142"));
    }

    #[tokio::test]
    async fn live_artifact_anchor_joins_when_ci_build_carries_digest() {
        const DIGEST: &str =
            "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        let mut sources = stub_sources();
        sources.gitlab_pipelines = Capability::read_only("gitlab.listPipelines", "", |_| async {
            Ok(json!({
                "entities": [{
                    "id": "gitlab:pipeline:99",
                    "kind": "build",
                    "source": "gitlab",
                    "title": "pipeline #99",
                    "url": null,
                    "attributes": {
                        "sha": "aabbccddeeff0011",
                        "image": "registry.local/payments-api",
                        "digest": DIGEST
                    }
                }]
            }))
        });

        let trace = trace_delivery_live(
            &sources,
            &TraceDeliveryIn {
                anchor: Some(DeliveryAnchor::Artifact {
                    value: DIGEST.into(),
                    source: None,
                }),
                issue_key: None,
                kube_context: None,
                namespaces: vec![],
            },
        )
        .await;

        assert!(trace.nodes.iter().any(|n| n.kind == EntityKind::Build));
        assert!(trace.nodes.iter().any(|n| n.kind == EntityKind::Artifact));
        assert!(
            !trace.partial,
            "matched reverse seed must not look like a source failure"
        );
        assert!(trace
            .source_errors
            .iter()
            .all(|e| !e.message.contains("no artifact matching")));
    }

    #[tokio::test]
    async fn live_artifact_anchor_without_matching_ci_is_missing_seed_not_empty_success() {
        let trace = trace_delivery_live(
            &stub_sources(),
            &TraceDeliveryIn {
                anchor: Some(DeliveryAnchor::Artifact {
                    value: "sha256:deadbeef".into(),
                    source: None,
                }),
                issue_key: None,
                kube_context: None,
                namespaces: vec![],
            },
        )
        .await;

        assert!(trace.nodes.is_empty());
        assert!(trace.partial);
        assert_eq!(trace.source_errors[0].source, Source::Workspace);
        assert!(
            trace.source_errors[0]
                .message
                .contains("no artifact matching"),
            "got {:?}",
            trace.source_errors[0].message
        );
    }

    #[tokio::test]
    async fn live_workload_anchor_without_image_fanout_is_missing_seed_honesty() {
        // No CI builds with image attrs → kube-by-image never runs → bundles
        // have no workloads → join must report missing_seed_match, not calm empty.
        let trace = trace_delivery_live(
            &stub_sources(),
            &TraceDeliveryIn {
                anchor: Some(DeliveryAnchor::Workload {
                    value: "payments/payments-api".into(),
                    source: None,
                }),
                issue_key: None,
                kube_context: Some("prod-eu".into()),
                namespaces: vec!["payments".into()],
            },
        )
        .await;

        assert!(trace.nodes.is_empty());
        assert!(trace.partial);
        assert!(
            trace.source_errors[0]
                .message
                .contains("no workload matching"),
            "got {:?}",
            trace.source_errors[0].message
        );
    }

    #[tokio::test]
    async fn live_deployment_anchor_joins_when_kube_returns_matching_workload() {
        const DIGEST: &str =
            "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        let mut sources = stub_sources();
        sources.gitlab_pipelines = Capability::read_only("gitlab.listPipelines", "", |_| async {
            Ok(json!({
                "entities": [{
                    "id": "gitlab:pipeline:99",
                    "kind": "build",
                    "source": "gitlab",
                    "title": "pipeline #99",
                    "url": null,
                    "attributes": {
                        "sha": "aabbccddeeff0011",
                        "image": "registry.local/payments-api",
                        "digest": DIGEST
                    }
                }]
            }))
        });
        sources.kube_deployments_by_image =
            Capability::read_only("k8s.listDeploymentsByImage", "", |_| async {
                Ok(json!({
                    "deployments": [{
                        "name": "payments-api",
                        "namespace": "payments",
                        "ready": "1/1",
                        "images": [format!("registry.local/payments-api@{DIGEST}")]
                    }]
                }))
            });

        let trace = trace_delivery_live(
            &sources,
            &TraceDeliveryIn {
                anchor: Some(DeliveryAnchor::Deployment {
                    value: "payments/payments-api".into(),
                    source: None,
                }),
                issue_key: None,
                kube_context: Some("prod-eu".into()),
                namespaces: vec!["payments".into()],
            },
        )
        .await;

        assert!(
            trace
                .nodes
                .iter()
                .any(|n| n.id == "runtime:prod-eu/payments/payments-api"),
            "nodes={:?}",
            trace.nodes.iter().map(|n| &n.id).collect::<Vec<_>>()
        );
        assert!(trace.nodes.iter().any(|n| n.kind == EntityKind::Build));
        assert!(!trace.partial);
        assert!(trace
            .source_errors
            .iter()
            .all(|e| !e.message.contains("no deployment matching")));
    }

    #[tokio::test]
    async fn live_provider_failure_stays_source_error_not_empty_success() {
        let mut sources = stub_sources();
        sources.gitlab_pipelines = Capability::read_only("gitlab.listPipelines", "", |_| async {
            Err(srelens_capability::CapabilityError::Handler(
                "request timed out".into(),
            ))
        });

        let trace = trace_delivery_live(
            &sources,
            &TraceDeliveryIn {
                anchor: Some(DeliveryAnchor::Artifact {
                    value: "sha256:abc".into(),
                    source: None,
                }),
                issue_key: None,
                kube_context: None,
                namespaces: vec![],
            },
        )
        .await;

        assert!(trace.partial);
        assert!(
            trace
                .source_errors
                .iter()
                .any(|e| e.source == Source::Gitlab && e.message.contains("timed out")),
            "errors={:?}",
            trace.source_errors
        );
        // Still honest about the missing reverse seed — not a calm empty Trace.
        assert!(trace
            .source_errors
            .iter()
            .any(|e| e.message.contains("no artifact matching")));
    }
}
