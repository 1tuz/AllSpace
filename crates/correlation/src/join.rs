use serde_json::json;
use srelens_devops_model::{
    Confidence, DeliveryAnchor, Edge, Entity, EntityKind, Evidence, Relation, Source, SourceError,
    Trace,
};

use crate::situations::derive_chain;

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

/// Join entities into one delivery Trace from a provider-neutral anchor.
///
/// Supported: `issue`, `pullRequest`, `branch`, `commit`, `build`,
/// `artifact`, `deployment`, `workload`. Reverse seeds join only from
/// entities already present in `bundles` (or synthesized from build attrs) —
/// never invent upstream CI archaeology.
pub fn join_delivery_from_anchor(anchor: &DeliveryAnchor, bundles: DeliveryBundles) -> Trace {
    match anchor {
        DeliveryAnchor::Issue { value, .. } => join_delivery_trace(value, bundles),
        DeliveryAnchor::PullRequest { value, .. } => {
            join_from_change_seed(value, ChangeSeed::PullRequest, bundles)
        }
        DeliveryAnchor::Branch { value, .. } => {
            join_from_change_seed(value, ChangeSeed::Branch, bundles)
        }
        DeliveryAnchor::Commit { value, .. } => join_from_commit_seed(value, bundles),
        DeliveryAnchor::Build { value, .. } => join_from_build_seed(value, bundles),
        DeliveryAnchor::Artifact { value, .. } => join_from_artifact_seed(value, bundles),
        DeliveryAnchor::Deployment { value, .. } => {
            join_from_workload_seed(value, bundles, WorkloadSeed::Deployment)
        }
        DeliveryAnchor::Workload { value, .. } => {
            join_from_workload_seed(value, bundles, WorkloadSeed::Any)
        }
    }
}

fn missing_seed_match(kind: &str, value: &str, mut source_errors: Vec<SourceError>) -> Trace {
    source_errors.push(SourceError {
        source: Source::Workspace,
        message: format!(
            "no {kind} matching '{value}' in delivery bundles (bundles lack matching artifact/build/workload data)"
        ),
    });
    Trace {
        nodes: vec![],
        edges: vec![],
        situations: vec![],
        verdict: None,
        partial: true,
        source_errors,
    }
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

    assemble_trace(
        issue,
        changes,
        bundles.commits,
        bundles.builds,
        bundles.artifacts,
        bundles.workloads,
        bundles.source_errors,
        Some(issue_key),
    )
}

#[derive(Clone, Copy)]
enum ChangeSeed {
    PullRequest,
    Branch,
}

fn join_from_change_seed(value: &str, seed: ChangeSeed, bundles: DeliveryBundles) -> Trace {
    let needle = value.to_ascii_lowercase();
    let changes: Vec<Entity> = bundles
        .changes
        .into_iter()
        .filter(|entity| match seed {
            ChangeSeed::PullRequest => change_matches_pr(entity, &needle),
            ChangeSeed::Branch => change_matches_branch(entity, &needle),
        })
        .collect();
    assemble_trace(
        None,
        changes,
        bundles.commits,
        bundles.builds,
        bundles.artifacts,
        bundles.workloads,
        bundles.source_errors,
        None,
    )
}

fn join_from_commit_seed(value: &str, bundles: DeliveryBundles) -> Trace {
    let commits: Vec<Entity> = bundles
        .commits
        .into_iter()
        .filter(|entity| {
            entity_sha(entity).is_some_and(|sha| sha_match(&sha, value).is_some())
                || entity
                    .id
                    .to_ascii_lowercase()
                    .contains(&value.to_ascii_lowercase())
        })
        .collect();
    let shas: Vec<String> = commits.iter().filter_map(entity_sha).collect();
    let changes: Vec<Entity> = bundles
        .changes
        .into_iter()
        .filter(|entity| {
            entity_sha(entity)
                .is_some_and(|sha| shas.iter().any(|known| sha_match(known, &sha).is_some()))
        })
        .collect();
    assemble_trace(
        None,
        changes,
        commits,
        bundles.builds,
        bundles.artifacts,
        bundles.workloads,
        bundles.source_errors,
        None,
    )
}

