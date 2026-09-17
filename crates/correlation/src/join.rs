use srelens_devops_model::{
    Confidence, Edge, Entity, EntityKind, Evidence, Relation, SourceError, Trace,
};
use serde_json::json;

/// Provider-neutral bags the live adapters already returned. Join never talks
/// to the network — that keeps evidence rules unit-testable without transports.
#[derive(Debug, Default, Clone)]
pub struct DeliveryBundles {
    pub issues: Vec<Entity>,
    pub changes: Vec<Entity>,
    pub commits: Vec<Entity>,
    pub builds: Vec<Entity>,
    /// Kubernetes / runtime workloads (empty until live kube fan-out lands).
    pub artifacts: Vec<Entity>,
    pub workloads: Vec<Entity>,
    pub source_errors: Vec<SourceError>,
}

/// Join Jira/GitLab/Bitbucket/Jenkins entities into one delivery Trace.
///
/// Matching rules (confidence):
/// - change title or branch contains the issue key → Heuristic (`issue_key_mention`)
/// - branch contains the issue key → Exact (`issue_key_in_branch`) when the
///   branch field is present and matches; otherwise Heuristic
/// - change SHA equals commit SHA → Exact (`pull_request_merge_commit`)
/// - build SHA equals commit SHA → Exact (`build_commit_exact`); short-prefix
///   match on a longer SHA → Heuristic (`build_commit_prefix`)
/// - build image/digest attrs → Artifact + Produces (Exact digest / Strong tag)
/// - artifact ↔ workload image refs → DeployedTo (`image_digest_exact` /
///   `image_tag_exact` / `image_tag_short_sha`)
pub fn join_delivery_trace(issue_key: &str, bundles: DeliveryBundles) -> Trace {
    let mention = issue_key.to_ascii_lowercase();
    let issue = bundles
        .issues
        .iter()
        .find(|entity| entity_mentions(entity, &mention) || issue_key_attr(entity, issue_key))
        .cloned()
        .or_else(|| bundles.issues.first().cloned());

    let changes: Vec<Entity> = bundles
        .changes
        .into_iter()
        .filter(|entity| entity_mentions(entity, &mention))
        .collect();

    let mut shas: Vec<String> = changes.iter().filter_map(entity_sha).collect();

    let commits: Vec<Entity> = bundles
        .commits
        .into_iter()
        .filter(|entity| {
            entity_mentions(entity, &mention)
                || entity_sha(entity).is_some_and(|sha| shas.iter().any(|known| sha_match(known, &sha).is_some()))
        })
        .collect();

    for commit in &commits {
        if let Some(sha) = entity_sha(commit) {
            if !shas.iter().any(|known| known == &sha) {
                shas.push(sha);
            }
        }
    }

    let builds: Vec<Entity> = bundles
        .builds
        .into_iter()
        .filter(|entity| {
            entity_sha(entity).is_some_and(|sha| shas.iter().any(|known| sha_match(known, &sha).is_some()))
        })
        .collect();

    let (mut artifacts, produce_edges) = synthesize_artifacts_from_builds(&builds);
    for artifact in bundles.artifacts {
        if !artifacts.iter().any(|existing| existing.id == artifact.id) {
            artifacts.push(artifact);
        }
    }

    let all_workloads = bundles.workloads;
    let deploy_edges = match_artifacts_to_workloads(&artifacts, &all_workloads);
    // A scoped Kubernetes fan-out can see deployments for images from other
    // builds. Only retain workloads that the selected delivery artifacts
    // actually linked to; never render a cluster fact as part of this issue
    // without evidence.
    let workloads: Vec<Entity> = all_workloads
        .into_iter()
        .filter(|workload| deploy_edges.iter().any(|edge| edge.to == workload.id))
        .collect();

    let mut nodes = Vec::new();
    if let Some(issue) = issue.clone() {
        nodes.push(issue);
    }
    nodes.extend(changes.iter().cloned());
    nodes.extend(commits.iter().cloned());
    nodes.extend(builds.iter().cloned());
    nodes.extend(artifacts.iter().cloned());
    nodes.extend(workloads.iter().cloned());

    let mut edges = Vec::new();
    if let Some(issue) = &issue {
        for change in &changes {
            let (confidence, kind, detail) = change_link_evidence(change, issue_key);
            edges.push(edge(
                &issue.id,
                &change.id,
                Relation::Implements,
                confidence,
                kind,
                detail,
            ));
        }
    }

    for change in &changes {
        let Some(change_sha) = entity_sha(change) else {
            continue;
        };
        for commit in &commits {
            let Some(commit_sha) = entity_sha(commit) else {
                continue;
            };
            if let Some(confidence) = sha_match(&change_sha, &commit_sha) {
                let kind = if confidence == Confidence::Exact {
                    "pull_request_merge_commit"
                } else {
                    "pull_request_commit_prefix"
                };
                edges.push(edge(
                    &change.id,
                    &commit.id,
                    Relation::Contains,
                    confidence,
                    kind,
                    &commit_sha,
                ));
            }
        }
    }

    for commit in &commits {
        let Some(commit_sha) = entity_sha(commit) else {
            continue;
        };
        for build in &builds {
            let Some(build_sha) = entity_sha(build) else {
                continue;
            };
            if let Some(confidence) = sha_match(&commit_sha, &build_sha) {
                let kind = if confidence == Confidence::Exact {
                    "build_commit_exact"
                } else {
                    "build_commit_prefix"
                };
                edges.push(edge(
                    &commit.id,
                    &build.id,
                    Relation::BuiltBy,
                    confidence,
                    kind,
                    &build_sha,
                ));
            }
        }
    }

    edges.extend(produce_edges);
    edges.extend(deploy_edges);

    let partial = !bundles.source_errors.is_empty();
    Trace {
        nodes,
        edges,
        situations: vec![],
        partial,
        source_errors: bundles.source_errors,
    }
}

