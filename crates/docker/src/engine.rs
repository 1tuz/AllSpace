//! The Docker engine, reached over its own local socket.
//!
//! No agent goes on a cluster and no daemon is started here: this talks to a
//! Docker-compatible engine that is already running on this machine (Docker
//! Desktop, colima, or a podman socket). An absent engine is a fact the caller
//! renders as **unavailable** — never as an empty list.
//!
//! Deliberately a small HTTP/1.1 client over `UnixStream` instead of a Docker
//! SDK: the reads below are two GETs of JSON, and the SDK would add the whole
//! hyper/hyper-util stack to every build for that.

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

/// How long a single engine read may take. An engine that accepts the socket
/// and then stalls must fail the widget rather than hold the board.
const IO_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineError {
    /// Nothing answered: no socket, or the connect was refused. This is the
    /// "no Docker here" case, not a broken engine.
    Unavailable(String),
    Transport(String),
    Status(u16, String),
    InvalidResponse(String),
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineError::Unavailable(reason) => write!(f, "no Docker engine answered ({reason})"),
            EngineError::Transport(reason) => write!(f, "the Docker engine connection failed: {reason}"),
            EngineError::Status(status, body) => {
                write!(f, "the Docker engine returned HTTP {status}: {}", body.trim())
            }
            EngineError::InvalidResponse(reason) => {
                write!(f, "the Docker engine answered with something unreadable: {reason}")
            }
        }
    }
}

impl std::error::Error for EngineError {}

/// One Docker-compatible engine on this machine.
pub trait DockerEngine: Send + Sync {
    /// The socket this engine answers on — shown to the reader so a widget
    /// pointing at colima is not mistaken for Docker Desktop.
    fn endpoint(&self) -> String;

    /// A GET on the versioned API. Blocking by design: callers run it off the
    /// renderer thread.
    fn get(&self, path: &str) -> Result<Vec<u8>, EngineError>;
}

pub struct UnixEngine {
    socket: PathBuf,
    /// Docker's own API version, read once per engine handle. Engines disagree
    /// about it, and asking for a version the engine does not serve is a 400.
    version: Mutex<Option<String>>,
}

impl UnixEngine {
    pub fn new(socket: PathBuf) -> Self {
        Self {
            socket,
            version: Mutex::new(None),
        }
    }

    fn api_version(&self) -> Result<String, EngineError> {
        if let Some(version) = self.version.lock().expect("not poisoned").clone() {
            return Ok(version);
        }
        let body = self.raw_get("/version")?;
        let value: serde_json::Value = serde_json::from_slice(&body)
            .map_err(|error| EngineError::InvalidResponse(error.to_string()))?;
        let version = value
            .get("ApiVersion")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| EngineError::InvalidResponse("no ApiVersion in /version".into()))?
            .to_string();
        *self.version.lock().expect("not poisoned") = Some(version.clone());
        Ok(version)
    }

    fn raw_get(&self, path: &str) -> Result<Vec<u8>, EngineError> {
        let mut stream = UnixStream::connect(&self.socket).map_err(|error| {
            EngineError::Unavailable(format!("{}: {error}", self.socket.display()))
        })?;
        let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
        let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
        let request = format!("GET {path} HTTP/1.1\r\nHost: docker\r\nConnection: close\r\n\r\n");
        stream
            .write_all(request.as_bytes())
            .map_err(|error| EngineError::Transport(error.to_string()))?;
        let mut raw = Vec::new();
        stream
            .read_to_end(&mut raw)
            .map_err(|error| EngineError::Transport(error.to_string()))?;
        read_response(&raw)
    }
}

impl DockerEngine for UnixEngine {
    fn endpoint(&self) -> String {
        self.socket.display().to_string()
    }

    fn get(&self, path: &str) -> Result<Vec<u8>, EngineError> {
        let version = self.api_version()?;
        self.raw_get(&format!("/v{version}{path}"))
    }
}

/// `GET /` paths a caller can ask for. Kept here so the version prefix has one
/// home.
pub const CONTAINERS: &str = "/containers/json?all=1";
pub const IMAGES: &str = "/images/json";

/// Split one HTTP/1.1 reply into its status and body. Docker answers with
/// `Connection: close`, so the whole reply is already in `raw`; `chunked` is
/// the only transfer coding its API uses.
pub fn read_response(raw: &[u8]) -> Result<Vec<u8>, EngineError> {
    let split = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| EngineError::InvalidResponse("no header terminator".into()))?;
    let head = String::from_utf8_lossy(&raw[..split]);
    let body = &raw[split + 4..];

    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| EngineError::InvalidResponse("no status line".into()))?;

    let chunked = head.lines().skip(1).any(|line| {
        let mut parts = line.splitn(2, ':');
        matches!(
            (
                parts.next().map(str::trim).map(str::to_ascii_lowercase),
                parts.next(),
            ),
            (Some(ref name), Some(value)) if name == "transfer-encoding" && value.to_ascii_lowercase().contains("chunked")
        )
    });
    let body = if chunked {
        dechunk(body)?
    } else {
        body.to_vec()
    };

    if !(200..300).contains(&status) {
        return Err(EngineError::Status(
            status,
            String::from_utf8_lossy(&body).to_string(),
        ));
    }
    Ok(body)
}

