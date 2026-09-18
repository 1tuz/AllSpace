use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};
use srelens_capability::{Annotations, Capability};
use srelens_devops_model::{
    DeliveryAnchor, DeliveryList, DeliverySummary, Entity, EntityKind, Source, SourceError, Trace,
};

use crate::join::{join_delivery_from_anchor, DeliveryBundles};
use crate::search::suggest_anchors;

/// Sibling list capabilities used to seed a bounded live Delivery index.
/// Each adapter stays registered on its own; this capability only joins what
/// they return. Unconfigured providers must not invent rows.
#[derive(Clone, Default)]
pub struct ListSourceCaps {
    pub jira_search: Option<Capability>,
    pub gitlab_mrs: Option<Capability>,
    pub gitlab_pipelines: Option<Capability>,
    pub bitbucket_prs: Option<Capability>,
    pub jenkins_builds: Option<Capability>,
}

/// Soft caps so a profile with broad filters cannot fan out unboundedly.
const PER_SOURCE_ENTITY_CAP: usize = 30;
const DEFAULT_LIST_LIMIT: usize = 40;
const MAX_LIST_LIMIT: usize = 80;
const MAX_JIRA_ENRICH_KEYS: usize = 15;
const MY_WORK_DELIVERED_CAP: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ListMode {
    /// All bounded live summaries (Deliveries browse).
    All,
    /// Actionable inbox + a few recent delivered rows (My Work).
    MyWork,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListDeliveriesIn {
    /// Cache / partition key for callers; live adapters still use the active
    /// profile connection. Different profileId must not share a client TTL hit.
    #[serde(default)]
    pub profile_id: Option<String>,
    /// Max delivery summaries to return (default 40, hard max 80).
    #[serde(default)]
    pub limit: Option<u32>,
}

/// Same wire shape as [`ListDeliveriesIn`] — My Work is a filtered view of the
/// same bounded live source.
pub type MyWorkIn = ListDeliveriesIn;

/// `devops.listDeliveries` — bounded live Delivery summaries from active
/// profile list capabilities (open/recent MRs, PRs, builds). Provider failures
/// become `sourceErrors` + `partial`.
pub fn list_deliveries_capability(sources: ListSourceCaps) -> Capability {
    Capability::typed::<ListDeliveriesIn, DeliveryList, _, _>(
        "devops.listDeliveries",
        "list bounded live delivery summaries from the active profile's Jira/GitLab/Bitbucket/Jenkins sources",
        Annotations::READ_ONLY,
        move |input| {
            let sources = sources.clone();
            async move { Ok(list_deliveries_live(&sources, &input, ListMode::All).await) }
        },
    )
}

/// `devops.myWork` — actionable / recent subset of the same live source as
/// `devops.listDeliveries`. Situations reuse `Trace.situations` when the join
/// derives them; otherwise the field stays empty for the situations agent.
pub fn my_work_capability(sources: ListSourceCaps) -> Capability {
    Capability::typed::<MyWorkIn, DeliveryList, _, _>(
        "devops.myWork",
        "list actionable and recent live delivery summaries for My Work (bounded)",
        Annotations::READ_ONLY,
        move |input| {
            let sources = sources.clone();
            async move { Ok(list_deliveries_live(&sources, &input, ListMode::MyWork).await) }
        },
    )
}

pub async fn list_deliveries_live(
    sources: &ListSourceCaps,
    input: &ListDeliveriesIn,
    mode: ListMode,
) -> DeliveryList {
    let _profile = input.profile_id.as_deref();
    let limit = resolve_limit(input.limit);
    let mut bundles = DeliveryBundles::default();
    let mut source_errors = Vec::new();

    if sources.gitlab_mrs.is_none()
        && sources.bitbucket_prs.is_none()
        && sources.jenkins_builds.is_none()
        && sources.gitlab_pipelines.is_none()
    {
        push_unique_error(
            &mut source_errors,
            SourceError {
                source: Source::Workspace,
                message:
                    "no live list providers registered; configure a DevOps profile for Live My Work"
                        .into(),
            },
        );
        return DeliveryList {
            deliveries: vec![],
            partial: true,
            source_errors,
        };
    }

    if let Some(cap) = &sources.gitlab_mrs {
        match call_entities(cap, json!({}), Source::Gitlab, "mergeRequests").await {
            Ok(entities) => {
                bundles
                    .changes
                    .extend(entities.into_iter().take(PER_SOURCE_ENTITY_CAP));
            }
            Err(error) => push_if_configured(&mut source_errors, error),
        }
    }

    if let Some(cap) = &sources.bitbucket_prs {
        match call_entities(cap, json!({}), Source::Bitbucket, "pullRequests").await {
            Ok(entities) => {
                bundles
                    .changes
                    .extend(entities.into_iter().take(PER_SOURCE_ENTITY_CAP));
            }
            Err(error) => push_if_configured(&mut source_errors, error),
        }
    }

    if let Some(cap) = &sources.gitlab_pipelines {
        match call_entities(cap, json!({}), Source::Gitlab, "entities").await {
            Ok(entities) => {
                bundles
                    .builds
                    .extend(entities.into_iter().take(PER_SOURCE_ENTITY_CAP));
            }
            Err(error) => push_if_configured(&mut source_errors, error),
        }
    }

    if let Some(cap) = &sources.jenkins_builds {
        match call_entities(cap, json!({}), Source::Jenkins, "builds").await {
            Ok(entities) => {
                bundles
                    .builds
                    .extend(entities.into_iter().take(PER_SOURCE_ENTITY_CAP));
            }
            Err(error) => push_if_configured(&mut source_errors, error),
        }
    }

    // Optional title enrichment for issue keys mentioned on changes — never
    // required for Komus (no Jira). Bounded key set only.
    if let Some(jira) = &sources.jira_search {
        let keys = collect_issue_keys(&bundles.changes, MAX_JIRA_ENRICH_KEYS);
        if !keys.is_empty() {
            match call_entities(jira, json!({ "issueKeys": keys }), Source::Jira, "issues").await {
                Ok(entities) => bundles.issues.extend(entities),
                Err(error) => push_if_configured(&mut source_errors, error),
            }
        }
    }

    let mut deliveries = summarize_bundles(&bundles, &source_errors);
    deliveries = match mode {
        ListMode::All => deliveries,
        ListMode::MyWork => filter_my_work(deliveries),
    };
    deliveries.truncate(limit);

    // Bounded list by design. A deferred full search fan-out is a product
    // ceiling, not a provider failure — do not push it into sourceErrors or
    // every Live screen reads as permanently broken.

    let partial = !source_errors.is_empty() || deliveries.iter().any(|row| row.partial);
    DeliveryList {
        deliveries,
        partial,
        source_errors,
    }
}

fn resolve_limit(limit: Option<u32>) -> usize {
    limit
        .map(|n| (n as usize).clamp(1, MAX_LIST_LIMIT))
        .unwrap_or(DEFAULT_LIST_LIMIT)
}

fn summarize_bundles(
    bundles: &DeliveryBundles,
    list_errors: &[SourceError],
) -> Vec<DeliverySummary> {
    let mut used_build_ids = std::collections::BTreeSet::new();
    let mut rows = Vec::new();

    for change in &bundles.changes {
        let Some(anchor) = change_anchor(change) else {
            continue;
        };
        let seed_bundles = DeliveryBundles {
            issues: bundles.issues.clone(),
            changes: vec![change.clone()],
            commits: bundles.commits.clone(),
            builds: bundles.builds.clone(),
            artifacts: bundles.artifacts.clone(),
            workloads: bundles.workloads.clone(),
            source_errors: list_errors.to_vec(),
        };
        let trace = join_delivery_from_anchor(&anchor, seed_bundles);
        for node in &trace.nodes {
            if node.kind == EntityKind::Build {
                used_build_ids.insert(node.id.clone());
            }
        }
        rows.push(summary_from_trace(change, &anchor, &trace, list_errors));
    }

    for build in &bundles.builds {
        if used_build_ids.contains(&build.id) {
            continue;
        }
        let Some(anchor) = build_anchor(build) else {
            continue;
        };
        let seed_bundles = DeliveryBundles {
            issues: bundles.issues.clone(),
            changes: bundles.changes.clone(),
            commits: bundles.commits.clone(),
            builds: vec![build.clone()],
            artifacts: bundles.artifacts.clone(),
            workloads: bundles.workloads.clone(),
            source_errors: list_errors.to_vec(),
        };
        let trace = join_delivery_from_anchor(&anchor, seed_bundles);
        rows.push(summary_from_trace(build, &anchor, &trace, list_errors));
    }

    sort_summaries(&mut rows);
    rows
}

fn summary_from_trace(
    seed: &Entity,
    anchor: &DeliveryAnchor,
    trace: &Trace,
    list_errors: &[SourceError],
) -> DeliverySummary {
    let (stage, stage_label) = stage_from_seed_and_trace(seed, trace);
    let work_id = work_id_from_seed(seed, &trace.nodes);
    let title = if let Some(issue) = trace
        .nodes
        .iter()
        .find(|node| node.kind == EntityKind::Issue)
    {
        issue.title.clone()
    } else {
        seed.title.clone()
    };
    let mut source_errors = list_errors.to_vec();
    for error in &trace.source_errors {
        push_unique_error(&mut source_errors, error.clone());
    }
    DeliverySummary {
        id: seed.id.clone(),
        anchor: anchor.clone(),
        title,
        work_id,
        stage,
        stage_label,
        updated: attr_str(seed, "updated").map(str::to_owned),
        // Reuse join-derived situations / verdict from derive_chain.
        situations: trace.situations.clone(),
        verdict: trace.verdict.clone(),
        partial: trace.partial || !list_errors.is_empty(),
        source_errors,
    }
}

fn stage_from_seed_and_trace(seed: &Entity, trace: &Trace) -> (String, String) {
    let build_status = trace
        .nodes
        .iter()
        .filter(|node| node.kind == EntityKind::Build)
        .filter_map(|node| attr_str(node, "status").map(str::to_ascii_lowercase))
        .collect::<Vec<_>>();

    if build_status
        .iter()
        .any(|s| s == "failed" || s == "failure" || s == "canceled" || s == "cancelled")
    {
        return ("attention".into(), "Build failed".into());
    }
    if build_status
        .iter()
        .any(|s| s == "building" || s == "running" || s == "pending" || s == "created")
    {
        return ("building".into(), "Building".into());
    }

    match seed.kind {
        EntityKind::PullRequest => {
            let state = attr_str(seed, "state").unwrap_or("").to_ascii_lowercase();
            if state == "opened" || state == "open" {
                ("in_review".into(), "Change in review".into())
            } else if state == "merged" || state == "closed" {
                if build_status
                    .iter()
                    .any(|s| s == "success" || s == "successful")
                {
                    ("delivered".into(), "Merged".into())
                } else {
                    ("in_progress".into(), "Merged".into())
                }
            } else {
                ("in_progress".into(), seed.title.clone())
            }
        }
        EntityKind::Build => {
            let status = attr_str(seed, "status")
                .unwrap_or("unknown")
                .to_ascii_lowercase();
            if status == "building" || status == "running" {
                ("building".into(), "Building".into())
            } else if status == "failed" || status == "failure" {
                ("attention".into(), "Build failed".into())
            } else if status == "success" || status == "successful" {
                ("delivered".into(), "Build succeeded".into())
            } else {
                ("in_progress".into(), format!("Build {status}"))
            }
        }
        EntityKind::Issue => ("in_progress".into(), "In progress".into()),
        _ => ("in_progress".into(), seed.title.clone()),
    }
}

fn work_id_from_seed(seed: &Entity, nodes: &[Entity]) -> Option<String> {
    if let Some(issue) = nodes.iter().find(|node| node.kind == EntityKind::Issue) {
        if let Some(key) = attr_str(issue, "key") {
            return Some(key.to_ascii_uppercase());
        }
        if let Some(key) = issue.id.strip_prefix("jira:issue:") {
            return Some(key.to_ascii_uppercase());
        }
        if let Some(key) = issue.id.strip_prefix("jira:") {
            return Some(key.to_ascii_uppercase());
        }
    }
    collect_issue_keys(std::slice::from_ref(seed), 1)
        .into_iter()
        .next()
}

fn change_anchor(change: &Entity) -> Option<DeliveryAnchor> {
    let source = match change.source {
        Source::Gitlab => Some("gitlab".into()),
        Source::Bitbucket => Some("bitbucket".into()),
        _ => None,
    };
    if let Some(iid) = attr_str(change, "iid").or_else(|| attr_str(change, "pullRequestId")) {
        return Some(DeliveryAnchor::PullRequest {
            value: iid.to_string(),
            source,
        });
    }
    // Fall back to the trailing numeric / id segment of the entity id.
    let value = change.id.rsplit(':').next()?.to_string();
    if value.is_empty() {
        return None;
    }
    Some(DeliveryAnchor::PullRequest { value, source })
}

fn build_anchor(build: &Entity) -> Option<DeliveryAnchor> {
    let source = match build.source {
        Source::Gitlab => Some("gitlab".into()),
        Source::Jenkins => Some("jenkins".into()),
        _ => None,
    };
    let value = attr_str(build, "pipelineId")
        .or_else(|| attr_str(build, "number"))
        .map(str::to_string)
        .or_else(|| build.id.rsplit(':').next().map(str::to_string))?;
    Some(DeliveryAnchor::Build { value, source })
}

fn collect_issue_keys(entities: &[Entity], max: usize) -> Vec<String> {
    let mut keys = Vec::new();
    for entity in entities {
        let mut haystacks = vec![entity.title.clone(), entity.id.clone()];
        if let Some(branch) =
            attr_str(entity, "sourceBranch").or_else(|| attr_str(entity, "fromBranch"))
        {
            haystacks.push(branch.to_string());
        }
        for haystack in haystacks {
            for anchor in suggest_anchors(&haystack) {
                if let DeliveryAnchor::Issue { value, .. } = anchor {
                    let key = value.to_ascii_uppercase();
                    if !keys.iter().any(|existing| existing == &key) {
                        keys.push(key);
                        if keys.len() >= max {
                            return keys;
                        }
                    }
                }
            }
        }
    }
    keys
}

fn filter_my_work(rows: Vec<DeliverySummary>) -> Vec<DeliverySummary> {
    let mut actionable = Vec::new();
    let mut delivered = Vec::new();
    for row in rows {
        match row.stage.as_str() {
            "delivered" => delivered.push(row),
            _ => actionable.push(row),
        }
    }
    delivered.truncate(MY_WORK_DELIVERED_CAP);
    actionable.extend(delivered);
    actionable
}

fn sort_summaries(rows: &mut [DeliverySummary]) {
    rows.sort_by(|a, b| {
        stage_rank(&a.stage)
            .cmp(&stage_rank(&b.stage))
            .then_with(|| a.id.cmp(&b.id))
    });
}

fn stage_rank(stage: &str) -> u8 {
    match stage {
        "attention" => 0,
        "building" | "deploying" => 1,
        "in_review" => 2,
        "in_progress" => 3,
        "delivered" => 4,
        _ => 5,
    }
}

fn attr_str<'a>(entity: &'a Entity, key: &str) -> Option<&'a str> {
    entity.attributes.get(key).and_then(|value| value.as_str())
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