fn join_from_build_seed(value: &str, bundles: DeliveryBundles) -> Trace {
    let needle = value.to_ascii_lowercase();
    let builds: Vec<Entity> = bundles
        .builds
        .into_iter()
        .filter(|entity| {
            entity.id.to_ascii_lowercase().contains(&needle)
                || entity.title.to_ascii_lowercase().contains(&needle)
                || attr_str(entity, "number").is_some_and(|n| n.eq_ignore_ascii_case(value))
        })
        .collect();
    reverse_assemble_from_builds(
        builds,
        bundles.artifacts,
        bundles.workloads,
        bundles.source_errors,
        bundles.commits,
        bundles.changes,
    )
}

/// Artifact seed: digest and/or `name@sha256:…` / tag — match reverse of
/// synthesize / `match_artifacts_to_workloads`.
fn join_from_artifact_seed(value: &str, bundles: DeliveryBundles) -> Trace {
    let needle = ArtifactNeedle::parse(value);
    let builds: Vec<Entity> = bundles
        .builds
        .into_iter()
        .filter(|build| build_matches_artifact(build, &needle))
        .collect();
    let artifacts: Vec<Entity> = bundles
        .artifacts
        .into_iter()
        .filter(|artifact| artifact_matches_needle(artifact, &needle))
        .collect();

    if builds.is_empty() && artifacts.is_empty() {
        return missing_seed_match("artifact", value, bundles.source_errors);
    }

    reverse_assemble_from_builds(
        builds,
        artifacts,
        bundles.workloads,
        bundles.source_errors,
        bundles.commits,
        bundles.changes,
    )
}

#[derive(Clone, Copy)]
enum WorkloadSeed {
    Any,
    Deployment,
}

/// Workload / deployment seed: `ns/name` or existing node id — keep the
/// matched runtime node and walk reverse via image identity when present.
fn join_from_workload_seed(value: &str, bundles: DeliveryBundles, seed: WorkloadSeed) -> Trace {
    let kind_label = match seed {
        WorkloadSeed::Any => "workload",
        WorkloadSeed::Deployment => "deployment",
    };
    let workloads: Vec<Entity> = bundles
        .workloads
        .iter()
        .filter(|workload| workload_matches_seed(workload, value, seed))
        .cloned()
        .collect();
    if workloads.is_empty() {
        return missing_seed_match(kind_label, value, bundles.source_errors);
    }

    let builds: Vec<Entity> = bundles
        .builds
        .into_iter()
        .filter(|build| build_links_to_workloads(build, &workloads))
        .collect();

    // Keep seed workloads even when no artifact/build image match — we know
    // the runtime node exists; absence of reverse CI is not a fake join.
    let mut artifacts = bundles.artifacts;
    // Prefer artifacts already matched to these workloads so assemble keeps
    // DeployedTo edges when builds are empty.
    if builds.is_empty() {
        let deploy = match_artifacts_to_workloads(&artifacts, &workloads);
        artifacts.retain(|artifact| deploy.iter().any(|edge| edge.from == artifact.id));
    }

    let mut trace = reverse_assemble_from_builds(
        builds,
        artifacts,
        workloads.clone(),
        bundles.source_errors,
        bundles.commits,
        bundles.changes,
    );
    for workload in workloads {
        if !trace.nodes.iter().any(|node| node.id == workload.id) {
            trace.nodes.push(workload);
        }
    }
    trace
}

fn reverse_assemble_from_builds(
    builds: Vec<Entity>,
    artifacts: Vec<Entity>,
    workloads: Vec<Entity>,
    source_errors: Vec<SourceError>,
    bundle_commits: Vec<Entity>,
    bundle_changes: Vec<Entity>,
) -> Trace {
    let shas: Vec<String> = builds.iter().flat_map(entity_shas).collect();
    let commits: Vec<Entity> = bundle_commits
        .into_iter()
        .filter(|entity| {
            entity_sha(entity)
                .is_some_and(|sha| shas.iter().any(|known| sha_match(known, &sha).is_some()))
        })
        .collect();
    let changes: Vec<Entity> = bundle_changes
        .into_iter()
        .filter(|entity| {
            entity_sha(entity)
                .is_some_and(|sha| shas.iter().any(|known| sha_match(known, &sha).is_some()))
        })
        .collect();
    assemble_trace(
        None,
        changes,
        commits,
        builds,
        artifacts,
        workloads,
        source_errors,
        None,
    )
}

