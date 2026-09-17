use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use srelens_capability::{Annotations, Capability, CapabilityError, Registry};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    Jira,
    Gitlab,
    BitbucketDc,
    Jenkins,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AuthMethod {
    Session,
    AccessToken,
    Basic,
    BearerToken,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderConfig {
    pub provider: Provider,
    pub base_url: String,
    pub auth_method: AuthMethod,
    #[serde(default)]
    pub project_filters: Vec<String>,
}

impl ProviderConfig {
    pub fn jira(base_url: impl Into<String>, auth_method: AuthMethod) -> Self {
        Self::new(Provider::Jira, base_url, auth_method)
    }

    pub fn gitlab(base_url: impl Into<String>, auth_method: AuthMethod) -> Self {
        Self::new(Provider::Gitlab, base_url, auth_method)
    }

    pub fn bitbucket_dc(base_url: impl Into<String>, auth_method: AuthMethod) -> Self {
        Self::new(Provider::BitbucketDc, base_url, auth_method)
    }

    pub fn jenkins(base_url: impl Into<String>, auth_method: AuthMethod) -> Self {
        Self::new(Provider::Jenkins, base_url, auth_method)
    }

    fn new(provider: Provider, base_url: impl Into<String>, auth_method: AuthMethod) -> Self {
        Self {
            provider,
            base_url: base_url.into(),
            auth_method,
            project_filters: vec![],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub id: String,
    pub label: String,
    pub providers: Vec<ProviderConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileError {
    EmptyId,
    EmptyLabel,
    InvalidUrl,
    DuplicateProvider,
    UnsupportedAuth,
}

impl Profile {
    pub fn validate(&self) -> Result<(), ProfileError> {
        if self.id.trim().is_empty() {
            return Err(ProfileError::EmptyId);
        }
        if self.label.trim().is_empty() {
            return Err(ProfileError::EmptyLabel);
        }
        for (index, config) in self.providers.iter().enumerate() {
            if !is_https_url(&config.base_url) {
                return Err(ProfileError::InvalidUrl);
            }
            if !supports_auth(&config.provider, &config.auth_method) {
                return Err(ProfileError::UnsupportedAuth);
            }
            if self.providers[..index]
                .iter()
                .any(|other| other.provider == config.provider)
            {
                return Err(ProfileError::DuplicateProvider);
            }
        }
        Ok(())
    }
}

const SETTINGS_KEY: &str = "devops.profiles";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesState {
    pub active_profile_id: Option<String>,
    #[serde(default)]
    pub profiles: Vec<Profile>,
}

#[derive(Debug, Deserialize, JsonSchema, Default)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct ListProfilesIn {}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct UpsertProfileIn {
    profile: Profile,
    #[serde(default)]
    select: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SelectProfileIn {
    profile_id: String,
}

/// Add profile management on top of the existing durable settings capability.
/// Values are configuration only: no credential field is accepted or emitted.
pub fn register(registry: &mut Registry, settings_get: Capability, settings_set: Capability) {
    let list_get = settings_get.clone();
    registry.register(Capability::typed::<ListProfilesIn, ProfilesState, _, _>(
        "devops.profiles.list",
        "list configured DevOps connection profiles without credentials",
        Annotations::READ_ONLY,
        move |_| {
            let get = list_get.clone();
            async move { read_state(&get).await }
        },
    ));

    let upsert_get = settings_get.clone();
    let upsert_set = settings_set.clone();
    registry.register(Capability::typed::<UpsertProfileIn, ProfilesState, _, _>(
        "devops.profiles.upsert",
        "create or update public DevOps profile configuration without credentials",
        Annotations::MUTATING,
        move |input| {
            let get = upsert_get.clone();
            let set = upsert_set.clone();
            async move {
                input.profile.validate().map_err(profile_error)?;
                let mut state = read_state(&get).await?;
                let profile_id = input.profile.id.clone();
                match state
                    .profiles
                    .iter_mut()
                    .find(|profile| profile.id == input.profile.id)
                {
                    Some(existing) => *existing = input.profile,
                    None => state.profiles.push(input.profile),
                }
                if input.select {
                    state.active_profile_id = Some(profile_id);
                }
                save_state(&set, &state).await?;
                Ok(state)
            }
        },
    ));

    let select_get = settings_get;
    let select_set = settings_set;
    registry.register(Capability::typed::<SelectProfileIn, ProfilesState, _, _>(
        "devops.profiles.select",
        "select an existing DevOps profile for subsequent trace requests",
        Annotations::MUTATING,
        move |input| {
            let get = select_get.clone();
            let set = select_set.clone();
            async move {
                let mut state = read_state(&get).await?;
                if !state
                    .profiles
                    .iter()
                    .any(|profile| profile.id == input.profile_id)
                {
                    return Err(CapabilityError::InvalidInput("unknown profile id".into()));
                }
                state.active_profile_id = Some(input.profile_id);
                save_state(&set, &state).await?;
                Ok(state)
            }
        },
    ));
}

async fn read_state(settings_get: &Capability) -> Result<ProfilesState, CapabilityError> {
    let out = (settings_get.handler)(json!({ "key": SETTINGS_KEY })).await?;
    let value = out
        .get("values")
        .and_then(|values| values.get(SETTINGS_KEY))
        .cloned()
        .unwrap_or(Value::Null);
    if value.is_null() {
        Ok(ProfilesState::default())
    } else {
        serde_json::from_value(value).map_err(|error| {
            CapabilityError::Handler(format!("invalid stored DevOps profiles: {error}"))
        })
    }
}

async fn save_state(
    settings_set: &Capability,
    state: &ProfilesState,
) -> Result<(), CapabilityError> {
    let value =
        serde_json::to_value(state).map_err(|error| CapabilityError::Handler(error.to_string()))?;
    (settings_set.handler)(json!({ "values": { SETTINGS_KEY: value } }))
        .await
        .map(|_| ())
}

fn profile_error(error: ProfileError) -> CapabilityError {
    CapabilityError::InvalidInput(format!("invalid DevOps profile: {error:?}"))
}

fn is_https_url(value: &str) -> bool {
    value
        .strip_prefix("https://")
        .is_some_and(|host| !host.trim_matches('/').is_empty())
}

/// Which credential is wanted: one profile, one of its providers. It carries no
/// value, so it is safe in inputs, logs, and capability outputs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CredentialRef {
    pub profile_id: String,
    pub provider: Provider,
}

impl CredentialRef {
    pub fn new(profile_id: impl Into<String>, provider: Provider) -> Self {
        Self {
            profile_id: profile_id.into(),
            provider,
        }
    }

    /// Settles the spelling both credential stores share: the desktop vault keys
    /// connector entries by the same `<profileId>/<provider>` string.
    pub fn key(&self) -> String {
        format!("{}/{}", self.profile_id, self.provider.slug())
    }
}

impl Provider {
    pub fn slug(&self) -> &'static str {
        match self {
            Provider::Jira => "jira",
            Provider::Gitlab => "gitlab",
            Provider::BitbucketDc => "bitbucketDc",
            Provider::Jenkins => "jenkins",
        }
    }
}

/// A credential value, held by an adapter only for the length of one request.
///
/// Deliberately neither `Serialize` nor `JsonSchema`: there is no code path that
/// turns one into a capability payload. The `Debug` impl is manual for the same
/// reason — a value that leaks into a log line has left the vault anyway.
#[derive(Clone, PartialEq, Eq)]
pub struct Credential {
    pub username: String,
    pub secret: String,
}

impl std::fmt::Debug for Credential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credential")
            .field("username", &self.username)
            .field("secret", &"<redacted>")
            .finish()
    }
}

