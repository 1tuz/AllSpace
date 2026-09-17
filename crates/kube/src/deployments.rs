//! The `k8s.listDeployments` capability.

use std::sync::Arc;

use srelens_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::apps::v1::{Deployment, ReplicaSet};
use kube::api::ListParams;
use kube::Api;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListDeploymentsIn {
    pub context: String,
    pub namespace: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct DeploymentSummary {
    pub name: String,
    pub namespace: String,
    pub ready: String,
    #[serde(rename = "upToDate")]
    pub up_to_date: i32,
    pub available: i32,
    /// `creationTimestamp` (RFC 3339), so the frontend can derive a LIVE age.
    /// `age` below is rendered once, when this summary is built, and only
    /// rebuilt when a watch event arrives — so it goes stale (#405).
    pub created: Option<String>,
    pub age: String,
    /// Raw ISO 8601 timestamp `age` derives from, so UIs can recompute the
    /// age live at render time. Empty when the resource carries none.
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ListDeploymentsOut {
    pub deployments: Vec<DeploymentSummary>,
}

/// Read-only runtime join input. `images` are OCI references derived from a
/// delivery trace; `namespaces` is optional and never broadens a caller's RBAC.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListDeploymentsByImageIn {
    pub context: String,
    pub images: Vec<String>,
    #[serde(default)]
    pub namespaces: Vec<String>,
}

/// The minimum runtime evidence needed by the delivery correlation layer.
/// Values are only workload metadata and image references — never manifests,
/// environment, or Secret data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentImageMatch {
    pub name: String,
    pub namespace: String,
    pub ready: String,
    pub images: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ListDeploymentsByImageOut {
    pub deployments: Vec<DeploymentImageMatch>,
}

fn deployment_images(deployment: &Deployment) -> Vec<String> {
    deployment
        .spec
        .as_ref()
        .and_then(|spec| spec.template.spec.as_ref())
        .map(|spec| {
            spec.containers
                .iter()
                .chain(spec.init_containers.iter().flatten())
                .filter_map(|container| container.image.clone())
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn deployment_image_match(deployment: &Deployment, images: &[String]) -> Option<DeploymentImageMatch> {
    let matched: Vec<String> = deployment_images(deployment)
        .into_iter()
        .filter(|image| images.iter().any(|candidate| candidate == image))
        .collect();
    if matched.is_empty() {
        return None;
    }
    let summary = summarise(deployment.clone());
    Some(DeploymentImageMatch {
        name: summary.name,
        namespace: summary.namespace,
        ready: summary.ready,
        images: matched,
    })
}

/// `k8s.listDeploymentsByImage` — find live Deployments whose pod templates
/// use one of the trace's OCI image references. This is deliberately an
/// explicit context-scoped fan-out; it never picks a cluster implicitly.
pub fn list_deployments_by_image_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListDeploymentsByImageIn, ListDeploymentsByImageOut, _, _>(
        "k8s.listDeploymentsByImage",
        "list deployments in one connected kube context that use supplied OCI image references",
        Annotations::READ_ONLY,
        move |input: ListDeploymentsByImageIn| {
            let cache = cache.clone();
            async move {
                if input.images.is_empty() {
                    return Ok(ListDeploymentsByImageOut { deployments: vec![] });
                }
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Deployment> = Api::all(client);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list deployments by image timed out".into()))?
                    .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                let deployments = list
                    .items
                    .iter()
                    .filter(|deployment| input.namespaces.is_empty() || deployment.metadata.namespace.as_ref().is_some_and(|namespace| input.namespaces.contains(namespace)))
                    .filter_map(|deployment| deployment_image_match(deployment, &input.images))
                    .collect();
                Ok(ListDeploymentsByImageOut { deployments })
            }
        },
    )
}

pub(crate) fn summarise(dep: Deployment) -> DeploymentSummary {
    let name = dep.metadata.name.clone().unwrap_or_default();
    let namespace = dep.metadata.namespace.clone().unwrap_or_default();
    let desired = dep.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
    let status = dep.status.as_ref();
    let ready = status.and_then(|s| s.ready_replicas).unwrap_or(0);
    let up_to_date = status.and_then(|s| s.updated_replicas).unwrap_or(0);
    let available = status.and_then(|s| s.available_replicas).unwrap_or(0);
    DeploymentSummary {
        name,
        namespace,
        ready: format!("{ready}/{desired}"),
        up_to_date,
        available,
        created: crate::creation_rfc3339(dep.metadata.creation_timestamp.as_ref()),
        age: crate::humanize_age(dep.metadata.creation_timestamp.as_ref()),
        created_at: crate::creation_timestamp_iso(dep.metadata.creation_timestamp.as_ref()),
    }
}

/// `k8s.listDeployments` — list deployments in a namespace.
pub fn list_deployments_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListDeploymentsIn, ListDeploymentsOut, _, _>(
        "k8s.listDeployments",
        "list deployments in a namespace of a connected kube context",
        Annotations::READ_ONLY,
        move |input: ListDeploymentsIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Deployment> = crate::scoped_api(client, &input.namespace);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list deployments timed out".into()))?
                    .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                Ok(ListDeploymentsOut {
                    deployments: list.items.into_iter().map(summarise).collect(),
                })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListReplicaSetsIn {
    pub context: String,
    pub namespace: String,
    /// Name of the owning Deployment; only ReplicaSets it owns are returned.
    #[serde(rename = "ownerName")]
    pub owner_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct ReplicaSetSummary {
    pub name: String,
    /// `deployment.kubernetes.io/revision`, or "" if unset.
    pub revision: String,
    pub desired: i32,
    pub ready: i32,
    pub current: i32,
    /// `creationTimestamp` (RFC 3339), so the frontend can derive a LIVE age.
    /// `age` below is rendered once, when this summary is built, and only
    /// rebuilt when a watch event arrives — so it goes stale (#405).
    pub created: Option<String>,
    pub age: String,
    /// Raw ISO 8601 timestamp `age` derives from, so UIs can recompute the
    /// age live at render time. Empty when the resource carries none.
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListReplicaSetsOut {
    pub replicasets: Vec<ReplicaSetSummary>,
}

fn owned_by(rs: &ReplicaSet, deployment: &str) -> bool {
    rs.metadata
        .owner_references
        .iter()
        .flatten()
        .any(|o| o.kind == "Deployment" && o.name == deployment)
}

pub(crate) fn summarise_rs(rs: ReplicaSet) -> ReplicaSetSummary {
    let revision = rs
        .metadata
        .annotations
        .as_ref()
        .and_then(|a| a.get("deployment.kubernetes.io/revision").cloned())
        .unwrap_or_default();
    let desired = rs.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
    let status = rs.status.as_ref();
    let ready = status.and_then(|s| s.ready_replicas).unwrap_or(0);
    let current = status.map(|s| s.replicas).unwrap_or(0);
    ReplicaSetSummary {
        name: rs.metadata.name.clone().unwrap_or_default(),
        revision,
        desired,
        ready,
        current,
        created: crate::creation_rfc3339(rs.metadata.creation_timestamp.as_ref()),
        age: crate::humanize_age(rs.metadata.creation_timestamp.as_ref()),
        created_at: crate::creation_timestamp_iso(rs.metadata.creation_timestamp.as_ref()),
    }
}

/// `k8s.listReplicaSets` — ReplicaSets owned by a Deployment, newest revision
/// first. Powers the "Deploy Revisions" section of the deployment detail.
pub fn list_replicasets_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListReplicaSetsIn, ListReplicaSetsOut, _, _>(
        "k8s.listReplicaSets",
        "list the ReplicaSets owned by a Deployment (its rollout revisions)",
        Annotations::READ_ONLY,
        move |input: ListReplicaSetsIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<ReplicaSet> = crate::scoped_api(client, &input.namespace);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list replicasets timed out".into()))?
                    .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                let mut replicasets: Vec<ReplicaSetSummary> = list
                    .items
                    .into_iter()
                    .filter(|rs| owned_by(rs, &input.owner_name))
                    .map(summarise_rs)
                    .collect();
                // Newest revision first (numeric where possible).
                replicasets.sort_by(|a, b| {
                    let pa = a.revision.parse::<i64>().unwrap_or(0);
                    let pb = b.revision.parse::<i64>().unwrap_or(0);
                    pb.cmp(&pa)
                });
                Ok(ListReplicaSetsOut { replicasets })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use k8s_openapi::api::apps::v1::{
        DeploymentSpec, DeploymentStatus, ReplicaSetSpec, ReplicaSetStatus,
    };
    use k8s_openapi::api::core::v1::{Container, PodSpec, PodTemplateSpec};
    use std::path::PathBuf;

    #[test]
    fn capability_has_expected_id() {
        let cap = list_deployments_capability(ClientCache::new(PathBuf::from("/x")));
        assert_eq!(cap.id, "k8s.listDeployments");
        assert!(cap.annotations.read_only);
    }

    #[test]
    fn summarises_ready_ratio() {
        let dep = Deployment {
            metadata: kube::core::ObjectMeta {
                name: Some("web".into()),
                namespace: Some("default".into()),
                ..Default::default()
            },
            spec: Some(DeploymentSpec {
                replicas: Some(3),
                ..Default::default()
            }),
            status: Some(DeploymentStatus {
                ready_replicas: Some(2),
                updated_replicas: Some(3),
                available_replicas: Some(2),
                ..Default::default()
            }),
        };
        let s = summarise(dep);
        assert_eq!(s.ready, "2/3");
        assert_eq!(s.up_to_date, 3);
        assert_eq!(s.available, 2);
    }

    #[test]
    fn finds_deployment_by_container_or_init_container_image() {
        let deployment = Deployment {
            metadata: kube::core::ObjectMeta {
                name: Some("payments-api".into()),
                namespace: Some("payments".into()),
                ..Default::default()
            },
            spec: Some(DeploymentSpec {
                template: PodTemplateSpec {
                    spec: Some(PodSpec {
                        containers: vec![Container { image: Some("registry.example/payments:v42".into()), ..Default::default() }],
                        init_containers: Some(vec![Container { image: Some("registry.example/migrate@sha256:abc".into()), ..Default::default() }]),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                ..Default::default()
            }),
            ..Default::default()
        };

        let result = deployment_image_match(&deployment, &["registry.example/migrate@sha256:abc".into()]);
        assert_eq!(result.as_ref().map(|match_| match_.name.as_str()), Some("payments-api"));
        assert_eq!(result.map(|match_| match_.images), Some(vec!["registry.example/migrate@sha256:abc".into()]));
    }

    #[tokio::test]
    #[ignore = "requires SRELENS_E2E_CONTEXT and a reachable kubeconfig"]
    async fn live_capability_returns_the_deployment_for_its_own_image() {
        let context = std::env::var("SRELENS_E2E_CONTEXT").expect("SRELENS_E2E_CONTEXT");
        let kubeconfig = std::env::var("KUBECONFIG").expect("KUBECONFIG");
        let cache = ClientCache::new(PathBuf::from(kubeconfig));
        let client = cache.get(&context).await.expect("live kube client");
        let api: Api<Deployment> = Api::all(client);
        let deployment = api
            .list(&ListParams::default())
            .await
            .expect("list live deployments")
            .items
            .into_iter()
            .find(|deployment| !deployment_images(deployment).is_empty())
            .expect("at least one deployment with an image");
        let images = deployment_images(&deployment);
        let expected_name = deployment.metadata.name.clone().expect("deployment name");
        let expected_namespace = deployment.metadata.namespace.clone().expect("deployment namespace");
        let output = (list_deployments_by_image_capability(cache).handler)(serde_json::json!({
            "context": context,
            "images": images,
            "namespaces": [expected_namespace],
        }))
        .await
        .expect("live listDeploymentsByImage");
        let matches: ListDeploymentsByImageOut = serde_json::from_value(output).expect("capability schema");
        assert!(matches.deployments.iter().any(|deployment| deployment.name == expected_name));
    }

    fn replicaset(name: &str, owner: &str, revision: &str) -> ReplicaSet {
        let mut annotations = std::collections::BTreeMap::new();
        annotations.insert("deployment.kubernetes.io/revision".to_string(), revision.to_string());
        ReplicaSet {
            metadata: kube::core::ObjectMeta {
                name: Some(name.into()),
                annotations: Some(annotations),
                owner_references: Some(vec![k8s_openapi::apimachinery::pkg::apis::meta::v1::OwnerReference {
                    kind: "Deployment".into(),
                    name: owner.into(),
                    ..Default::default()
                }]),
                ..Default::default()
            },
            spec: Some(ReplicaSetSpec {
                replicas: Some(1),
                ..Default::default()
            }),
            status: Some(ReplicaSetStatus {
                replicas: 1,
                ready_replicas: Some(1),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn replicaset_capability_has_expected_id() {
        let cap = list_replicasets_capability(ClientCache::new(PathBuf::from("/x")));
        assert_eq!(cap.id, "k8s.listReplicaSets");
        assert!(cap.annotations.read_only);
    }

    #[test]
    fn ownership_matches_only_named_deployment() {
        let rs = replicaset("web-abc", "web", "3");
        assert!(owned_by(&rs, "web"));
        assert!(!owned_by(&rs, "other"));
    }

    #[test]
    fn summarises_replicaset_revision_and_pods() {
        let s = summarise_rs(replicaset("web-abc", "web", "5"));
        assert_eq!(s.name, "web-abc");
        assert_eq!(s.revision, "5");
        assert_eq!(s.desired, 1);
        assert_eq!(s.ready, 1);
        assert_eq!(s.current, 1);
    }
}