/// Parsed artifact identity from an anchor value.
struct ArtifactNeedle {
    raw: String,
    digest: Option<String>,
    image: Option<String>,
    tag: Option<String>,
}

impl ArtifactNeedle {
    fn parse(value: &str) -> Self {
        let raw = value
            .trim()
            .strip_prefix("oci:")
            .unwrap_or(value.trim())
            .to_owned();
        let lower = raw.to_ascii_lowercase();

        if let Some((image, digest)) = raw.split_once('@') {
            let image = image.to_owned();
            let digest = normalize_digest(digest);
            return Self {
                digest: Some(digest),
                image: Some(image),
                tag: None,
                raw,
            };
        }

        if lower.starts_with("sha256:") || is_bare_digest(&raw) {
            return Self {
                digest: Some(normalize_digest(&raw)),
                raw,
                image: None,
                tag: None,
            };
        }

        // registry/name:tag — colon after final slash is a tag, not a port.
        let tag = raw
            .rsplit_once('/')
            .map(|(_, last)| last)
            .unwrap_or(&raw)
            .rsplit_once(':')
            .filter(|(_, tag)| !tag.is_empty() && !tag.contains('@'))
            .map(|(_, tag)| tag.to_owned());
        let image = if tag.is_some() {
            // Strip trailing :tag from the full ref.
            raw.rsplit_once(':').map(|(image, _)| image.to_owned())
        } else {
            Some(raw.clone())
        };

        Self {
            raw,
            digest: None,
            image,
            tag,
        }
    }
}

fn normalize_digest(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.to_ascii_lowercase().starts_with("sha256:") {
        trimmed.to_ascii_lowercase()
    } else {
        format!("sha256:{}", trimmed.to_ascii_lowercase())
    }
}

fn is_bare_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn artifact_matches_needle(artifact: &Entity, needle: &ArtifactNeedle) -> bool {
    if let Some(digest) = &needle.digest {
        if attr_str(artifact, "digest").is_some_and(|d| normalize_digest(d) == *digest) {
            return true;
        }
        if artifact.id.to_ascii_lowercase().contains(digest)
            || artifact.title.to_ascii_lowercase().contains(digest)
        {
            return true;
        }
    }

    let artifact_image = attr_str(artifact, "image")
        .map(str::to_owned)
        .or_else(|| artifact.id.strip_prefix("oci:").map(str::to_owned));

    if let (Some(want_image), Some(have_image)) = (&needle.image, &artifact_image) {
        if image_name_match(have_image, want_image) {
            if let Some(want_tag) = &needle.tag {
                let have_tag = attr_str(artifact, "tag")
                    .or_else(|| attr_str(artifact, "imageTag"))
                    .map(str::to_owned)
                    .or_else(|| {
                        have_image
                            .rsplit_once(':')
                            .map(|(_, tag)| tag.to_owned())
                            .filter(|tag| !tag.is_empty() && !tag.contains('@'))
                    });
                return have_tag.is_some_and(|tag| tag.eq_ignore_ascii_case(want_tag));
            }
            if needle.digest.is_none() {
                return true;
            }
        }
    }

    let raw_lower = needle.raw.to_ascii_lowercase();
    artifact.id.to_ascii_lowercase().contains(&raw_lower)
        || artifact.title.to_ascii_lowercase().contains(&raw_lower)
        || artifact_image.is_some_and(|image| image.to_ascii_lowercase().contains(&raw_lower))
}

fn build_matches_artifact(build: &Entity, needle: &ArtifactNeedle) -> bool {
    if let Some(digest) = &needle.digest {
        if attr_str(build, "digest").is_some_and(|d| normalize_digest(d) == *digest) {
            return true;
        }
        if build_image_ref(build).is_some_and(|image| image.to_ascii_lowercase().contains(digest)) {
            return true;
        }
    }

    let (synth, _) = synthesize_artifacts_from_builds(std::slice::from_ref(build));
    synth
        .iter()
        .any(|artifact| artifact_matches_needle(artifact, &needle))
}