/// Why a credential could not be resolved.
///
/// Each variant is a different fact about the cluster of systems, and none of
/// them means "the source answered and had nothing": a caller must render the
/// reason, never an empty result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredentialError {
    NoActiveProfile,
    ActiveProfileMissing {
        profile_id: String,
    },
    ProviderNotConfigured {
        profile_id: String,
        provider: Provider,
    },
    NotStored(CredentialRef),
    ConfigurationUnavailable(String),
    StoreUnavailable(String),
}

impl std::fmt::Display for CredentialError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CredentialError::NoActiveProfile => write!(f, "no DevOps profile is selected"),
            CredentialError::ActiveProfileMissing { profile_id } => {
                write!(
                    f,
                    "the selected DevOps profile {profile_id} no longer exists"
                )
            }
            CredentialError::ProviderNotConfigured {
                profile_id,
                provider,
            } => write!(
                f,
                "profile {profile_id} does not configure the {} provider",
                provider.slug()
            ),
            CredentialError::NotStored(reference) => {
                write!(f, "no credential is stored for {}", reference.key())
            }
            CredentialError::ConfigurationUnavailable(reason) => {
                write!(
                    f,
                    "the DevOps profile configuration could not be read: {reason}"
                )
            }
            CredentialError::StoreUnavailable(reason) => {
                write!(f, "the credential store is unavailable: {reason}")
            }
        }
    }
}