fn push_unique_error(errors: &mut Vec<SourceError>, error: SourceError) {
    if errors
        .iter()
        .any(|existing| existing.source == error.source && existing.message == error.message)
    {
        return;
    }
    errors.push(error);
}

fn push_if_configured(errors: &mut Vec<SourceError>, error: SourceError) {
    if !error.message.contains("does not configure the ") {
        push_unique_error(errors, error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use srelens_capability::CapabilityError;

    #[test]
    fn list_deliveries_in_deserializes_caller_camel_case() {
        let input: ListDeliveriesIn = serde_json::from_value(json!({
            "profileId": "appfarm",
            "limit": 12,
        }))
        .expect("camelCase");
        assert_eq!(input.profile_id.as_deref(), Some("appfarm"));
        assert_eq!(input.limit, Some(12));
    }

    #[test]
    fn list_deliveries_in_rejects_snake_case_profile_id() {
        let err = serde_json::from_value::<ListDeliveriesIn>(json!({
            "profile_id": "appfarm",
        }));
        assert!(err.is_err(), "snake_case must not deserialize");
    }

    #[tokio::test]
    async fn empty_sources_stay_partial_and_empty() {
        let out = list_deliveries_live(
            &ListSourceCaps::default(),
            &ListDeliveriesIn {
                profile_id: Some("appfarm".into()),
                limit: None,
            },
            ListMode::All,
        )
        .await;
        assert!(out.deliveries.is_empty());
        assert!(out.partial);
        assert!(out
            .source_errors
            .iter()
            .any(|error| error.source == Source::Workspace));
    }

    #[tokio::test]
    async fn gitlab_mrs_become_delivery_summaries_with_anchors() {
        let gitlab = Capability::read_only("gitlab.listMergeRequests", "", |_| async {
            Ok(json!({
                "mergeRequests": [{
                    "id": "gitlab:merge-request:7:721",
                    "kind": "pullRequest",
                    "source": "gitlab",
                    "title": "OPS-142 retry worker",
                    "url": null,
                    "attributes": {
                        "iid": 721,
                        "state": "opened",
                        "sourceBranch": "feature/OPS-142-retry",
                        "sha": "92ac41f7d2ab"
                    }
                }],
                "projects": ["payments-api"]
            }))
        });
        let out = list_deliveries_live(
            &ListSourceCaps {
                gitlab_mrs: Some(gitlab),
                ..Default::default()
            },
            &ListDeliveriesIn {
                profile_id: Some("appfarm".into()),
                limit: Some(10),
            },
            ListMode::All,
        )
        .await;

        assert_eq!(out.deliveries.len(), 1);
        assert_eq!(out.deliveries[0].id, "gitlab:merge-request:7:721");
        assert_eq!(out.deliveries[0].work_id.as_deref(), Some("OPS-142"));
        assert_eq!(out.deliveries[0].stage, "in_review");
        assert_eq!(
            out.deliveries[0].anchor,
            DeliveryAnchor::PullRequest {
                value: "721".into(),
                source: Some("gitlab".into()),
            }
        );
        // A successful provider answer is complete for this bounded list — a
        // deferred fan-out is not a source failure and must not force partial.
        assert!(!out.partial);
        assert!(out
            .source_errors
            .iter()
            .all(|error| error.source != Source::Workspace
                || !error.message.contains("full search fan-out")));
        // Situations / verdict come from Trace.join → derive_chain.
        assert!(out.deliveries[0]
            .situations
            .iter()
            .all(|s| !s.label.is_empty()));
    }

    #[tokio::test]
    async fn provider_failure_records_source_error_without_inventing_rows() {
        let gitlab = Capability::read_only("gitlab.listMergeRequests", "", |_| async {
            Err(CapabilityError::Handler("request timed out".into()))
        });
        let out = list_deliveries_live(
            &ListSourceCaps {
                gitlab_mrs: Some(gitlab),
                ..Default::default()
            },
            &ListDeliveriesIn {
                profile_id: Some("appfarm".into()),
                limit: None,
            },
            ListMode::All,
        )
        .await;
        assert!(out.deliveries.is_empty());
        assert!(out.partial);
        assert!(out
            .source_errors
            .iter()
            .any(|error| error.source == Source::Gitlab
                && error.message.contains("request timed out")));
    }

    #[tokio::test]
    async fn unconfigured_provider_does_not_fake_source_error() {
        let bitbucket = Capability::read_only("bitbucket.listPullRequests", "", |_| async {
            Err(CapabilityError::Handler(
                "profile appfarm does not configure the bitbucketDc provider".into(),
            ))
        });
        let gitlab = Capability::read_only("gitlab.listMergeRequests", "", |_| async {
            Ok(json!({ "mergeRequests": [], "projects": [] }))
        });
        let out = list_deliveries_live(
            &ListSourceCaps {
                gitlab_mrs: Some(gitlab),
                bitbucket_prs: Some(bitbucket),
                ..Default::default()
            },
            &ListDeliveriesIn {
                profile_id: Some("appfarm".into()),
                limit: None,
            },
            ListMode::All,
        )
        .await;
        assert!(!out
            .source_errors
            .iter()
            .any(|error| error.source == Source::Bitbucket));
    }

    #[tokio::test]
    async fn my_work_filters_out_bulk_delivered_keeps_attention() {
        let jenkins = Capability::read_only("jenkins.listBuilds", "", |_| async {
            Ok(json!({
                "builds": [
                    {
                        "id": "jenkins:payments-api/main:1",
                        "kind": "build",
                        "source": "jenkins",
                        "title": "payments-api/main #1",
                        "url": null,
                        "attributes": { "number": "1", "status": "FAILURE" }
                    },
                    {
                        "id": "jenkins:payments-api/main:2",
                        "kind": "build",
                        "source": "jenkins",
                        "title": "payments-api/main #2",
                        "url": null,
                        "attributes": { "number": "2", "status": "SUCCESS" }
                    }
                ],
                "jobs": ["payments-api/main"]
            }))
        });
        let all = list_deliveries_live(
            &ListSourceCaps {
                jenkins_builds: Some(jenkins.clone()),
                ..Default::default()
            },
            &ListDeliveriesIn {
                profile_id: Some("komus".into()),
                limit: Some(20),
            },
            ListMode::All,
        )
        .await;
        let mine = list_deliveries_live(
            &ListSourceCaps {
                jenkins_builds: Some(jenkins),
                ..Default::default()
            },
            &ListDeliveriesIn {
                profile_id: Some("komus".into()),
                limit: Some(20),
            },
            ListMode::MyWork,
        )
        .await;

        assert!(all.deliveries.len() >= 2);
        assert!(mine.deliveries.iter().any(|row| row.stage == "attention"));
        // Delivered rows may appear but are capped; attention must sort first.
        assert_eq!(mine.deliveries[0].stage, "attention");
    }

    #[tokio::test]
    async fn different_profile_id_is_accepted_for_cache_partitioning() {
        // Handlers do not key on profileId today (active connection does), but
        // the wire field must deserialize so core can partition TTL caches.
        let gitlab = Capability::read_only("gitlab.listMergeRequests", "", |_| async {
            Ok(json!({ "mergeRequests": [], "projects": [] }))
        });
        let a = list_deliveries_live(
            &ListSourceCaps {
                gitlab_mrs: Some(gitlab.clone()),
                ..Default::default()
            },
            &ListDeliveriesIn {
                profile_id: Some("appfarm".into()),
                limit: Some(5),
            },
            ListMode::MyWork,
        )
        .await;
        let b = list_deliveries_live(
            &ListSourceCaps {
                gitlab_mrs: Some(gitlab),
                ..Default::default()
            },
            &ListDeliveriesIn {
                profile_id: Some("komus".into()),
                limit: Some(5),
            },
            ListMode::MyWork,
        )
        .await;
        // Empty successful answers — not partial just because fan-out is deferred.
        assert!(!a.partial);
        assert!(!b.partial);
    }

    #[test]
    fn delivery_summary_serializes_camel_case() {
        let summary = DeliverySummary {
            id: "gitlab:merge-request:7:1".into(),
            anchor: DeliveryAnchor::PullRequest {
                value: "1".into(),
                source: Some("gitlab".into()),
            },
            title: "fix".into(),
            work_id: Some("OPS-1".into()),
            stage: "in_review".into(),
            stage_label: "Change in review".into(),
            updated: None,
            situations: vec![],
            verdict: None,
            partial: false,
            source_errors: vec![],
        };
        let value = serde_json::to_value(&summary).unwrap();
        assert!(value.get("workId").is_some());
        assert!(value.get("stageLabel").is_some());
        assert!(value.get("sourceErrors").is_some());
        assert!(value.get("work_id").is_none());
    }
}