fn image_name_match(have: &str, want: &str) -> bool {
    let have_norm = strip_image_digest_and_tag(have);
    let want_norm = strip_image_digest_and_tag(want);
    have_norm.eq_ignore_ascii_case(&want_norm)
        || have_norm
            .to_ascii_lowercase()
            .ends_with(&format!("/{}", want_norm.to_ascii_lowercase()))
        || want_norm
            .to_ascii_lowercase()
            .ends_with(&format!("/{}", have_norm.to_ascii_lowercase()))
}

fn strip_image_digest_and_tag(image: &str) -> String {
    let without_digest = image.split_once('@').map(|(i, _)| i).unwrap_or(image);
    // Port vs tag: only strip tag from the final path segment.
    if let Some((repo, last)) = without_digest.rsplit_once('/') {
        if let Some((name, _)) = last.split_once(':') {
            return format!("{repo}/{name}");
        }
        return without_digest.to_owned();
    }
    without_digest
        .split_once(':')
        .filter(|(_, tag)| !tag.is_empty() && !tag.bytes().all(|b| b.is_ascii_digit()))
        .map(|(name, _)| name.to_owned())
        .unwrap_or_else(|| without_digest.to_owned())
}

fn workload_matches_seed(workload: &Entity, value: &str, seed: WorkloadSeed) -> bool {
    if matches!(seed, WorkloadSeed::Deployment) && !workload_is_deployment(workload) {
        return false;
    }
    let needle = value.trim();
    let needle_lower = needle.to_ascii_lowercase();
    if workload.id.eq_ignore_ascii_case(needle)
        || workload.id.to_ascii_lowercase().contains(&needle_lower)
    {
        return true;
    }
    if workload.title.to_ascii_lowercase().contains(&needle_lower) {
        return true;
    }
    if let Some((ns, name)) = needle.split_once('/') {
        let ns_ok = attr_str(workload, "namespace").is_some_and(|v| v.eq_ignore_ascii_case(ns))
            || workload
                .id
                .to_ascii_lowercase()
                .contains(&ns.to_ascii_lowercase());
        let name_ok = attr_str(workload, "name").is_some_and(|v| v.eq_ignore_ascii_case(name))
            || workload
                .title
                .to_ascii_lowercase()
                .contains(&name.to_ascii_lowercase())
            || workload
                .id
                .to_ascii_lowercase()
                .contains(&name.to_ascii_lowercase());
        if ns_ok && name_ok {
            return true;
        }
    }
    attr_str(workload, "name").is_some_and(|name| name.eq_ignore_ascii_case(needle))
}

fn workload_is_deployment(workload: &Entity) -> bool {
    attr_str(workload, "kind").is_some_and(|kind| kind.eq_ignore_ascii_case("Deployment"))
        || workload.id.to_ascii_lowercase().contains(":deployment:")
        || workload
            .title
            .to_ascii_lowercase()
            .starts_with("deployment ")
}

fn build_links_to_workloads(build: &Entity, workloads: &[Entity]) -> bool {
    let (artifacts, _) = synthesize_artifacts_from_builds(std::slice::from_ref(build));
    !match_artifacts_to_workloads(&artifacts, workloads).is_empty()
}

fn change_matches_pr(entity: &Entity, needle: &str) -> bool {
    entity.id.to_ascii_lowercase().contains(needle)
        || entity.title.to_ascii_lowercase().contains(needle)
        || attr_str(entity, "iid").is_some_and(|v| v.to_ascii_lowercase() == *needle)
        || attr_str(entity, "id").is_some_and(|v| v.to_ascii_lowercase() == *needle)
        || attr_str(entity, "number").is_some_and(|v| v.to_ascii_lowercase() == *needle)
}

fn change_matches_branch(entity: &Entity, needle: &str) -> bool {
    for key in ["sourceBranch", "fromBranch", "branch"] {
        if attr_str(entity, key).is_some_and(|branch| branch.to_ascii_lowercase().contains(needle))
        {
            return true;
        }
    }
    entity.title.to_ascii_lowercase().contains(needle)
}