impl std::error::Error for CredentialError {}

/// Where a connector's secret lives: process memory by default, the encrypted
/// desktop vault when the operator opted into on-device storage.
///
/// The adapter is the only caller of `resolve`, and it is handed a value only
/// long enough to make one request. `remember`/`forget` exist so a host can give
/// the operator a place to put the secret that is not a settings file.
pub trait CredentialStore: Send + Sync {
    /// `Ok(None)` is a successful lookup that found nothing stored.
    fn resolve(&self, reference: &CredentialRef) -> Result<Option<Credential>, CredentialError>;

    fn remember(
        &self,
        reference: &CredentialRef,
        credential: Credential,
    ) -> Result<(), CredentialError>;

    fn forget(&self, reference: &CredentialRef) -> Result<(), CredentialError>;

    /// Which references hold a value. Never the values themselves.
    fn configured(&self) -> Vec<CredentialRef>;
}

/// Process-lifetime credentials — the default when the operator has not asked
/// for on-device storage, and the only option in the web host.
#[derive(Default, Clone)]
pub struct SessionCredentials {
    entries: std::sync::Arc<std::sync::Mutex<std::collections::BTreeMap<String, Credential>>>,
}

impl SessionCredentials {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn remember(&self, reference: &CredentialRef, credential: Credential) {
        self.entries().insert(reference.key(), credential);
    }

    pub fn forget(&self, reference: &CredentialRef) {
        self.entries().remove(&reference.key());
    }

    /// A panicking holder leaves only a plain map behind, so a poisoned lock is
    /// recovered rather than allowed to panic a second caller.
    fn entries(&self) -> std::sync::MutexGuard<'_, std::collections::BTreeMap<String, Credential>> {
        self.entries
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }
}

impl CredentialStore for SessionCredentials {
    fn resolve(&self, reference: &CredentialRef) -> Result<Option<Credential>, CredentialError> {
        Ok(self.entries().get(&reference.key()).cloned())
    }

    fn remember(
        &self,
        reference: &CredentialRef,
        credential: Credential,
    ) -> Result<(), CredentialError> {
        self.entries().insert(reference.key(), credential);
        Ok(())
    }

    fn forget(&self, reference: &CredentialRef) -> Result<(), CredentialError> {
        self.entries().remove(&reference.key());
        Ok(())
    }

    fn configured(&self) -> Vec<CredentialRef> {
        self.entries()
            .keys()
            .filter_map(|key| parse_key(key))
            .collect()
    }
}

/// Reverse [`CredentialRef::key`]. The provider slug is the only part with a
/// fixed vocabulary, so an unknown slug is not a reference at all.
fn parse_key(key: &str) -> Option<CredentialRef> {
    let (profile_id, slug) = key.rsplit_once('/')?;
    let provider = match slug {
        "jira" => Provider::Jira,
        "gitlab" => Provider::Gitlab,
        "bitbucketDc" => Provider::BitbucketDc,
        "jenkins" => Provider::Jenkins,
        _ => return None,
    };
    Some(CredentialRef::new(profile_id, provider))
}

/// One read-only connection: where to go, how to authenticate, and with what.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedConnection {
    pub profile_id: String,
    pub provider: Provider,
    pub base_url: String,
    pub auth_method: AuthMethod,
    pub project_filters: Vec<String>,
    pub credential: Credential,
}

