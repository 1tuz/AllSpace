mod delivery;
mod join;

pub use delivery::{trace_delivery_capability, DeliverySourceCaps, TraceDeliveryIn};
pub use join::{join_delivery_trace, DeliveryBundles};

use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;
use srelens_capability::{Annotations, Capability};
use srelens_devops_model::{
    Confidence, Edge, Entity, EntityKind, Evidence, Relation, Situation, Source, Trace,
};

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TraceIssueIn {
    #[serde(rename = "issueKey")]
    pub issue_key: String,
}

/// `devops.traceIssue` — trace a work item through the built-in development fixture.
///
/// This is deliberately source-free. Real Jira, Bitbucket, Jenkins, and Kubernetes
/// adapters are a later stage; keeping this handler pure makes the domain contract
/// usable through desktop, web, and MCP without configuration or credentials.
pub fn trace_issue_capability() -> Capability {
    Capability::typed::<TraceIssueIn, Trace, _, _>(
        "devops.traceIssue",
        "trace a DevOps work item through fixture issue, change, build, artifact, and workload data",
        Annotations::READ_ONLY,
        |input| async move { Ok(trace_fixture_issue(&input.issue_key).unwrap_or_default()) },
    )
}

/// Return the deterministic fixture trace for a known issue. `None` means the
/// fixture answered successfully but has no matching work item; it is not a source
/// failure and must not be rendered as one.
pub fn trace_fixture_issue(issue_key: &str) -> Option<Trace> {
    if issue_key != "OPS-142" {
        return None;
    }

    Some(Trace {
        nodes: vec![
            entity(
                "jira:OPS-142",
                EntityKind::Issue,
                Source::Jira,
                "OPS-142 Move payment retries to idempotent worker",
                json!({ "key": "OPS-142", "status": "In Progress" }),
            ),
            entity(
                "bitbucket:pr:482",
                EntityKind::PullRequest,
                Source::Bitbucket,
                "OPS-142 idempotent payment retry worker",
                json!({ "branch": "feature/OPS-142-retry-worker", "state": "merged" }),
            ),
            entity(
                "git:commit:92ac41f7",
                EntityKind::Commit,
                Source::Bitbucket,
                "92ac41f7d2ab",
                json!({ "sha": "92ac41f7d2ab" }),
            ),
            entity(
                "jenkins:payments-api:9182",
                EntityKind::Build,
                Source::Jenkins,
                "payments-api/main #9182",
                json!({ "status": "success" }),
            ),
            entity(
                "oci:registry.local/payments-api:92ac41f",
                EntityKind::Artifact,
                Source::Jenkins,
                "registry.local/payments-api:92ac41f",
                json!({ "tag": "92ac41f" }),
            ),
            entity(
                "k8s:prod-eu:payments:Deployment:payments-api",
                EntityKind::Workload,
                Source::Kubernetes,
                "prod-eu/payments/payments-api",
                json!({ "cluster": "prod-eu", "namespace": "payments", "kind": "Deployment", "ready": 5, "desired": 5 }),
            ),
        ],
        edges: vec![
            edge(
                "jira:OPS-142",
                "bitbucket:pr:482",
                Relation::Implements,
                Confidence::Exact,
                "issue_key_in_branch",
                "feature/OPS-142-retry-worker",
            ),
            edge(
                "bitbucket:pr:482",
                "git:commit:92ac41f7",
                Relation::Contains,
                Confidence::Exact,
                "pull_request_merge_commit",
                "92ac41f7d2ab",
            ),
            edge(
                "git:commit:92ac41f7",
                "jenkins:payments-api:9182",
                Relation::BuiltBy,
                Confidence::Exact,
                "build_commit_exact",
                "92ac41f7d2ab",
            ),
            edge(
                "jenkins:payments-api:9182",
                "oci:registry.local/payments-api:92ac41f",
                Relation::Produces,
                Confidence::Strong,
                "image_tag_from_build_metadata",
                "registry.local/payments-api:92ac41f",
            ),
            edge(
                "oci:registry.local/payments-api:92ac41f",
                "k8s:prod-eu:payments:Deployment:payments-api",
                Relation::DeployedTo,
                Confidence::Strong,
                "image_tag_exact",
                "registry.local/payments-api:92ac41f",
            ),
            edge(
                "git:commit:92ac41f7",
                "k8s:prod-eu:payments:Deployment:payments-api",
                Relation::DeployedTo,
                Confidence::Heuristic,
                "image_tag_short_sha",
                "92ac41f",
            ),
        ],
        situations: vec![Situation {
            level: "healthy".into(),
            label: "In production".into(),
        }],
        partial: false,
        source_errors: vec![],
    })
}

fn entity(
    id: &str,
    kind: EntityKind,
    source: Source,
    title: &str,
    attributes: serde_json::Value,
) -> Entity {
    Entity {
        id: id.into(),
        kind,
        source,
        title: title.into(),
        url: None,
        attributes,
    }
}

fn edge(
    from: &str,
    to: &str,
    relation: Relation,
    confidence: Confidence,
    kind: &str,
    detail: &str,
) -> Edge {
    Edge {
        from: from.into(),
        to: to.into(),
        relation,
        confidence,
        evidence: vec![Evidence {
            kind: kind.into(),
            detail: detail.into(),
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use srelens_devops_model::Confidence;

    #[test]
    fn fixture_trace_is_ordered_and_marks_short_sha_as_heuristic() {
        let trace = trace_fixture_issue("OPS-142").expect("fixture issue exists");

        assert_eq!(
            trace
                .nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "jira:OPS-142",
                "bitbucket:pr:482",
                "git:commit:92ac41f7",
                "jenkins:payments-api:9182",
                "oci:registry.local/payments-api:92ac41f",
                "k8s:prod-eu:payments:Deployment:payments-api",
            ]
        );
        assert!(trace
            .edges
            .iter()
            .any(|edge| edge.confidence == Confidence::Heuristic));
        assert!(!trace.partial);
    }
}