/// Build Artifact entities from selected builds that carry image identity attrs.
fn synthesize_artifacts_from_builds(builds: &[Entity]) -> (Vec<Entity>, Vec<Edge>) {
    let mut artifacts: Vec<Entity> = Vec::new();
    let mut edges: Vec<Edge> = Vec::new();
    for build in builds {
        let Some(image_ref) = build_image_ref(build) else {
            continue;
        };
        let digest = attr_str(build, "digest").map(str::to_owned);
        let tag = attr_str(build, "imageTag")
            .or_else(|| attr_str(build, "tag"))
            .map(str::to_owned);
        let id = format!("oci:{image_ref}");
        if artifacts.iter().any(|existing: &Entity| existing.id == id) {
            // Still link this build if we already synthesized the artifact.
            let (confidence, kind) = if digest.is_some() {
                (Confidence::Exact, "image_digest_from_build_metadata")
            } else {
                (Confidence::Strong, "image_tag_from_build_metadata")
            };
            edges.push(edge(
                &build.id,
                &id,
                Relation::Produces,
                confidence,
                kind,
                &image_ref,
            ));
            continue;
        }
        let mut attrs = json!({});
        if let Some(obj) = attrs.as_object_mut() {
            obj.insert("image".into(), json!(image_ref));
            if let Some(tag) = &tag {
                obj.insert("tag".into(), json!(tag));
            }
            if let Some(digest) = &digest {
                obj.insert("digest".into(), json!(digest));
            }
        }
        let artifact = Entity {
            id: id.clone(),
            kind: EntityKind::Artifact,
            source: build.source.clone(),
            title: image_ref.clone(),
            url: None,
            attributes: attrs,
        };
        let (confidence, kind) = if digest.is_some() {
            (Confidence::Exact, "image_digest_from_build_metadata")
        } else {
            (Confidence::Strong, "image_tag_from_build_metadata")
        };
        edges.push(edge(
            &build.id,
            &artifact.id,
            Relation::Produces,
            confidence,
            kind,
            &image_ref,
        ));
        artifacts.push(artifact);
    }
    (artifacts, edges)
}

pub(crate) fn build_image_ref(build: &Entity) -> Option<String> {
    let image = attr_str(build, "image");
    let tag = attr_str(build, "imageTag").or_else(|| attr_str(build, "tag"));
    let digest = attr_str(build, "digest");
    if image.is_none() && tag.is_none() && digest.is_none() {
        return None;
    }
    if let Some(image) = image {
        // A colon before the final slash is a registry port, not an image tag.
        let has_tag = image
            .rsplit_once('/')
            .map(|(_, last)| last.contains(':'))
            .unwrap_or_else(|| image.contains(':'));
        if image.contains('@') || has_tag {
            return Some(image.to_owned());
        }
        if let Some(digest) = digest {
            let digest = if digest.starts_with("sha256:") {
                digest.to_owned()
            } else {
                format!("sha256:{digest}")
            };
            return Some(format!("{image}@{digest}"));
        }
        if let Some(tag) = tag {
            return Some(format!("{image}:{tag}"));
        }
        return Some(image.to_owned());
    }
    digest.map(str::to_owned)
}