/// Shared SHA / artifact / workload assembly after the root seed selected its
/// changes (and optional issue).
fn assemble_trace(
    issue: Option<Entity>,
    changes: Vec<Entity>,
    bundle_commits: Vec<Entity>,
    bundle_builds: Vec<Entity>,
    bundle_artifacts: Vec<Entity>,
    bundle_workloads: Vec<Entity>,
    source_errors: Vec<SourceError>,
    issue_key_for_edges: Option<&str>,
) -> Trace {
    let mut shas: Vec<String> = changes.iter().filter_map(entity_sha).collect();

    // Issue/change seeds filter commits by mention or known SHAs. Commit/build
    // seeds pass an already-selected commit set when there is no change SHA yet.
    let commits: Vec<Entity> = if shas.is_empty() && issue_key_for_edges.is_none() {
        bundle_commits
    } else {
        bundle_commits
            .into_iter()
            .filter(|entity| {
                issue_key_for_edges
                    .is_some_and(|key| entity_mentions(entity, &key.to_ascii_lowercase()))
                    || entity_sha(entity).is_some_and(|sha| {
                        shas.iter().any(|known| sha_match(known, &sha).is_some())
                    })
            })
            .collect()
    };

    for commit in &commits {
        if let Some(sha) = entity_sha(commit) {
            if !shas.iter().any(|known| known == &sha) {
                shas.push(sha);
            }
        }
    }

    let builds: Vec<Entity> = if shas.is_empty() {
        // Build/commit anchors may select builds before any SHA is known.
        // Issue anchors with no SHA must not keep unrelated builds.
        if issue_key_for_edges.is_none() {
            bundle_builds
        } else {
            Vec::new()
        }
    } else {
        bundle_builds
            .into_iter()
            .filter(|entity| {
                entity_shas(entity)
                    .iter()
                    .any(|sha| shas.iter().any(|known| sha_match(known, sha).is_some()))
            })
            .collect()
    };

    for build in &builds {
        for sha in entity_shas(build) {
            if !shas.iter().any(|known| known == &sha) {
                shas.push(sha);
            }
        }
    }

    let (mut artifacts, produce_edges) = synthesize_artifacts_from_builds(&builds);
    for artifact in bundle_artifacts {
        if !artifacts.iter().any(|existing| existing.id == artifact.id) {
            artifacts.push(artifact);
        }
    }

    let all_workloads = bundle_workloads;
    let deploy_edges = match_artifacts_to_workloads(&artifacts, &all_workloads);
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
    if let (Some(issue), Some(issue_key)) = (&issue, issue_key_for_edges) {
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
            for build_sha in entity_shas(build) {
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
                    break;
                }
            }
        }
    }

    edges.extend(produce_edges);
    edges.extend(deploy_edges);

    let partial = !source_errors.is_empty();
    let derived = derive_chain(&nodes, &edges);
    Trace {
        nodes,
        edges,
        situations: derived.situations,
        verdict: derived.verdict,
        partial,
        source_errors,
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
        // Bare tags (no registry path) still become artifacts so DeployedTo can
        // match live workloads by `:{tag}` suffix.
        let bare_tag =
            !image_ref.contains('/') && !image_ref.contains('@') && !image_ref.contains(':');
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
            if bare_tag {
                obj.insert("tag".into(), json!(image_ref));
            } else {
                obj.insert("image".into(), json!(image_ref));
                if let Some(tag) = &tag {
                    obj.insert("tag".into(), json!(tag));
                }
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
    // Bare tag (Jenkins IMAGE_TAG / {build}-{env}) is enough for kube tag-suffix
    // fan-out and artifact↔workload matching; digest alone stays digest-only.
    tag.map(str::to_owned).or_else(|| digest.map(str::to_owned))
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
        if !needle.is_empty() && workload_images.iter().any(|image| image.contains(needle)) {
            return Some((Confidence::Exact, "image_digest_exact", needle.to_owned()));
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
                return Some((Confidence::Heuristic, "image_tag_short_sha", tag.to_owned()));
            }
        }
        return Some((Confidence::Strong, "image_tag_exact", image_ref));
    }

    if let Some(tag) = tag {
        if tag.len() >= 7 && looks_like_sha(tag) {
            if workload_images.iter().any(|image| {
                image
                    .to_ascii_lowercase()
                    .contains(&tag.to_ascii_lowercase())
            }) {
                return Some((Confidence::Heuristic, "image_tag_short_sha", tag.to_owned()));
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
    if let Some(arr) = entity
        .attributes
        .get("images")
        .and_then(|value| value.as_array())
    {
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
        || entity
            .id
            .to_ascii_lowercase()
            .contains(&issue_key.to_ascii_lowercase())
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
    entity_shas(entity).into_iter().next()
}

/// All SCM revisions known for an entity. Jenkins multi-checkout builds expose
/// several SHAs under `scmRevisions`; matching must consider every one.
fn entity_shas(entity: &Entity) -> Vec<String> {
    let mut out = Vec::new();
    let push = |out: &mut Vec<String>, sha: String| {
        if !sha.is_empty() && !out.iter().any(|known| known == &sha) {
            out.push(sha);
        }
    };
    if let Some(sha) = attr_str(entity, "sha") {
        push(&mut out, sha.to_owned());
    }
    if let Some(sha) = attr_str(entity, "scmRevision") {
        push(&mut out, sha.to_owned());
    }
    if let Some(arr) = entity
        .attributes
        .get("scmRevisions")
        .and_then(|value| value.as_array())
    {
        for item in arr {
            if let Some(sha) = item.as_str() {
                push(&mut out, sha.to_owned());
            }
        }
    }
    if out.is_empty() {
        // gitlab:commit:<project>:<sha> / bitbucket:commit:…:<sha>
        if let Some(tail) = entity
            .id
            .rsplit(':')
            .next()
            .filter(|tail| looks_like_sha(tail))
        {
            push(&mut out, tail.to_owned());
        }
    }
    out
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
    if shorter.len() >= 7
        && longer
            .to_ascii_lowercase()
            .starts_with(&shorter.to_ascii_lowercase())
    {
        Some(Confidence::Heuristic)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use srelens_devops_model::{EntityKind, Source};

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
        assert!(trace.situations.is_empty());
        assert!(trace.verdict.is_none());
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
                    && edge
                        .evidence
                        .iter()
                        .any(|e| e.kind == "image_tag_short_sha")
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

    #[test]
    fn bare_image_tag_is_enough_for_build_image_ref_and_runtime_join() {
        let trace = join_delivery_from_anchor(
            &DeliveryAnchor::Build {
                value: "expressbot:65".into(),
                source: Some("jenkins".into()),
            },
            DeliveryBundles {
                builds: vec![entity(
                    "jenkins:expressbot:65",
                    EntityKind::Build,
                    Source::Jenkins,
                    "expressbot #65",
                    json!({
                        "sha": "cicdsha0001",
                        "scmRevisions": ["cicdsha0001", "d7b2e66b6b397bcd"],
                        "imageTag": "65-dev",
                        "tag": "65-dev",
                    }),
                )],
                commits: vec![
                    entity(
                        "bitbucket:commit:CORP/cicd:cicdsha0001",
                        EntityKind::Commit,
                        Source::Bitbucket,
                        "cicd",
                        json!({ "sha": "cicdsha0001" }),
                    ),
                    entity(
                        "bitbucket:commit:CORP/expressbot:d7b2e66b6b397bcd",
                        EntityKind::Commit,
                        Source::Bitbucket,
                        "app",
                        json!({ "sha": "d7b2e66b6b397bcd" }),
                    ),
                ],
                workloads: vec![entity(
                    "k8s:deploy:expressbot-dev/expressbot-dev",
                    EntityKind::Workload,
                    Source::Kubernetes,
                    "expressbot-dev",
                    json!({
                        "images": ["p-doffice-docker.example/komusoffice/expressbot:65-dev"]
                    }),
                )],
                ..DeliveryBundles::default()
            },
        );

        assert!(trace.nodes.iter().any(|n| n.kind == EntityKind::Artifact));
        assert!(trace
            .nodes
            .iter()
            .any(|n| n.id == "k8s:deploy:expressbot-dev/expressbot-dev"));
        assert!(trace.edges.iter().any(|edge| {
            edge.relation == Relation::DeployedTo
                && edge.evidence.iter().any(|e| e.kind == "image_tag_exact")
        }));
        assert!(trace.edges.iter().any(|edge| {
            edge.relation == Relation::BuiltBy && edge.from.contains("expressbot:d7b2e66b6b397bcd")
        }));
        assert!(trace.edges.iter().any(|edge| {
            edge.relation == Relation::BuiltBy && edge.from.contains("cicd:cicdsha0001")
        }));
    }

    #[test]
    fn joins_from_pull_request_anchor_without_jira() {
        let trace = join_delivery_from_anchor(
            &DeliveryAnchor::PullRequest {
                value: "8821".into(),
                source: Some("bitbucket".into()),
            },
            DeliveryBundles {
                changes: vec![entity(
                    "bitbucket:pr:8821",
                    EntityKind::PullRequest,
                    Source::Bitbucket,
                    "PR #8821 cache",
                    json!({ "number": "8821", "sha": "55f93a0ce119aabb" }),
                )],
                commits: vec![entity(
                    "bitbucket:commit:x:55f93a0ce119aabb",
                    EntityKind::Commit,
                    Source::Bitbucket,
                    "55f93a0ce119aabb",
                    json!({ "sha": "55f93a0ce119aabb" }),
                )],
                builds: vec![entity(
                    "jenkins:checkout:4410",
                    EntityKind::Build,
                    Source::Jenkins,
                    "checkout #4410",
                    json!({ "sha": "55f93a0ce119aabb" }),
                )],
                issues: vec![entity(
                    "jira:issue:OTHER",
                    EntityKind::Issue,
                    Source::Jira,
                    "unrelated",
                    json!({ "key": "OTHER" }),
                )],
                ..DeliveryBundles::default()
            },
        );

        assert!(trace.nodes.iter().all(|n| n.kind != EntityKind::Issue));
        assert!(trace.nodes.iter().any(|n| n.id == "bitbucket:pr:8821"));
        assert!(trace.nodes.iter().any(|n| n.kind == EntityKind::Build));
        assert!(!trace.partial);
    }

    #[test]
    fn artifact_anchor_joins_from_digest_in_bundles() {
        let digest = "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        let trace = join_delivery_from_anchor(
            &DeliveryAnchor::Artifact {
                value: digest.into(),
                source: None,
            },
            DeliveryBundles {
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
                commits: vec![entity(
                    "gitlab:commit:p:aabbccddeeff0011",
                    EntityKind::Commit,
                    Source::Gitlab,
                    "aabbccddeeff0011",
                    json!({ "sha": "aabbccddeeff0011" }),
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
        assert!(trace.nodes.iter().any(|n| n.kind == EntityKind::Build));
        assert!(trace.nodes.iter().any(|n| n.kind == EntityKind::Workload));
        assert!(trace
            .edges
            .iter()
            .any(|edge| edge.relation == Relation::Produces));
        assert!(trace.edges.iter().any(|edge| {
            edge.relation == Relation::DeployedTo && edge.confidence == Confidence::Exact
        }));
        assert!(!trace.partial);
    }

    #[test]
    fn artifact_anchor_empty_bundles_is_partial_with_clear_error() {
        let trace = join_delivery_from_anchor(
            &DeliveryAnchor::Artifact {
                value: "sha256:abc".into(),
                source: None,
            },
            DeliveryBundles::default(),
        );
        assert!(trace.nodes.is_empty());
        assert!(trace.partial);
        assert_eq!(trace.source_errors[0].source, Source::Workspace);
        assert!(trace.source_errors[0]
            .message
            .contains("no artifact matching"));
        assert!(!trace.source_errors[0].message.contains("not supported yet"));
    }

    #[test]
    fn workload_anchor_joins_ns_name_and_reverse_image() {
        let digest = "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        let trace = join_delivery_from_anchor(
            &DeliveryAnchor::Workload {
                value: "payments/payments-api".into(),
                source: None,
            },
            DeliveryBundles {
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
                commits: vec![entity(
                    "gitlab:commit:p:aabbccddeeff0011",
                    EntityKind::Commit,
                    Source::Gitlab,
                    "aabbccddeeff0011",
                    json!({ "sha": "aabbccddeeff0011" }),
                )],
                workloads: vec![entity(
                    "runtime:prod-eu/payments/payments-api",
                    EntityKind::Workload,
                    Source::Kubernetes,
                    "Deployment payments/payments-api",
                    json!({
                        "cluster": "prod-eu",
                        "kind": "Deployment",
                        "namespace": "payments",
                        "name": "payments-api",
                        "images": [format!("registry.local/payments-api@{digest}")]
                    }),
                )],
                ..DeliveryBundles::default()
            },
        );

        assert!(trace
            .nodes
            .iter()
            .any(|n| n.id == "runtime:prod-eu/payments/payments-api"));
        assert!(trace.nodes.iter().any(|n| n.kind == EntityKind::Artifact));
        assert!(trace.nodes.iter().any(|n| n.kind == EntityKind::Build));
        assert!(trace
            .edges
            .iter()
            .any(|edge| edge.relation == Relation::DeployedTo));
        assert!(!trace.partial);
    }

    #[test]
    fn workload_anchor_empty_bundles_is_partial_with_clear_error() {
        let trace = join_delivery_from_anchor(
            &DeliveryAnchor::Workload {
                value: "payments/payments-api".into(),
                source: None,
            },
            DeliveryBundles::default(),
        );
        assert!(trace.nodes.is_empty());
        assert!(trace.partial);
        assert!(trace.source_errors[0]
            .message
            .contains("no workload matching"));
    }

    #[test]
    fn deployment_anchor_matches_deployment_workload() {
        let trace = join_delivery_from_anchor(
            &DeliveryAnchor::Deployment {
                value: "payments/payments-api".into(),
                source: None,
            },
            DeliveryBundles {
                workloads: vec![entity(
                    "runtime:prod/payments/payments-api",
                    EntityKind::Workload,
                    Source::Kubernetes,
                    "Deployment payments/payments-api",
                    json!({
                        "kind": "Deployment",
                        "namespace": "payments",
                        "name": "payments-api",
                        "images": ["registry.local/payments-api:v1"]
                    }),
                )],
                ..DeliveryBundles::default()
            },
        );

        assert_eq!(trace.nodes.len(), 1);
        assert_eq!(trace.nodes[0].id, "runtime:prod/payments/payments-api");
        assert!(!trace.partial);
    }

    #[test]
    fn assemble_derives_loud_situation_from_failed_pipeline() {
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
                    "gitlab:mr:721",
                    EntityKind::PullRequest,
                    Source::Gitlab,
                    "OPS-142",
                    json!({
                        "sourceBranch": "feature/OPS-142",
                        "sha": "aabbccddeeff0011",
                        "state": "merged"
                    }),
                )],
                commits: vec![entity(
                    "gitlab:commit:p:aabbccddeeff0011",
                    EntityKind::Commit,
                    Source::Gitlab,
                    "aabbccddeeff0011",
                    json!({ "sha": "aabbccddeeff0011" }),
                )],
                builds: vec![entity(
                    "gitlab:pipeline:9182",
                    EntityKind::Build,
                    Source::Gitlab,
                    "Pipeline #9182",
                    json!({ "sha": "aabbccddeeff0011", "status": "failed" }),
                )],
                source_errors: vec![SourceError {
                    source: Source::Kubernetes,
                    message: "context timed out".into(),
                }],
                ..DeliveryBundles::default()
            },
        );

        assert!(trace.partial);
        assert_eq!(trace.source_errors.len(), 1);
        assert!(
            trace
                .situations
                .iter()
                .any(|s| s.level == "loud" && s.label == "MR merged but pipeline failed"),
            "situations={:?}",
            trace.situations
        );
        assert_eq!(
            trace.verdict.as_ref().map(|v| v.severity.as_str()),
            Some("loud")
        );
        // Failed kube call must not invent a runtime situation.
        assert!(!trace.situations.iter().any(|s| s
            .label
            .to_ascii_lowercase()
            .contains("workload")
            || s.label.to_ascii_lowercase().contains("replica")));
    }
}