/// Resolve the active profile's configuration for `provider` together with its
/// credential.
///
/// Public configuration comes from durable settings, the value from the store —
/// and the two are never merged anywhere else.
pub fn resolve_connection(
    state: &ProfilesState,
    store: &dyn CredentialStore,
    provider: Provider,
) -> Result<ResolvedConnection, CredentialError> {
    let active = state
        .active_profile_id
        .clone()
        .ok_or(CredentialError::NoActiveProfile)?;
    let profile = state
        .profiles
        .iter()
        .find(|profile| profile.id == active)
        .ok_or(CredentialError::ActiveProfileMissing {
            profile_id: active.clone(),
        })?;
    let config = profile
        .providers
        .iter()
        .find(|config| config.provider == provider)
        .ok_or_else(|| CredentialError::ProviderNotConfigured {
            profile_id: profile.id.clone(),
            provider: provider.clone(),
        })?;

    let reference = CredentialRef::new(profile.id.clone(), provider.clone());
    let credential = store
        .resolve(&reference)?
        .ok_or(CredentialError::NotStored(reference))?;

    Ok(ResolvedConnection {
        profile_id: profile.id.clone(),
        provider,
        base_url: config.base_url.clone(),
        auth_method: config.auth_method.clone(),
        project_filters: config.project_filters.clone(),
        credential,
    })
}

/// The active profile's connection for `provider`: public configuration read
/// fresh from durable settings, the value from the store.
pub async fn active_connection(
    settings_get: &Capability,
    store: &dyn CredentialStore,
    provider: Provider,
) -> Result<ResolvedConnection, CredentialError> {
    let state = read_state(settings_get)
        .await
        .map_err(|error| CredentialError::ConfigurationUnavailable(error.to_string()))?;
    resolve_connection(&state, store, provider)
}