fn match_artifacts_to_workloads(artifacts: &[Entity], workloads: &[Entity]) -> Vec<Edge> {
    let mut edges = Vec::new();
    for artifact in artifacts {
        for workload in workloads {
            if let Some((confidence, kind, detail)) = artifact_workload_match(artifact, workload) {
                edges.push(edge(
                    &artifact.id,
                    &workload.id,
                    Relation::DeployedTo,
                    confidence,
                    kind,
                    &detail,
                ));
            }
        }
    }
    edges
}

fn artifact_workload_match(
    artifact: &Entity,
    workload: &Entity,
) -> Option<(Confidence, &'static str, String)> {
    let workload_images = workload_image_refs(workload);
    if workload_images.is_empty() {
        return None;
    }

    if let Some(digest) = attr_str(artifact, "digest") {
        let needle = digest.trim();
        if !needle.is_empty()
            && workload_images
                .iter()
                .any(|image| image.contains(needle))
        {
            return Some((
                Confidence::Exact,
                "image_digest_exact",
                needle.to_owned(),
            ));
        }
    }

    let image_ref = attr_str(artifact, "image")
        .map(str::to_owned)
        .or_else(|| artifact.id.strip_prefix("oci:").map(str::to_owned))?;

    let tag = attr_str(artifact, "tag")
        .or_else(|| attr_str(artifact, "imageTag"))
        .or_else(|| {
            image_ref
                .rsplit_once(':')
                .map(|(_, tag)| tag)
                .filter(|tag| !tag.is_empty() && !tag.contains('@'))
        });

    let full_match = workload_images.iter().any(|image| {
        image == &image_ref
            || image.ends_with(&format!("/{image_ref}"))
            || (image.contains(&image_ref) && image.len() >= image_ref.len())
    });

    if full_match {
        // Short SHA tags are never Strong — product rule: short SHA ≠ exact/strong.
        if let Some(tag) = tag {
            if tag.len() >= 7 && looks_like_sha(tag) {
                return Some((
                    Confidence::Heuristic,
                    "image_tag_short_sha",
                    tag.to_owned(),
                ));
            }
        }
        return Some((Confidence::Strong, "image_tag_exact", image_ref));
    }

    if let Some(tag) = tag {
        if tag.len() >= 7 && looks_like_sha(tag) {
            if workload_images
                .iter()
                .any(|image| image.to_ascii_lowercase().contains(&tag.to_ascii_lowercase()))
            {
                return Some((
                    Confidence::Heuristic,
                    "image_tag_short_sha",
                    tag.to_owned(),
                ));
            }
        } else if !tag.is_empty()
            && workload_images.iter().any(|image| {
                image.ends_with(&format!(":{tag}"))
                    || image.rsplit_once(':').is_some_and(|(_, t)| t == tag)
            })
        {
            return Some((Confidence::Strong, "image_tag_exact", image_ref));
        }
    }

    None
}

fn workload_image_refs(entity: &Entity) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(image) = attr_str(entity, "image") {
        out.push(image.to_owned());
    }
    if let Some(arr) = entity.attributes.get("images").and_then(|value| value.as_array()) {
        for item in arr {
            if let Some(image) = item.as_str() {
                out.push(image.to_owned());
            }
        }
    }
    out
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

