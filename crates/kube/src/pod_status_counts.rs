//! `k8s.podStatusCounts` — pod counts by phase for one context.
//!
//! Counts only: five metadata-only field-selector lists (no pod bodies).
//! A timeout or transport failure is an error, never a row of zeros — same
//! honesty contract as [`crate::pod_count`].

use std::sync::Arc;
use std::time::Duration;

use k8s_openapi::api::core::v1::Pod;
use kube::api::{Api, ListParams};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use srelens_capability::{Annotations, Capability, CapabilityError};

use crate::client_cache::ClientCache;

/// Same short budget as [`crate::pod_count::POD_COUNT_TIMEOUT`]: Fleet-style
/// screens load several clusters; a slow one must fail fast, not paint zeros.
pub const POD_STATUS_COUNTS_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PodStatusCountsIn {
    pub context: String,
}

/// Phase tallies. Kubernetes defines five Pod phases; anything else is
/// [`Self::other`] (normally zero — kept so a weird apiserver answer is not
/// silently dropped into another bucket).
#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct PodStatusCountsOut {
    pub pending: i64,
    pub running: i64,
    pub succeeded: i64,
    pub failed: i64,
    pub unknown: i64,
    /// Pods whose phase is none of the five named above.
    pub other: i64,
}

async fn count_phase(api: &Api<Pod>, phase: &str) -> Result<i64, String> {
    let params = ListParams::default().fields(&format!("status.phase={phase}"));
    let list = api
        .list_metadata(&params)
        .await
        .map_err(|e| e.to_string())?;
    Ok(list.items.len() as i64)
}

/// All pods, metadata-only — denominator for [`PodStatusCountsOut::other`].
async fn count_all(api: &Api<Pod>) -> Result<i64, String> {
    let list = api
        .list_metadata(&ListParams::default())
        .await
        .map_err(|e| e.to_string())?;
    Ok(list.items.len() as i64)
}

/// Six concurrent metadata-only lists under one timeout. Named phases come
/// from field selectors; `other` is `all − sum(named)`, clamped at zero so a
/// race between the six moments never invents a negative bucket.
async fn count_by_phase(
    client: kube::Client,
    timeout: Duration,
) -> Result<PodStatusCountsOut, String> {
    let api: Api<Pod> = Api::all(client);
    let fut = async {
        // futures only ships try_join‥try_join5; nest the sixth.
        let ((pending, running, succeeded, failed, unknown), all) = futures::future::try_join(
            futures::future::try_join5(
                count_phase(&api, "Pending"),
                count_phase(&api, "Running"),
                count_phase(&api, "Succeeded"),
                count_phase(&api, "Failed"),
                count_phase(&api, "Unknown"),
            ),
            count_all(&api),
        )
        .await?;
        let named = pending + running + succeeded + failed + unknown;
        let other = (all - named).max(0);
        Ok::<_, String>(PodStatusCountsOut {
            pending,
            running,
            succeeded,
            failed,
            unknown,
            other,
        })
    };
    tokio::time::timeout(timeout, fut)
        .await
        .map_err(|_| "pod status counts timed out".to_string())?
}