fn supports_auth(provider: &Provider, auth: &AuthMethod) -> bool {
    matches!(
        (provider, auth),
        (Provider::Jira, AuthMethod::Session)
            | (Provider::Gitlab, AuthMethod::AccessToken)
            | (
                Provider::BitbucketDc,
                AuthMethod::Basic | AuthMethod::BearerToken
            )
            | (
                Provider::Jenkins,
                AuthMethod::Basic | AuthMethod::AccessToken
            )
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use srelens_capability::{Capability, Registry};

    #[test]
    fn accepts_isolated_appfarm_and_komus_profiles_without_credentials() {
        let appfarm = Profile {
            id: "appfarm".into(),
            label: "AppFarm".into(),
            providers: vec![
                ProviderConfig::jira("https://jira.example.test", AuthMethod::Session),
                ProviderConfig::gitlab("https://gitlab.example.test", AuthMethod::AccessToken),
            ],
        };
        let komus = Profile {
            id: "komus".into(),
            label: "Komus".into(),
            providers: vec![
                ProviderConfig::bitbucket_dc("https://bitbucket.example.test", AuthMethod::Basic),
                ProviderConfig::jenkins("https://jenkins.example.test", AuthMethod::Basic),
            ],
        };

        assert_eq!(appfarm.validate(), Ok(()));
        assert_eq!(komus.validate(), Ok(()));
        assert_eq!(
            serde_json::to_value(komus).unwrap(),
            json!({
                "id": "komus", "label": "Komus", "providers": [
                    { "provider": "bitbucketDc", "baseUrl": "https://bitbucket.example.test", "authMethod": "basic", "projectFilters": [] },
                    { "provider": "jenkins", "baseUrl": "https://jenkins.example.test", "authMethod": "basic", "projectFilters": [] }
                ]
            })
        );
    }

    #[test]
    fn rejects_an_auth_method_the_provider_cannot_use() {
        let profile = Profile {
            id: "bad".into(),
            label: "Bad".into(),
            providers: vec![ProviderConfig::gitlab(
                "https://gitlab.example.test",
                AuthMethod::Basic,
            )],
        };

        assert_eq!(profile.validate(), Err(ProfileError::UnsupportedAuth));
    }

    #[test]
    fn refuses_credentials_in_a_public_profile_payload() {
        let profile = json!({
            "id": "komus", "label": "Komus", "providers": [{
                "provider": "bitbucketDc", "baseUrl": "https://bitbucket.example.test",
                "authMethod": "basic", "secret": "must-not-be-stored-here"
            }]
        });

        assert!(serde_json::from_value::<Profile>(profile).is_err());
    }

    #[tokio::test]
    async fn profile_capabilities_persist_and_select_only_public_configuration() {
        let mut registry = Registry::new();
        let settings = Capability::read_only("settings.get", "", |_| async {
            Ok(json!({ "values": {} }))
        });
        let save = Capability::read_only("settings.set", "", |_| async {
            Ok(json!({ "saved": true }))
        });
        register(&mut registry, settings, save);

        let saved = registry
            .invoke("devops.profiles.upsert", json!({
                "profile": {
                    "id": "komus", "label": "Komus", "providers": [
                        { "provider": "bitbucketDc", "baseUrl": "https://bitbucket.example.test", "authMethod": "basic" }
                    ]
                },
                "select": true
            }))
            .await
            .unwrap();

        assert_eq!(saved["activeProfileId"], "komus");
        assert!(saved.to_string().contains("bitbucketDc"));
        assert!(!saved.to_string().contains("secret"));
    }

    #[tokio::test]
    async fn selecting_an_updated_profile_keeps_its_own_id_active() {
        let state = std::sync::Arc::new(std::sync::Mutex::new(json!({})));
        let mut registry = Registry::new();
        let get_state = state.clone();
        let settings = Capability::read_only("settings.get", "", move |_| {
            let state = get_state.clone();
            async move { Ok(json!({ "values": state.lock().unwrap().clone() })) }
        });
        let save_state = state.clone();
        let save = Capability::read_only("settings.set", "", move |input| {
            let state = save_state.clone();
            async move {
                *state.lock().unwrap() = input["values"].clone();
                Ok(json!({ "saved": true }))
            }
        });
        register(&mut registry, settings, save);

        for id in ["appfarm", "komus"] {
            registry
                .invoke("devops.profiles.upsert", json!({
                    "profile": {
                        "id": id, "label": id, "providers": [
                            { "provider": "jira", "baseUrl": "https://jira.example.test", "authMethod": "session" }
                        ]
                    }
                }))
                .await
                .unwrap();
        }
        let selected = registry
            .invoke("devops.profiles.upsert", json!({
                "profile": {
                    "id": "appfarm", "label": "AppFarm", "providers": [
                        { "provider": "jira", "baseUrl": "https://jira.example.test", "authMethod": "session" }
                    ]
                },
                "select": true
            }))
            .await
            .unwrap();

        assert_eq!(selected["activeProfileId"], "appfarm");
    }

    fn komus_state() -> ProfilesState {
        ProfilesState {
            active_profile_id: Some("komus".into()),
            profiles: vec![Profile {
                id: "komus".into(),
                label: "Komus".into(),
                providers: vec![
                    ProviderConfig::bitbucket_dc(
                        "https://bitbucket.example.test",
                        AuthMethod::Basic,
                    ),
                    ProviderConfig {
                        project_filters: vec!["OPS".into()],
                        ..ProviderConfig::jenkins(
                            "https://jenkins.example.test",
                            AuthMethod::AccessToken,
                        )
                    },
                ],
            }],
        }
    }

    struct BrokenStore;

    impl CredentialStore for BrokenStore {
        fn resolve(&self, _: &CredentialRef) -> Result<Option<Credential>, CredentialError> {
            Err(CredentialError::StoreUnavailable("vault is locked".into()))
        }

        fn remember(&self, _: &CredentialRef, _: Credential) -> Result<(), CredentialError> {
            Err(CredentialError::StoreUnavailable("vault is locked".into()))
        }

        fn forget(&self, _: &CredentialRef) -> Result<(), CredentialError> {
            Err(CredentialError::StoreUnavailable("vault is locked".into()))
        }

        fn configured(&self) -> Vec<CredentialRef> {
            vec![]
        }
    }

    #[test]
    fn session_credentials_resolve_only_the_profile_and_provider_they_were_stored_for() {
        let store = SessionCredentials::new();
        let bitbucket = CredentialRef::new("komus", Provider::BitbucketDc);
        store.remember(
            &bitbucket,
            Credential {
                username: "operator".into(),
                secret: "s3cret".into(),
            },
        );

        assert_eq!(
            store.resolve(&bitbucket).unwrap().map(|c| c.username),
            Some("operator".into())
        );
        // Another provider, and another profile's same provider, stay absent.
        assert_eq!(
            store
                .resolve(&CredentialRef::new("komus", Provider::Jenkins))
                .unwrap(),
            None
        );
        assert_eq!(
            store
                .resolve(&CredentialRef::new("appfarm", Provider::BitbucketDc))
                .unwrap(),
            None
        );
    }

    #[test]
    fn forgetting_a_session_credential_reads_as_absent_not_as_an_error() {
        let store = SessionCredentials::new();
        let jenkins = CredentialRef::new("komus", Provider::Jenkins);
        store.remember(
            &jenkins,
            Credential {
                username: "build".into(),
                secret: "token".into(),
            },
        );
        store.forget(&jenkins);

        assert_eq!(store.resolve(&jenkins).unwrap(), None);
    }

    #[test]
    fn a_resolved_connection_carries_the_profiles_configuration_and_its_credential() {
        let store = SessionCredentials::new();
        store.remember(
            &CredentialRef::new("komus", Provider::Jenkins),
            Credential {
                username: "build".into(),
                secret: "token".into(),
            },
        );

        let connection =
            resolve_connection(&komus_state(), &store, Provider::Jenkins).expect("resolvable");

        assert_eq!(connection.profile_id, "komus");
        assert_eq!(connection.base_url, "https://jenkins.example.test");
        assert_eq!(connection.auth_method, AuthMethod::AccessToken);
        assert_eq!(connection.project_filters, vec!["OPS".to_string()]);
        assert_eq!(connection.credential.username, "build");
    }

    #[test]
    fn every_unresolvable_credential_is_a_distinct_reason() {
        let store = SessionCredentials::new();

        // No profile selected yet.
        assert_eq!(
            resolve_connection(&ProfilesState::default(), &store, Provider::Jenkins),
            Err(CredentialError::NoActiveProfile)
        );

        // Selected profile id that no longer exists.
        let stale = ProfilesState {
            active_profile_id: Some("deleted".into()),
            profiles: vec![],
        };
        assert_eq!(
            resolve_connection(&stale, &store, Provider::Jenkins),
            Err(CredentialError::ActiveProfileMissing {
                profile_id: "deleted".into()
            })
        );

        // The profile exists but does not configure this provider.
        assert_eq!(
            resolve_connection(&komus_state(), &store, Provider::Gitlab),
            Err(CredentialError::ProviderNotConfigured {
                profile_id: "komus".into(),
                provider: Provider::Gitlab,
            })
        );

        // Configured, but no credential was ever handed to the store.
        assert_eq!(
            resolve_connection(&komus_state(), &store, Provider::Jenkins),
            Err(CredentialError::NotStored(CredentialRef::new(
                "komus",
                Provider::Jenkins
            )))
        );

        // The store itself could not answer — still not "the source has no data".
        assert_eq!(
            resolve_connection(&komus_state(), &BrokenStore, Provider::Jenkins),
            Err(CredentialError::StoreUnavailable("vault is locked".into()))
        );
    }

    #[tokio::test]
    async fn the_active_connection_comes_from_durable_settings_and_the_store() {
        let stored = json!({
            "values": { "devops.profiles": {
                "activeProfileId": "komus",
                "profiles": [{
                    "id": "komus", "label": "Komus", "providers": [{
                        "provider": "jenkins", "baseUrl": "https://jenkins.example.test",
                        "authMethod": "accessToken"
                    }]
                }]
            }}
        });
        let settings = Capability::read_only("settings.get", "", move |_| {
            let stored = stored.clone();
            async move { Ok(stored) }
        });
        let store = SessionCredentials::new();
        store.remember(
            &CredentialRef::new("komus", Provider::Jenkins),
            Credential {
                username: "build".into(),
                secret: "token".into(),
            },
        );

        let connection = active_connection(&settings, &store, Provider::Jenkins)
            .await
            .expect("resolvable");
        assert_eq!(connection.base_url, "https://jenkins.example.test");
        assert_eq!(connection.credential.username, "build");

        // Unreadable public configuration is its own reason, not an absence.
        let broken = Capability::read_only("settings.get", "", |_| async {
            Err(CapabilityError::Handler(
                "settings file is unreadable".into(),
            ))
        });
        assert!(matches!(
            active_connection(&broken, &store, Provider::Jenkins).await,
            Err(CredentialError::ConfigurationUnavailable(_))
        ));
    }

    #[test]
    fn a_credential_never_prints_its_secret() {
        let credential = Credential {
            username: "operator".into(),
            secret: "must-not-appear".into(),
        };

        let printed = format!("{:?}", credential);
        assert!(printed.contains("operator"));
        assert!(!printed.contains("must-not-appear"));
    }
}