fn entity_mentions(entity: &Entity, mention: &str) -> bool {
    let title = entity.title.to_ascii_lowercase();
    if title.contains(mention) {
        return true;
    }
    for key in ["sourceBranch", "fromBranch", "branch", "key", "message"] {
        if attr_str(entity, key)
            .map(|value| value.to_ascii_lowercase().contains(mention))
            .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

fn issue_key_attr(entity: &Entity, issue_key: &str) -> bool {
    attr_str(entity, "key").is_some_and(|key| key.eq_ignore_ascii_case(issue_key))
        || entity.id.to_ascii_lowercase().contains(&issue_key.to_ascii_lowercase())
}

fn change_link_evidence<'a>(
    change: &'a Entity,
    issue_key: &'a str,
) -> (Confidence, &'static str, &'a str) {
    let mention = issue_key.to_ascii_lowercase();
    for key in ["sourceBranch", "fromBranch", "branch"] {
        if let Some(branch) = attr_str(change, key) {
            if branch.to_ascii_lowercase().contains(&mention) {
                return (Confidence::Exact, "issue_key_in_branch", branch);
            }
        }
    }
    (Confidence::Heuristic, "issue_key_mention", issue_key)
}

fn entity_sha(entity: &Entity) -> Option<String> {
    attr_str(entity, "sha")
        .or_else(|| attr_str(entity, "scmRevision"))
        .map(str::to_owned)
        .or_else(|| {
            // gitlab:commit:<project>:<sha> / bitbucket:commit:…:<sha>
            entity
                .id
                .rsplit(':')
                .next()
                .filter(|tail| looks_like_sha(tail))
                .map(str::to_owned)
        })
}

fn attr_str<'a>(entity: &'a Entity, key: &str) -> Option<&'a str> {
    entity.attributes.get(key).and_then(|value| value.as_str())
}

