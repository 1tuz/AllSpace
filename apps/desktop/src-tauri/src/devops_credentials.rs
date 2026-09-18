use srelens_devops_profiles::{Credential, CredentialRef, CredentialStore, Provider};
use tauri::Manager;

fn reference(profile_id: String, provider: Provider) -> Result<CredentialRef, String> {
    if profile_id.trim().is_empty() {
        return Err("profile id cannot be empty".into());
    }
    Ok(CredentialRef::new(profile_id, provider))
}

/// Store a connector credential in the local encrypted vault. This is a Tauri
/// command rather than an MCP capability so secret values cannot enter a tool
/// transcript, capability catalogue, or audit payload.
#[tauri::command]
pub async fn devops_credential_set(
    app: tauri::AppHandle,
    profile_id: String,
    provider: Provider,
    username: String,
    secret: String,
) -> Result<(), String> {
    if secret.trim().is_empty() {
        return Err("credential cannot be empty".into());
    }
    let reference = reference(profile_id, provider)?;
    let vault = app.state::<std::sync::Arc<crate::vault::Vault>>();
    let store = crate::vault::VaultCredentialStore::new(vault.inner().clone());
    store
        .remember(&reference, Credential { username, secret })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn devops_credential_clear(
    app: tauri::AppHandle,
    profile_id: String,
    provider: Provider,
) -> Result<(), String> {
    let reference = reference(profile_id, provider)?;
    let vault = app.state::<std::sync::Arc<crate::vault::Vault>>();
    let store = crate::vault::VaultCredentialStore::new(vault.inner().clone());
    store.forget(&reference).map_err(|error| error.to_string())
}

/// Status deliberately contains only references. Neither usernames nor secret
/// values leave the vault.
#[tauri::command]
pub async fn devops_credential_status(app: tauri::AppHandle) -> Result<Vec<CredentialRef>, String> {
    let vault = app.state::<std::sync::Arc<crate::vault::Vault>>();
    let store = crate::vault::VaultCredentialStore::new(vault.inner().clone());
    Ok(store.configured())
}

#[cfg(test)]
mod tests {
    use super::reference;
    use srelens_devops_profiles::Provider;

    #[test]
    fn refuses_blank_profile_ids_before_touching_the_vault() {
        assert_eq!(
            reference("  ".into(), Provider::Gitlab),
            Err("profile id cannot be empty".into())
        );
    }
}
