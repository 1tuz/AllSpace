use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum EntityKind {
    Project,
    Issue,
    Branch,
    PullRequest,
    Commit,
    Build,
    Artifact,
    Workload,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Fixture,
    Jira,
    Gitlab,
    Bitbucket,
    Jenkins,
    Kubernetes,
    /// Product / correlation messages (unsupported anchor, mode, etc.).
    Workspace,
}

/// Provider-neutral entry point for a Delivery. A Komus delivery may begin at a
/// pull request or build with no Jira issue at all.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DeliveryAnchor {
    Issue {
        value: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
    Branch {
        value: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
    PullRequest {
        value: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
    Commit {
        value: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
    Build {
        value: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
    Artifact {
        value: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
    Deployment {
        value: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
    Workload {
        value: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
}

impl DeliveryAnchor {
    pub fn kind_name(&self) -> &'static str {
        match self {
            Self::Issue { .. } => "issue",
            Self::Branch { .. } => "branch",
            Self::PullRequest { .. } => "pullRequest",
            Self::Commit { .. } => "commit",
            Self::Build { .. } => "build",
            Self::Artifact { .. } => "artifact",
            Self::Deployment { .. } => "deployment",
            Self::Workload { .. } => "workload",
        }
    }

    pub fn value(&self) -> &str {
        match self {
            Self::Issue { value, .. }
            | Self::Branch { value, .. }
            | Self::PullRequest { value, .. }
            | Self::Commit { value, .. }
            | Self::Build { value, .. }
            | Self::Artifact { value, .. }
            | Self::Deployment { value, .. }
            | Self::Workload { value, .. } => value,
        }
    }

    pub fn issue(value: impl Into<String>) -> Self {
        Self::Issue {
            value: value.into(),
            source: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Relation {
    Implements,
    Contains,
    BuiltBy,
    Produces,
    DeployedTo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Confidence {
    Exact,
    Strong,
    Heuristic,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub id: String,
    pub kind: EntityKind,
    pub source: Source,
    pub title: String,
    pub url: Option<String>,
    pub attributes: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub kind: String,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub relation: Relation,
    pub confidence: Confidence,
    pub evidence: Vec<Evidence>,
}

/// Chain-level situation for My Work / Delivery rows.
///
/// `level` wire values the UI understands: `calm` | `notable` | `loud`.
/// Older fixtures may still say `healthy`; map that to `calm` at the UI edge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Situation {
    pub level: String,
    pub label: String,
    /// One primary action for this situation (product rule: one per situation).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_action: Option<String>,
}

/// Plain-language chain verdict: severity, summary, optional age and action.
///
/// Severity uses the same vocabulary as [`Situation::level`]:
/// `calm` | `notable` | `loud`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChainVerdict {
    pub summary: String,
    pub severity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_action: Option<String>,
    /// Age of the newest known event in seconds, when a provider timestamp exists.
    /// Absent means unknown — never invent freshness from a failed call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub age_seconds: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceError {
    pub source: Source,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    pub nodes: Vec<Entity>,
    pub edges: Vec<Edge>,
    pub situations: Vec<Situation>,
    /// Optional chain-level verdict; omitted when there is no successful evidence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verdict: Option<ChainVerdict>,
    pub partial: bool,
    pub source_errors: Vec<SourceError>,
}

/// Compact Delivery row for My Work / Deliveries lists. Not a fixture shape —
/// derived from live provider entities and join-derived situations/verdict.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeliverySummary {
    pub id: String,
    pub anchor: DeliveryAnchor,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_id: Option<String>,
    /// Coarse section key: attention | in_progress | in_review | building | deploying | delivered
    pub stage: String,
    pub stage_label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    pub situations: Vec<Situation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verdict: Option<ChainVerdict>,
    pub partial: bool,
    pub source_errors: Vec<SourceError>,
}

/// Bounded live Delivery list (My Work / Deliveries). Failures stay in
/// `sourceErrors` with `partial`; never invent Demo fixtures here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryList {
    pub deliveries: Vec<DeliverySummary>,
    pub partial: bool,
    pub source_errors: Vec<SourceError>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn trace_serializes_camel_case_contract_and_preserves_evidence() {
        let trace = Trace {
            nodes: vec![Entity {
                id: "jira:OPS-142".into(),
                kind: EntityKind::Issue,
                source: Source::Fixture,
                title: "Cache invalidation".into(),
                url: None,
                attributes: json!({ "key": "OPS-142" }),
            }],
            edges: vec![Edge {
                from: "jira:OPS-142".into(),
                to: "bitbucket:pr:482".into(),
                relation: Relation::Implements,
                confidence: Confidence::Exact,
                evidence: vec![Evidence {
                    kind: "issue_key_in_branch".into(),
                    detail: "feature/OPS-142-cache".into(),
                }],
            }],
            situations: vec![],
            verdict: None,
            partial: false,
            source_errors: vec![],
        };

        assert_eq!(
            serde_json::to_value(&trace).unwrap()["sourceErrors"],
            json!([])
        );
        assert!(serde_json::to_value(&trace).unwrap().get("verdict").is_none());
        assert_eq!(
            serde_json::to_value(&trace).unwrap()["edges"][0]["evidence"][0]["kind"],
            "issue_key_in_branch"
        );
    }

    #[test]
    fn delivery_anchor_wire_uses_kind_and_value() {
        let anchor = DeliveryAnchor::PullRequest {
            value: "8821".into(),
            source: Some("bitbucket".into()),
        };
        assert_eq!(
            serde_json::to_value(&anchor).unwrap(),
            json!({ "kind": "pullRequest", "value": "8821", "source": "bitbucket" })
        );
        let issue = DeliveryAnchor::issue("OPS-142");
        assert_eq!(
            serde_json::to_value(&issue).unwrap(),
            json!({ "kind": "issue", "value": "OPS-142" })
        );
    }
}
