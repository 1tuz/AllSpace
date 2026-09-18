//! Chain-level situations and plain-language verdicts.
//!
//! Derived only from successful node/edge evidence. Provider `sourceErrors`
//! stay separate and never become CI or cluster facts.

use std::time::{SystemTime, UNIX_EPOCH};

use srelens_devops_model::{
    ChainVerdict, Confidence, Edge, Entity, EntityKind, Relation, Situation,
};

/// Result of reading a delivery chain for My Work / Delivery rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DerivedChain {
    pub situations: Vec<Situation>,
    pub verdict: Option<ChainVerdict>,
}

/// Derive situations (+ verdict) from correlated nodes and edges.
///
/// Empty nodes → empty situations and no verdict (partial/errors stay on Trace).
pub fn derive_chain(nodes: &[Entity], edges: &[Edge]) -> DerivedChain {
    if nodes.is_empty() {
        return DerivedChain {
            situations: vec![],
            verdict: None,
        };
    }

    let mut situations: Vec<Situation> = Vec::new();

    if let Some(build) = worst_failed_build(nodes) {
        let label = if nodes.iter().any(change_is_merged) {
            "MR merged but pipeline failed".into()
        } else {
            format!("{} failed", build_noun(build))
        };
        situations.push(Situation {
            level: "loud".into(),
            label,
            primary_action: Some("Inspect failed pipeline".into()),
        });
    }

    if let Some((_workload, ready, desired)) = first_incomplete_workload(nodes) {
        if ready == 0 && desired > 0 {
            situations.push(Situation {
                level: "loud".into(),
                label: "Workload has no ready replicas".into(),
                primary_action: Some("Inspect runtime".into()),
            });
        } else {
            situations.push(Situation {
                level: "notable".into(),
                label: "Rollout is incomplete".into(),
                primary_action: Some("Check rollout status".into()),
            });
        }
    }

    if !situations.iter().any(|s| s.level == "loud") && nodes.iter().any(build_is_running) {
        situations.push(Situation {
            level: "notable".into(),
            label: "Pipeline is running".into(),
            primary_action: Some("Watch pipeline".into()),
        });
    }

    // Heuristic joins must never read as certainty in product copy.
    // Only surface when no stronger DeployedTo evidence already backs the chain.
    let has_strong_deploy = edges.iter().any(|edge| {
        edge.relation == Relation::DeployedTo
            && matches!(edge.confidence, Confidence::Exact | Confidence::Strong)
    });
    let has_heuristic_deploy = edges.iter().any(|edge| {
        edge.relation == Relation::DeployedTo && edge.confidence == Confidence::Heuristic
    });
    if has_heuristic_deploy && !has_strong_deploy {
        situations.push(Situation {
            level: "notable".into(),
            label: "Artifact may match workload (heuristic evidence)".into(),
            primary_action: Some("Review evidence".into()),
        });
    }

    if situations.is_empty() {
        let has_success_build = nodes.iter().any(build_is_success);
        let has_ready_workload = nodes.iter().any(|node| {
            node.kind == EntityKind::Workload
                && workload_ready_ratio(node)
                    .is_some_and(|(ready, desired)| desired > 0 && ready >= desired)
        });
        let has_artifact = nodes.iter().any(|node| node.kind == EntityKind::Artifact);

        if has_ready_workload && (has_success_build || has_artifact) {
            situations.push(Situation {
                level: "calm".into(),
                label: "In production".into(),
                primary_action: Some("View runtime".into()),
            });
        } else if has_success_build {
            situations.push(Situation {
                level: "calm".into(),
                label: "Build succeeded".into(),
                primary_action: Some("Open delivery".into()),
            });
        } else if nodes.iter().any(change_is_open) {
            situations.push(Situation {
                level: "notable".into(),
                label: "Change is open".into(),
                primary_action: Some("Review change".into()),
            });
        } else {
            situations.push(Situation {
                level: "calm".into(),
                label: "Delivery chain observed".into(),
                primary_action: Some("Open delivery".into()),
            });
        }
    }

    situations.sort_by_key(|situation| level_rank(&situation.level));

    let verdict = situations.first().map(|top| ChainVerdict {
        summary: top.label.clone(),
        severity: top.level.clone(),
        primary_action: top.primary_action.clone(),
        age_seconds: latest_age_seconds(nodes),
    });

    DerivedChain {
        situations,
        verdict,
    }
}

/// Convenience: situations only (live assemble and tests).
pub fn derive_situations(nodes: &[Entity], edges: &[Edge]) -> Vec<Situation> {
    derive_chain(nodes, edges).situations
}

fn level_rank(level: &str) -> u8 {
    match level {
        "loud" => 0,
        "notable" => 1,
        _ => 2,
    }
}

fn attr_str<'a>(entity: &'a Entity, key: &str) -> Option<&'a str> {
    entity.attributes.get(key).and_then(|value| value.as_str())
}

