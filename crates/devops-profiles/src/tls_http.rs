//! Shared reqwest client construction for DevOps provider transports.
//!
//! Lives next to `TlsConfig` so every adapter applies the same rules:
//! system trust by default, optional CA PEM, explicit `allowInsecure` only.

use std::path::Path;
use std::time::Duration;

use crate::TlsConfig;

/// Build a blocking reqwest client for DevOps provider HTTP.
///
/// `configure` runs after TLS options so callers can set redirects, UA, etc.
pub fn blocking_client<E>(
    tls: &TlsConfig,
    map_err: impl Fn(String) -> E,
    configure: impl FnOnce(reqwest::blocking::ClientBuilder) -> reqwest::blocking::ClientBuilder,
) -> Result<reqwest::blocking::Client, E> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20));

    if tls.allow_insecure {
        builder = builder.danger_accept_invalid_certs(true);
    } else if let Some(path) = tls
        .ca_bundle_path
        .as_ref()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
    {
        builder = add_ca_bundle(builder, Path::new(path)).map_err(&map_err)?;
    }

    configure(builder).build().map_err(|e| map_err(e.to_string()))
}

fn add_ca_bundle(
    mut builder: reqwest::blocking::ClientBuilder,
    path: &Path,
) -> Result<reqwest::blocking::ClientBuilder, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read CA bundle {}: {e}", path.display()))?;
    let pem = String::from_utf8_lossy(&bytes);
    let mut added = 0usize;
    for chunk in split_pem_certs(&pem) {
        let cert = reqwest::Certificate::from_pem(chunk.as_bytes())
            .map_err(|e| format!("parse CA certificate from {}: {e}", path.display()))?;
        builder = builder.add_root_certificate(cert);
        added += 1;
    }
    if added == 0 {
        return Err(format!(
            "CA bundle {} contained no PEM certificates",
            path.display()
        ));
    }
    Ok(builder)
}

fn split_pem_certs(pem: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut in_cert = false;
    for line in pem.lines() {
        if line.contains("BEGIN CERTIFICATE") {
            in_cert = true;
            current.clear();
            current.push_str(line);
            current.push('\n');
            continue;
        }
        if in_cert {
            current.push_str(line);
            current.push('\n');
            if line.contains("END CERTIFICATE") {
                out.push(current.clone());
                in_cert = false;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_tls_builds_a_client_without_insecure_flag() {
        let client = blocking_client(&TlsConfig::default(), |e| e, |b| b).expect("client");
        // Smoke: client exists; we cannot introspect danger_accept from outside.
        drop(client);
    }

    #[test]
    fn insecure_tls_builds_a_client() {
        let client = blocking_client(&TlsConfig::insecure(), |e| e, |b| b).expect("client");
        drop(client);
    }

    #[test]
    fn missing_ca_bundle_path_is_an_error() {
        let tls = TlsConfig {
            allow_insecure: false,
            ca_bundle_path: Some("/no/such/ca-bundle.pem".into()),
        };
        let err = blocking_client(&tls, |e| e, |b| b).expect_err("missing file");
        assert!(err.contains("read CA bundle"), "{err}");
    }

    #[test]
    fn split_pem_finds_multiple_certs() {
        let pem = "\
-----BEGIN CERTIFICATE-----
AAA
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
BBB
-----END CERTIFICATE-----
";
        assert_eq!(split_pem_certs(pem).len(), 2);
    }
}