fn dechunk(mut raw: &[u8]) -> Result<Vec<u8>, EngineError> {
    let mut out = Vec::new();
    loop {
        let line_end = raw
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or_else(|| EngineError::InvalidResponse("truncated chunk size".into()))?;
        let size_text = String::from_utf8_lossy(&raw[..line_end]);
        let size = usize::from_str_radix(size_text.trim(), 16)
            .map_err(|_| EngineError::InvalidResponse(format!("bad chunk size {size_text:?}")))?;
        raw = &raw[line_end + 2..];
        if size == 0 {
            return Ok(out);
        }
        if raw.len() < size {
            return Err(EngineError::InvalidResponse("truncated chunk".into()));
        }
        out.extend_from_slice(&raw[..size]);
        raw = raw.get(size + 2..).unwrap_or_default();
    }
}

/// Where to look, in the order a reader would expect: an explicit
/// `DOCKER_HOST`, Docker Desktop, colima, the classic rootless/system socket,
/// then podman.
pub fn candidate_sockets() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("DOCKER_HOST")
        .and_then(|host| host.to_string_lossy().strip_prefix("unix://").map(PathBuf::from))
    {
        candidates.push(path);
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join(".docker/run/docker.sock"));
        candidates.push(home.join(".colima/default/docker.sock"));
        candidates.push(home.join(".local/share/containers/podman/machine/podman.sock"));
    }
    candidates.push(PathBuf::from("/var/run/docker.sock"));
    if let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from) {
        candidates.push(runtime.join("podman/podman.sock"));
    }
    candidates
}

/// Find an engine, or say why there is none.
pub fn discover() -> Result<UnixEngine, EngineError> {
    let candidates = candidate_sockets();
    let mut reasons = Vec::new();
    for socket in &candidates {
        if !socket.exists() {
            continue;
        }
        let engine = UnixEngine::new(socket.clone());
        // `GET /version` is the cheapest way to know an engine, rather than a
        // stray file at this path, is behind the socket.
        match engine.api_version() {
            Ok(_) => return Ok(engine),
            Err(error) => reasons.push(format!("{}: {error}", socket.display())),
        }
    }
    Err(EngineError::Unavailable(if reasons.is_empty() {
        format!(
            "tried {}",
            candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
    } else {
        reasons.join("; ")
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn reply(headers: &str, body: &[u8]) -> Vec<u8> {
        let mut out = format!("HTTP/1.1 200 OK\r\n{headers}\r\n").into_bytes();
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn reads_a_plain_body() {
        let raw = reply("Content-Type: application/json\r\nContent-Length: 2\r\n", b"{}");
        assert_eq!(read_response(&raw).unwrap(), b"{}".to_vec());
    }

    #[test]
    fn reads_a_chunked_body() {
        let raw = reply(
            "Transfer-Encoding: chunked\r\n",
            b"7\r\n{\"a\":1}\r\n0\r\n\r\n",
        );
        assert_eq!(read_response(&raw).unwrap(), b"{\"a\":1}".to_vec());
    }

    #[test]
    fn a_failing_status_keeps_the_engine_own_words() {
        let raw = b"HTTP/1.1 404 Not Found\r\nContent-Length: 12\r\n\r\nno such page".to_vec();
        match read_response(&raw) {
            Err(EngineError::Status(404, body)) => assert!(body.contains("no such page")),
            other => panic!("expected a 404, got {other:?}"),
        }
    }

    #[test]
    fn a_truncated_chunk_is_an_error_not_a_short_answer() {
        let raw = reply("Transfer-Encoding: chunked\r\n", b"10\r\n{");
        assert!(matches!(
            read_response(&raw),
            Err(EngineError::InvalidResponse(_))
        ));
    }

    /// A socket that answers like an engine: `/version` first, then whatever
    /// `body` the test hands it.
    fn fake_engine(body: &'static str) -> (UnixEngine, thread::JoinHandle<Vec<String>>) {
        let path = std::env::temp_dir().join(format!(
            "srelens-docker-{}-{}.sock",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_file(&path);
        let listener = std::os::unix::net::UnixListener::bind(&path).expect("bind");
        let handle = thread::spawn(move || {
            let mut seen = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().expect("accept");
                let mut buf = [0_u8; 1024];
                let read = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..read]).to_string();
                seen.push(request.lines().next().unwrap_or_default().to_string());
                let response = if request.starts_with("GET /version") {
                    reply("Content-Type: application/json\r\n", br#"{"ApiVersion":"1.44"}"#)
                } else {
                    reply("Transfer-Encoding: chunked\r\n", body.as_bytes())
                };
                let _ = stream.write_all(&response);
            }
            seen
        });
        let engine = UnixEngine::new(path);
        (engine, handle)
    }

    #[test]
    fn asks_for_the_version_the_engine_serves() {
        let (engine, handle) = fake_engine("2\r\n[]\r\n0\r\n\r\n");
        assert_eq!(engine.get(CONTAINERS).unwrap(), b"[]".to_vec());
        let requests = handle.join().expect("fake engine");
        assert_eq!(requests[0], "GET /version HTTP/1.1");
        assert_eq!(
            requests[1],
            "GET /v1.44/containers/json?all=1 HTTP/1.1",
            "the version prefix comes from the engine's own answer"
        );
    }

    #[test]
    fn an_absent_socket_is_unavailable_not_a_broken_engine() {
        let engine = UnixEngine::new(PathBuf::from("/nonexistent/srelens-docker.sock"));
        assert!(matches!(
            engine.get(CONTAINERS),
            Err(EngineError::Unavailable(_))
        ));
    }
}