fn attr_u64(entity: &Entity, key: &str) -> Option<u64> {
    let value = entity.attributes.get(key)?;
    value
        .as_u64()
        .or_else(|| value.as_i64().map(|n| n as u64))
        .or_else(|| value.as_f64().map(|n| n as u64))
        .or_else(|| value.as_str()?.parse().ok())
}

fn build_status(entity: &Entity) -> Option<String> {
    if entity.kind != EntityKind::Build {
        return None;
    }
    attr_str(entity, "status").map(|s| s.to_ascii_lowercase())
}

fn build_is_failed(entity: &Entity) -> bool {
    matches!(
        build_status(entity).as_deref(),
        Some("failed" | "failure" | "canceled" | "cancelled" | "error")
    )
}

fn build_is_success(entity: &Entity) -> bool {
    matches!(
        build_status(entity).as_deref(),
        Some("success" | "successful" | "passed" | "stable")
    )
}

fn build_is_running(entity: &Entity) -> bool {
    matches!(
        build_status(entity).as_deref(),
        Some("running" | "pending" | "created" | "building" | "waiting_for_resource" | "preparing")
    )
}

fn worst_failed_build(nodes: &[Entity]) -> Option<&Entity> {
    nodes.iter().find(|node| build_is_failed(node))
}

fn build_noun(entity: &Entity) -> &'static str {
    if entity.id.contains("pipeline") || entity.title.to_ascii_lowercase().contains("pipeline") {
        "Pipeline"
    } else {
        "Build"
    }
}

fn change_state(entity: &Entity) -> Option<String> {
    if entity.kind != EntityKind::PullRequest {
        return None;
    }
    attr_str(entity, "state")
        .or_else(|| attr_str(entity, "status"))
        .map(|s| s.to_ascii_lowercase())
}

fn change_is_merged(entity: &Entity) -> bool {
    matches!(change_state(entity).as_deref(), Some("merged" | "merge"))
}

fn change_is_open(entity: &Entity) -> bool {
    matches!(
        change_state(entity).as_deref(),
        Some("open" | "opened" | "draft")
    )
}

fn workload_ready_ratio(entity: &Entity) -> Option<(u64, u64)> {
    if entity.kind != EntityKind::Workload {
        return None;
    }
    if let (Some(ready), Some(desired)) = (attr_u64(entity, "ready"), attr_u64(entity, "desired")) {
        return Some((ready, desired));
    }
    // Live kube fan-out stores "ready" as "2/3".
    let ready_str = attr_str(entity, "ready")?;
    let (ready_part, desired_part) = ready_str.split_once('/')?;
    let ready: u64 = ready_part.trim().parse().ok()?;
    let desired: u64 = desired_part.trim().parse().ok()?;
    Some((ready, desired))
}

fn first_incomplete_workload(nodes: &[Entity]) -> Option<(&Entity, u64, u64)> {
    for node in nodes {
        if let Some((ready, desired)) = workload_ready_ratio(node) {
            if desired > 0 && ready < desired {
                return Some((node, ready, desired));
            }
        }
    }
    None
}

fn latest_age_seconds(nodes: &[Entity]) -> Option<u64> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    let mut youngest: Option<u64> = None;
    for node in nodes {
        let Some(secs) = event_timestamp_secs(node) else {
            continue;
        };
        if secs > now {
            continue;
        }
        let age = now - secs;
        youngest = Some(match youngest {
            Some(current) => current.min(age),
            None => age,
        });
    }
    youngest
}

