use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum EntityKind {
    Project,
    Issue,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Situation {
    pub level: String,
    pub label: String,
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
            partial: false,
            source_errors: vec![],
        };

        assert_eq!(
            serde_json::to_value(&trace).unwrap()["sourceErrors"],
            json!([])
        );
        assert_eq!(
            serde_json::to_value(&trace).unwrap()["edges"][0]["evidence"][0]["kind"],
            "issue_key_in_branch"
        );
    }
}
