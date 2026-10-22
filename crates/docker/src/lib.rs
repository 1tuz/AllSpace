//! Read-only Docker module: what is running on this machine, and what its
//! engine says about it.
//!
//! Every output carries the endpoint and, when the read failed, the reason —
//! so a widget can tell "no engine here" from "this engine refused". Nothing in
//! this crate mutates an engine; start/stop arrive separately with their own
//! confirmation.
//!
//! Unix-only: the engine socket is a Unix socket. The registry gates the
//! registration on the same `cfg`, so a Windows build simply has no Docker
//! capabilities rather than a broken one.
#![cfg(unix)]

pub mod engine;

use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use srelens_capability::{Annotations, Capability, CapabilityError, Registry};

pub use engine::{candidate_sockets, discover, DockerEngine, EngineError, UnixEngine};

/// How a caller gets an engine. Absence is data (`Err(Unavailable)`), not a
/// panic: a machine without Docker is the common case.
pub trait EngineProvider: Send + Sync {
    fn engine(&self) -> Result<Arc<dyn DockerEngine>, EngineError>;
}

/// The real one: whatever Docker-compatible socket answers on this machine.
pub struct LocalEngine;

impl EngineProvider for LocalEngine {
    fn engine(&self) -> Result<Arc<dyn DockerEngine>, EngineError> {
        discover().map(|engine| Arc::new(engine) as Arc<dyn DockerEngine>)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContainerSummary {
    /// Short id, as the engine's list endpoint spells it.
    pub id: String,
    pub name: String,
    pub image: String,
    /// `running`, `exited`, `created`, `paused`, `restarting`, `dead`, …
    pub state: String,
    /// The engine's own sentence — "Up 3 hours (healthy)", "Exited (1) 2 days ago".
    pub status: String,
    /// Compose project and service, when the container carries the labels.
    pub project: Option<String>,
    pub service: Option<String>,
    /// Published ports as written on the wire, e.g. "0.0.0.0:8080->80/tcp".
    pub ports: Vec<String>,
}

impl ContainerSummary {
    /// True when the engine's own words say this container is not simply up.
    pub fn needs_attention(&self) -> bool {
        self.state != "running"
            || self.status.contains("unhealthy")
            || self.status.contains("Restarting")
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImageSummary {
    pub id: String,
    pub tags: Vec<String>,
    pub size_bytes: u64,
    /// Seconds since the epoch, as the engine reports it.
    pub created: i64,
}

#[derive(Debug, Deserialize, JsonSchema, Default)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct EngineStatusIn {}

#[derive(Debug, Deserialize, JsonSchema, Default)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct ListContainersIn {}

#[derive(Debug, Deserialize, JsonSchema, Default)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct ListImagesIn {}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatusOut {
    pub available: bool,
    pub endpoint: Option<String>,
    /// Why there is no engine, when there is none.
    pub error: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContainersOut {
    /// The socket that answered, so the reader knows which engine this is.
    pub endpoint: String,
    pub containers: Vec<ContainerSummary>,
    /// A failed read. Never rendered as "no containers".
    pub error: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImagesOut {
    pub endpoint: String,
    pub images: Vec<ImageSummary>,
    pub error: Option<String>,
}

/// The engine's container list, mapped to what the board shows.
pub fn containers_from(engine: &dyn DockerEngine) -> ContainersOut {
    let endpoint = engine.endpoint();
    match engine.get(engine::CONTAINERS) {
        Ok(body) => match serde_json::from_slice::<Vec<Value>>(&body) {
            Ok(items) => ContainersOut {
                endpoint,
                containers: items.iter().map(container_summary).collect(),
                error: None,
            },
            Err(error) => ContainersOut {
                endpoint,
                containers: Vec::new(),
                error: Some(format!("unreadable container list: {error}")),
            },
        },
        Err(error) => ContainersOut {
            endpoint,
            containers: Vec::new(),
            error: Some(error.to_string()),
        },
    }
}

fn container_summary(item: &Value) -> ContainerSummary {
    let labels = item.get("Labels").cloned().unwrap_or(Value::Null);
    let label = |name: &str| -> Option<String> {
        labels
            .get(name)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let names = item
        .get("Names")
        .and_then(|value| value.as_array())
        .map(|names| {
            names
                .iter()
                .filter_map(|name| name.as_str())
                .map(|name| name.trim_start_matches('/').to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let ports = item
        .get("Ports")
        .and_then(|value| value.as_array())
        .map(|ports| {
            ports
                .iter()
                .filter_map(|port| {
                    let public = port.get("PublicPort").and_then(|value| value.as_u64());
                    let private = port.get("PrivatePort").and_then(|value| value.as_u64())?;
                    let kind = port.get("Type").and_then(|value| value.as_str()).unwrap_or("tcp");
                    Some(match public {
                        Some(public) => format!("{public}->{private}/{kind}"),
                        None => format!("{private}/{kind}"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    ContainerSummary {
        id: string_field(item, "Id").chars().take(12).collect(),
        name: names.first().cloned().unwrap_or_default(),
        image: string_field(item, "Image"),
        state: string_field(item, "State"),
        status: string_field(item, "Status"),
        project: label("com.docker.compose.project"),
        service: label("com.docker.compose.service"),
        ports,
    }
}

/// The engine's image list, mapped to tags and size.
pub fn images_from(engine: &dyn DockerEngine) -> ImagesOut {
    let endpoint = engine.endpoint();
    match engine.get(engine::IMAGES) {
        Ok(body) => match serde_json::from_slice::<Vec<Value>>(&body) {
            Ok(items) => ImagesOut {
                endpoint,
                images: items.iter().map(image_summary).collect(),
                error: None,
            },
            Err(error) => ImagesOut {
                endpoint,
                images: Vec::new(),
                error: Some(format!("unreadable image list: {error}")),
            },
        },
        Err(error) => ImagesOut {
            endpoint,
            images: Vec::new(),
            error: Some(error.to_string()),
        },
    }
}

fn image_summary(item: &Value) -> ImageSummary {
    ImageSummary {
        id: string_field(item, "Id").trim_start_matches("sha256:").chars().take(12).collect(),
        tags: item
            .get("RepoTags")
            .and_then(|value| value.as_array())
            .map(|tags| {
                tags.iter()
                    .filter_map(|tag| tag.as_str())
                    .filter(|tag| *tag != "<none>:<none>")
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        size_bytes: item.get("Size").and_then(|value| value.as_u64()).unwrap_or(0),
        created: item.get("Created").and_then(|value| value.as_i64()).unwrap_or(0),
    }
}

fn string_field(item: &Value, key: &str) -> String {
    item.get(key)
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string()
}

pub fn register(registry: &mut Registry, provider: Arc<dyn EngineProvider>) {
    let status_provider = provider.clone();
    registry.register(Capability::typed::<EngineStatusIn, EngineStatusOut, _, _>(
        "docker.engineStatus",
        "report which local Docker-compatible engine answers, if any",
        Annotations::READ_ONLY,
        move |_| {
            let provider = status_provider.clone();
            async move {
                Ok(match provider.engine() {
                    Ok(engine) => EngineStatusOut {
                        available: true,
                        endpoint: Some(engine.endpoint()),
                        error: None,
                    },
                    Err(error) => EngineStatusOut {
                        available: false,
                        endpoint: None,
                        error: Some(error.to_string()),
                    },
                })
            }
        },
    ));

    let container_provider = provider.clone();
    registry.register(Capability::typed::<ListContainersIn, ContainersOut, _, _>(
        "docker.listContainers",
        "list containers on the local Docker-compatible engine",
        Annotations::READ_ONLY,
        move |_| {
            let provider = container_provider.clone();
            async move {
                let engine = provider
                    .engine()
                    .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                Ok(containers_from(engine.as_ref()))
            }
        },
    ));

    // Images as well as containers, because "what is eating the disk" is a
    // different question from "what is running".
    let image_provider = provider;
    registry.register(Capability::typed::<ListImagesIn, ImagesOut, _, _>(
        "docker.listImages",
        "list images on the local Docker-compatible engine",
        Annotations::READ_ONLY,
        move |_| {
            let provider = image_provider.clone();
            async move {
                let engine = provider
                    .engine()
                    .map_err(|error| CapabilityError::Handler(error.to_string()))?;
                Ok(images_from(engine.as_ref()))
            }
        },
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FakeEngine {
        path: String,
        body: Mutex<Result<String, EngineError>>,
    }

    impl DockerEngine for FakeEngine {
        fn endpoint(&self) -> String {
            self.path.clone()
        }
        fn get(&self, _path: &str) -> Result<Vec<u8>, EngineError> {
            match self.body.lock().expect("not poisoned").clone() {
                Ok(body) => Ok(body.into_bytes()),
                Err(error) => Err(error),
            }
        }
    }

    fn engine(body: &str) -> FakeEngine {
        FakeEngine {
            path: "/run/docker.sock".into(),
            body: Mutex::new(Ok(body.to_string())),
        }
    }

    struct Fixed(Arc<dyn DockerEngine>);

    impl EngineProvider for Fixed {
        fn engine(&self) -> Result<Arc<dyn DockerEngine>, EngineError> {
            Ok(self.0.clone())
        }
    }

    struct Absent;

    impl EngineProvider for Absent {
        fn engine(&self) -> Result<Arc<dyn DockerEngine>, EngineError> {
            Err(EngineError::Unavailable("tried /var/run/docker.sock".into()))
        }
    }

    #[test]
    fn maps_compose_labels_ports_and_the_engine_sentence() {
        let body = r#"[{
            "Id": "0123456789abcdef0123",
            "Names": ["/appfarm-api-1"],
            "Image": "acme/api:118a7e",
            "State": "running",
            "Status": "Up 3 hours (unhealthy)",
            "Labels": {"com.docker.compose.project": "appfarm", "com.docker.compose.service": "api"},
            "Ports": [{"PublicPort": 8080, "PrivatePort": 80, "Type": "tcp"}]
        }]"#;
        let out = containers_from(&engine(body));

        assert_eq!(out.error, None);
        let container = &out.containers[0];
        assert_eq!(container.id, "0123456789ab");
        assert_eq!(container.name, "appfarm-api-1");
        assert_eq!(container.project.as_deref(), Some("appfarm"));
        assert_eq!(container.service.as_deref(), Some("api"));
        assert_eq!(container.ports, vec!["8080->80/tcp"]);
        assert!(container.needs_attention(), "an unhealthy container counts");
    }

    #[test]
    fn a_running_healthy_container_needs_no_attention() {
        // The flag drives the widget's loud count. Flipping it on a plain
        // healthy container would make every board read "3 need attention".
        let body = r#"[{
            "Id": "0123456789abcdef0123",
            "Names": ["/appfarm-api-1"],
            "Image": "acme/api:118a7e",
            "State": "running",
            "Status": "Up 3 hours (healthy)",
            "Labels": {},
            "Ports": []
        }]"#;
        let container = containers_from(&engine(body)).containers.remove(0);
        assert!(!container.needs_attention());
        assert_eq!(container.project, None, "no compose labels, no project");
        assert_eq!(container.ports, Vec::<String>::new());
    }

    #[test]
    fn a_broken_answer_is_an_error_not_an_empty_list() {
        let out = containers_from(&engine("{not json"));
        assert!(out.containers.is_empty());
        assert!(out.error.unwrap().contains("container list"));

        let out = images_from(&engine("\"nope\""));
        assert!(out.error.unwrap().contains("image list"));
    }

    #[tokio::test]
    async fn an_absent_engine_reports_why_and_never_an_empty_board() {
        let mut registry = Registry::new();
        register(&mut registry, Arc::new(Absent));

        let status = registry.invoke("docker.engineStatus", serde_json::json!({})).await.unwrap();
        assert_eq!(status["available"], false);
        assert!(status["error"].as_str().unwrap().contains("/var/run/docker.sock"));

        let refusal = registry
            .invoke("docker.listContainers", serde_json::json!({}))
            .await;
        assert!(refusal.is_err(), "no engine must not read as zero containers");
    }

    #[tokio::test]
    async fn an_engine_that_answers_reports_its_endpoint() {
        // The other half of the pair above: `available` is what the widget
        // gates every read on, so a wired-up engine must say so and name the
        // socket it answered on.
        let mut registry = Registry::new();
        register(&mut registry, Arc::new(Fixed(Arc::new(engine("[]")))));

        let status = registry.invoke("docker.engineStatus", serde_json::json!({})).await.unwrap();
        assert_eq!(status["available"], true);
        assert_eq!(status["endpoint"], "/run/docker.sock");
        assert_eq!(status["error"], Value::Null);
    }

    #[tokio::test]
    async fn lists_containers_and_images_through_the_registry() {
        let mut registry = Registry::new();
        register(
            &mut registry,
            Arc::new(Fixed(Arc::new(engine(
                r#"[{"Id":"abcdef1234567890","Names":["/db"],"Image":"postgres:16","State":"exited","Status":"Exited (0) 2 days ago","Labels":{}}]"#,
            )))),
        );
        let containers = registry
            .invoke("docker.listContainers", serde_json::json!({}))
            .await
            .unwrap();
        assert_eq!(containers["endpoint"], "/run/docker.sock");
        assert_eq!(containers["containers"][0]["state"], "exited");
        assert_eq!(containers["error"], Value::Null);

        let mut registry = Registry::new();
        register(
            &mut registry,
            Arc::new(Fixed(Arc::new(engine(
                r#"[{"Id":"sha256:abcdef1234567890","RepoTags":["postgres:16","<none>:<none>"],"Size":42,"Created":1700000000}]"#,
            )))),
        );
        let images = registry.invoke("docker.listImages", serde_json::json!({})).await.unwrap();
        assert_eq!(images["images"][0]["id"], "abcdef123456");
        assert_eq!(images["images"][0]["tags"], serde_json::json!(["postgres:16"]));
        assert_eq!(images["images"][0]["sizeBytes"], 42);
    }

    #[test]
    fn every_read_only_capability_says_so() {
        let mut registry = Registry::new();
        register(&mut registry, Arc::new(Absent));
        for id in ["docker.engineStatus", "docker.listContainers", "docker.listImages"] {
            let cap = registry
                .entries()
                .find(|cap| cap.id == id)
                .unwrap_or_else(|| panic!("{id} is registered"));
            assert!(cap.annotations.read_only, "{id} mutates nothing");
        }
    }
}