fn looks_like_sha(value: &str) -> bool {
    let len = value.len();
    (7..=40).contains(&len) && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn sha_match(left: &str, right: &str) -> Option<Confidence> {
    if left.is_empty() || right.is_empty() {
        return None;
    }
    if left.eq_ignore_ascii_case(right) {
        return Some(Confidence::Exact);
    }
    let (longer, shorter) = if left.len() >= right.len() {
        (left, right)
    } else {
        (right, left)
    };
    if shorter.len() >= 7 && longer.to_ascii_lowercase().starts_with(&shorter.to_ascii_lowercase()) {
        Some(Confidence::Heuristic)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use srelens_devops_model::{EntityKind, Source};

    fn entity(id: &str, kind: EntityKind, source: Source, title: &str, attrs: serde_json::Value) -> Entity {
        Entity {
            id: id.into(),
            kind,
            source,
            title: title.into(),
            url: None,
            attributes: attrs,
        }
    }

    #[test]
    fn joins_issue_change_commit_build_with_evidence_ladder() {
        let trace = join_delivery_trace(
            "OPS-142",
            DeliveryBundles {
                issues: vec![entity(
                    "jira:issue:OPS-142",
                    EntityKind::Issue,
                    Source::Jira,
                    "Retry worker",
                    json!({ "key": "OPS-142" }),
                )],
                changes: vec![entity(
                    "bitbucket:pr:KOMUS/api:42",
                    EntityKind::PullRequest,
                    Source::Bitbucket,
                    "OPS-142 gate",
                    json!({ "fromBranch": "feature/OPS-142-gate", "sha": "deadbeefdeadbeef" }),
                )],
                commits: vec![entity(
                    "bitbucket:commit:KOMUS/api:deadbeefdeadbeef",
                    EntityKind::Commit,
                    Source::Bitbucket,
                    "deadbeef",
                    json!({ "sha": "deadbeefdeadbeef" }),
                )],
                builds: vec![entity(
                    "jenkins:payments-api/main:9182",
                    EntityKind::Build,
                    Source::Jenkins,
                    "payments-api/main #9182",
                    json!({ "sha": "deadbeef", "scmRevision": "deadbeef" }),
                )],
                ..DeliveryBundles::default()
            },
        );

        assert_eq!(trace.nodes.len(), 4);
        assert!(!trace.partial);
        assert!(trace.edges.iter().any(|edge| {
            edge.relation == Relation::Implements && edge.confidence == Confidence::Exact
        }));
        assert!(trace.edges.iter().any(|edge| {
            edge.relation == Relation::BuiltBy && edge.confidence == Confidence::Heuristic
        }));
    }

    #[test]
    fn source_errors_mark_trace_partial_without_inventing_nodes() {
        let trace = join_delivery_trace(
            "OPS-999",
            DeliveryBundles {
                source_errors: vec![SourceError {
                    source: Source::Gitlab,
                    message: "profile names no GitLab projects".into(),
                }],
                ..DeliveryBundles::default()
            },
        );
        assert!(trace.nodes.is_empty());
        assert!(trace.partial);
        assert_eq!(trace.source_errors.len(), 1);
    }

    #[test]
    fn synthesizes_artifact_and_matches_workload_by_digest_exact() {
        let digest = "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        let trace = join_delivery_trace(
            "OPS-142",
            DeliveryBundles {
                issues: vec![entity(
                    "jira:issue:OPS-142",
                    EntityKind::Issue,
                    Source::Jira,
                    "Retry",
                    json!({ "key": "OPS-142" }),
                )],
                changes: vec![entity(
                    "gitlab:mr:1",
                    EntityKind::PullRequest,
                    Source::Gitlab,
                    "OPS-142",
                    json!({ "sourceBranch": "feature/OPS-142", "sha": "aabbccddeeff0011" }),
                )],
                commits: vec![entity(
                    "gitlab:commit:p:aabbccddeeff0011",
                    EntityKind::Commit,
                    Source::Gitlab,
                    "aabbccddeeff0011",
                    json!({ "sha": "aabbccddeeff0011" }),
                )],
                builds: vec![entity(
                    "gitlab:pipeline:99",
                    EntityKind::Build,
                    Source::Gitlab,
                    "pipeline #99",
                    json!({
                        "sha": "aabbccddeeff0011",
                        "image": "registry.local/payments-api",
                        "digest": digest
                    }),
                )],
                workloads: vec![entity(
                    "k8s:prod:payments:Deployment:payments-api",
                    EntityKind::Workload,
                    Source::Kubernetes,
                    "payments-api",
                    json!({ "images": [format!("registry.local/payments-api@{digest}")] }),
                )],
                ..DeliveryBundles::default()
            },
        );

        assert!(trace.nodes.iter().any(|n| n.kind == EntityKind::Artifact));
        assert!(trace.edges.iter().any(|edge| {
            edge.relation == Relation::Produces && edge.confidence == Confidence::Exact
        }));
        let deploy = trace
            .edges
            .iter()
            .find(|edge| edge.relation == Relation::DeployedTo)
            .expect("DeployedTo edge");
        assert_eq!(deploy.confidence, Confidence::Exact);
        assert_eq!(deploy.evidence[0].kind, "image_digest_exact");
    }

    #[test]
    fn matches_workload_by_short_sha_heuristic() {
        let trace = join_delivery_trace(
            "OPS-142",
            DeliveryBundles {
                issues: vec![entity(
                    "jira:issue:OPS-142",
                    EntityKind::Issue,
                    Source::Jira,
                    "Retry",
                    json!({ "key": "OPS-142" }),
                )],
                changes: vec![entity(
                    "bitbucket:pr:1",
                    EntityKind::PullRequest,
                    Source::Bitbucket,
                    "OPS-142",
                    json!({ "fromBranch": "feature/OPS-142", "sha": "92ac41f7d2ab0000" }),
                )],
                commits: vec![entity(
                    "bitbucket:commit:x:92ac41f7d2ab0000",
                    EntityKind::Commit,
                    Source::Bitbucket,
                    "92ac41f7d2ab0000",
                    json!({ "sha": "92ac41f7d2ab0000" }),
                )],
                builds: vec![entity(
                    "jenkins:job:1",
                    EntityKind::Build,
                    Source::Jenkins,
                    "job #1",
                    json!({
                        "sha": "92ac41f7d2ab0000",
                        "image": "registry.local/payments-api",
                        "tag": "92ac41f"
                    }),
                )],
                workloads: vec![entity(
                    "k8s:prod:payments:Deployment:payments-api",
                    EntityKind::Workload,
                    Source::Kubernetes,
                    "payments-api",
                    json!({ "image": "registry.local/payments-api:92ac41f" }),
                )],
                ..DeliveryBundles::default()
            },
        );

        let deploy = trace
            .edges
            .iter()
            .find(|edge| {
                edge.relation == Relation::DeployedTo
                    && edge.evidence.iter().any(|e| e.kind == "image_tag_short_sha")
            })
            .expect("short-sha DeployedTo");
        assert_eq!(deploy.confidence, Confidence::Heuristic);
        assert!(trace.edges.iter().any(|edge| {
            edge.relation == Relation::Produces && edge.confidence == Confidence::Strong
        }));
    }

    #[test]
    fn adds_tag_after_a_registry_port() {
        let build = entity(
            "build:1",
            EntityKind::Build,
            Source::Jenkins,
            "build",
            json!({ "image": "registry.example:5000/payments", "tag": "v42" }),
        );
        assert_eq!(
            build_image_ref(&build).as_deref(),
            Some("registry.example:5000/payments:v42"),
        );
    }
}