fn event_timestamp_secs(entity: &Entity) -> Option<u64> {
    // Jenkins uses epoch millis under `timestamp`; accept secs if small.
    for key in ["timestamp", "updatedAt", "finishedAt", "createdAt"] {
        if let Some(raw) = attr_u64(entity, key) {
            return Some(if raw > 10_000_000_000 {
                raw / 1000
            } else {
                raw
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use srelens_devops_model::{Evidence, Source};

    fn entity(
        id: &str,
        kind: EntityKind,
        source: Source,
        title: &str,
        attrs: serde_json::Value,
    ) -> Entity {
        Entity {
            id: id.into(),
            kind,
            source,
            title: title.into(),
            url: None,
            attributes: attrs,
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

    #[test]
    fn failed_pipeline_with_merged_mr_is_loud() {
        let nodes = vec![
            entity(
                "gitlab:mr:721",
                EntityKind::PullRequest,
                Source::Gitlab,
                "MR !721",
                json!({ "state": "merged" }),
            ),
            entity(
                "gitlab:pipeline:9182",
                EntityKind::Build,
                Source::Gitlab,
                "Pipeline #9182",
                json!({ "status": "failed" }),
            ),
        ];
        let derived = derive_chain(&nodes, &[]);
        assert_eq!(derived.situations[0].level, "loud");
        assert_eq!(derived.situations[0].label, "MR merged but pipeline failed");
        assert_eq!(
            derived
                .verdict
                .as_ref()
                .map(|v| v.primary_action.as_deref()),
            Some(Some("Inspect failed pipeline"))
        );
        assert_eq!(
            derived.verdict.as_ref().map(|v| v.severity.as_str()),
            Some("loud")
        );
    }

    #[test]
    fn healthy_prod_is_calm() {
        let nodes = vec![
            entity(
                "jenkins:payments:1",
                EntityKind::Build,
                Source::Jenkins,
                "payments #1",
                json!({ "status": "SUCCESS" }),
            ),
            entity(
                "oci:registry.local/payments:abc",
                EntityKind::Artifact,
                Source::Jenkins,
                "payments:abc",
                json!({ "tag": "abc" }),
            ),
            entity(
                "k8s:prod:payments:api",
                EntityKind::Workload,
                Source::Kubernetes,
                "payments/api",
                json!({ "ready": 5, "desired": 5 }),
            ),
        ];
        let edges = vec![edge(
            "oci:registry.local/payments:abc",
            "k8s:prod:payments:api",
            Relation::DeployedTo,
            Confidence::Strong,
            "image_tag_exact",
            "payments:abc",
        )];
        let derived = derive_chain(&nodes, &edges);
        assert_eq!(derived.situations.len(), 1);
        assert_eq!(derived.situations[0].level, "calm");
        assert_eq!(derived.situations[0].label, "In production");
        assert_eq!(
            derived.verdict.as_ref().map(|v| v.severity.as_str()),
            Some("calm")
        );
    }

    #[test]
    fn partial_chain_still_derives_from_available_nodes() {
        // No workload, no sourceErrors in the derive input — only a failed build.
        let nodes = vec![entity(
            "jenkins:job:9",
            EntityKind::Build,
            Source::Jenkins,
            "job #9",
            json!({ "status": "FAILURE" }),
        )];
        let situations = derive_situations(&nodes, &[]);
        assert_eq!(situations[0].level, "loud");
        assert_eq!(situations[0].label, "Build failed");
    }

    #[test]
    fn heuristic_deploy_label_does_not_claim_certainty() {
        let nodes = vec![
            entity(
                "oci:img@sha256:ab",
                EntityKind::Artifact,
                Source::Gitlab,
                "img",
                json!({ "digest": "sha256:ab" }),
            ),
            entity(
                "runtime:prod/ns/app",
                EntityKind::Workload,
                Source::Kubernetes,
                "ns/app",
                json!({ "ready": "5/5", "images": ["img:91f3aa1"] }),
            ),
        ];
        let edges = vec![edge(
            "oci:img@sha256:ab",
            "runtime:prod/ns/app",
            Relation::DeployedTo,
            Confidence::Heuristic,
            "image_tag_short_sha",
            "91f3aa1",
        )];
        let situations = derive_situations(&nodes, &edges);
        let heuristic = situations
            .iter()
            .find(|s| s.label.contains("heuristic"))
            .expect("heuristic situation");
        assert_eq!(heuristic.level, "notable");
        assert!(heuristic.label.contains("may match"));
        assert!(!heuristic.label.to_ascii_lowercase().contains("is running"));
        assert!(!heuristic.label.to_ascii_lowercase().contains("deployed to"));
    }

    #[test]
    fn empty_nodes_yield_no_situations_even_with_heuristic_edges() {
        // Edges without nodes should not invent a story; assemble never does this,
        // but the pure function must stay fail-closed.
        let edges = vec![edge(
            "a",
            "b",
            Relation::DeployedTo,
            Confidence::Heuristic,
            "image_tag_short_sha",
            "abc",
        )];
        let derived = derive_chain(&[], &edges);
        assert!(derived.situations.is_empty());
        assert!(derived.verdict.is_none());
    }

    #[test]
    fn incomplete_rollout_is_notable() {
        let nodes = vec![entity(
            "runtime:prod/ns/app",
            EntityKind::Workload,
            Source::Kubernetes,
            "ns/app",
            json!({ "ready": "2/3" }),
        )];
        let situations = derive_situations(&nodes, &[]);
        assert_eq!(situations[0].level, "notable");
        assert_eq!(situations[0].label, "Rollout is incomplete");
    }

    #[test]
    fn situation_wire_uses_camel_case_primary_action() {
        let situation = Situation {
            level: "loud".into(),
            label: "Pipeline failed".into(),
            primary_action: Some("Inspect failed pipeline".into()),
        };
        let value = serde_json::to_value(&situation).unwrap();
        assert_eq!(value["primaryAction"], "Inspect failed pipeline");
        assert!(value.get("primary_action").is_none());
    }

    #[test]
    fn verdict_wire_uses_camel_case_age_seconds() {
        let verdict = ChainVerdict {
            summary: "In production".into(),
            severity: "calm".into(),
            primary_action: Some("View runtime".into()),
            age_seconds: Some(120),
        };
        let value = serde_json::to_value(&verdict).unwrap();
        assert_eq!(value["ageSeconds"], 120);
        assert_eq!(value["primaryAction"], "View runtime");
        assert!(value.get("age_seconds").is_none());
    }
}