/// `k8s.podStatusCounts` — phase distribution counts, never pod bodies.
pub fn pod_status_counts_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<PodStatusCountsIn, PodStatusCountsOut, _, _>(
        "k8s.podStatusCounts",
        "pod counts by phase for a cluster, counted without listing pod bodies",
        Annotations::READ_ONLY,
        move |input: PodStatusCountsIn| {
            let cache = cache.clone();
            async move {
                let client = cache.get(&input.context).await.map_err(CapabilityError::Handler)?;
                count_by_phase(client, POD_STATUS_COUNTS_TIMEOUT)
                    .await
                    .map_err(CapabilityError::Handler)
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn pod_status_counts_capability_has_id() {
        let cache = ClientCache::new(PathBuf::from("/x"));
        assert_eq!(pod_status_counts_capability(cache).id, "k8s.podStatusCounts");
    }

    /// Caller wire spelling — `@srelens/core` sends camelCase JSON. `context`
    /// is one word, so this is the same string either way; the assert pins
    /// the contract the app speaks, not the struct's field names alone.
    #[test]
    fn deserializes_caller_camel_case_payload() {
        let input: PodStatusCountsIn =
            serde_json::from_value(serde_json::json!({ "context": "prod-eu" })).unwrap();
        assert_eq!(input.context, "prod-eu");
    }
}

/// Hand-rolled HTTP server (same pattern as [`crate::pod_count`]): prove
/// metadata-only Accept, per-phase field selectors, empty → zeros, timeout
/// → error not zeros.
#[cfg(test)]
mod pod_status_counts_tests {
    use super::*;
    use kube::{Client, Config};
    use std::sync::Mutex;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn pod_list_json(names: &[&str]) -> String {
        let items: Vec<serde_json::Value> = names
            .iter()
            .map(|n| serde_json::json!({ "metadata": { "name": n } }))
            .collect();
        serde_json::json!({ "apiVersion": "v1", "kind": "PodList", "items": items }).to_string()
    }

    /// Answers by phase token in the request line; a plain list (no
    /// `status.phase=`) gets `all_body` so `other` can be derived.
    async fn fake_phase_server(
        bodies: std::collections::HashMap<&'static str, String>,
        all_body: String,
    ) -> (Client, tokio::task::JoinHandle<()>, Arc<Mutex<Vec<(String, String)>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_task = seen.clone();
        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let bodies = bodies.clone();
                let all_body = all_body.clone();
                let seen = seen_task.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let line = req.lines().next().unwrap_or("").to_string();
                    let accept = req
                        .lines()
                        .find(|line| line.to_ascii_lowercase().starts_with("accept:"))
                        .unwrap_or("")
                        .to_string();
                    seen.lock().unwrap().push((line.clone(), accept));
                    let body = ["Pending", "Running", "Succeeded", "Failed", "Unknown"]
                        .into_iter()
                        .find(|p| line.contains(p))
                        .and_then(|p| bodies.get(p).cloned())
                        .unwrap_or(all_body);
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                });
            }
        });
        let config = Config::new(format!("http://{addr}").parse().unwrap());
        (Client::try_from(config).unwrap(), handle, seen)
    }

    fn phase_bodies(
        pending: &[&str],
        running: &[&str],
        succeeded: &[&str],
        failed: &[&str],
        unknown: &[&str],
    ) -> std::collections::HashMap<&'static str, String> {
        let mut m = std::collections::HashMap::new();
        m.insert("Pending", pod_list_json(pending));
        m.insert("Running", pod_list_json(running));
        m.insert("Succeeded", pod_list_json(succeeded));
        m.insert("Failed", pod_list_json(failed));
        m.insert("Unknown", pod_list_json(unknown));
        m
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn counts_each_phase_with_metadata_only_requests() {
        let bodies = phase_bodies(&["p1"], &["r1", "r2"], &["s1"], &["f1"], &[]);
        let all = pod_list_json(&["p1", "r1", "r2", "s1", "f1"]);
        let (client, handle, seen) = fake_phase_server(bodies, all).await;
        let out = count_by_phase(client, Duration::from_secs(5)).await.unwrap();
        assert_eq!(
            out,
            PodStatusCountsOut {
                pending: 1,
                running: 2,
                succeeded: 1,
                failed: 1,
                unknown: 0,
                other: 0,
            }
        );
        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen.len(), 6, "expected six requests, got {seen:?}");
        for (_, accept) in &seen {
            assert!(
                accept.contains("PartialObjectMetadataList"),
                "expected metadata-only Accept, got: {accept}"
            );
        }
        handle.abort();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn other_bucket_holds_pods_outside_named_phases() {
        let bodies = phase_bodies(&[], &["r1"], &[], &[], &[]);
        // all has an extra name the phase selectors never returned
        let all = pod_list_json(&["r1", "weird"]);
        let (client, handle, _) = fake_phase_server(bodies, all).await;
        let out = count_by_phase(client, Duration::from_secs(5)).await.unwrap();
        assert_eq!(out.running, 1);
        assert_eq!(out.other, 1);
        handle.abort();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_empty_cluster_counts_zero() {
        let bodies = phase_bodies(&[], &[], &[], &[], &[]);
        let (client, handle, _) = fake_phase_server(bodies, pod_list_json(&[])).await;
        let out = count_by_phase(client, Duration::from_secs(5)).await.unwrap();
        assert_eq!(
            out,
            PodStatusCountsOut {
                pending: 0,
                running: 0,
                succeeded: 0,
                failed: 0,
                unknown: 0,
                other: 0,
            }
        );
        handle.abort();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_server_that_never_answers_is_an_error_not_zeros() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let _held = stream;
                    tokio::time::sleep(Duration::from_secs(30)).await;
                });
            }
        });
        let config = Config::new(format!("http://{addr}").parse().unwrap());
        let client = Client::try_from(config).unwrap();
        let err = count_by_phase(client, Duration::from_millis(50))
            .await
            .unwrap_err();
        assert!(err.contains("timed out"), "expected timeout, got: {err}");
        handle.abort();
    }
}
