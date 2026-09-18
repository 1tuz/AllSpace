//! macOS window glass: Tahoe Liquid Glass (26+) or classic vibrancy fallback.
//!
//! Frontend owns the preference and calls [`set_liquid_glass`] after theme apply.
//! Startup leaves the window without a native effect until that command arrives.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// Prefer translucent full-window glass. `opaque: true` + Sidebar style paints a
/// solid box under the effect so desktop never shows through the WebView.
const WORKSPACE_LIQUID_GLASS_OPAQUE: bool = false;
const WORKSPACE_LIQUID_GLASS_STYLE: &str = "regular";
const WORKSPACE_VIBRANCY_MATERIAL: &str = "under-window-background";

/// Preference + last applied effect kind.
#[derive(Debug, Default)]
pub struct LiquidGlassState {
    enabled: bool,
    kind: EffectKind,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum EffectKind {
    #[default]
    None,
    Liquid,
    Vibrancy,
}

impl EffectKind {
    fn as_str(self) -> &'static str {
        match self {
            EffectKind::None => "none",
            EffectKind::Liquid => "liquid",
            EffectKind::Vibrancy => "vibrancy",
        }
    }
}

/// Pick liquid vs vibrancy from a macOS major version (testable without GUI).
pub fn effect_kind_for_macos_major(major: u32) -> EffectKind {
    if major >= 26 {
        EffectKind::Liquid
    } else if major >= 10 {
        EffectKind::Vibrancy
    } else {
        EffectKind::None
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LiquidGlassStatus {
    pub supported: bool,
    pub enabled: bool,
    pub kind: String,
}

fn status_from(state: &LiquidGlassState, supported: bool) -> LiquidGlassStatus {
    LiquidGlassStatus {
        supported,
        enabled: state.enabled,
        kind: state.kind.as_str().to_string(),
    }
}

/// Read current glass status. Non-macOS always reports unsupported / none.
#[tauri::command]
pub fn liquid_glass_status<R: Runtime>(app: AppHandle<R>) -> LiquidGlassStatus {
    let supported = cfg!(target_os = "macos");
    match app.try_state::<Mutex<LiquidGlassState>>() {
        Some(state) => {
            let guard = state.lock().unwrap_or_else(|e| e.into_inner());
            status_from(&guard, supported)
        }
        None => LiquidGlassStatus {
            supported,
            enabled: false,
            kind: EffectKind::None.as_str().to_string(),
        },
    }
}

/// Enable or disable native glass. Best-effort: failures log and still update
/// the preference so the UI can stay consistent.
#[tauri::command]
pub fn set_liquid_glass<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<LiquidGlassStatus, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let state = app
        .try_state::<Mutex<LiquidGlassState>>()
        .ok_or_else(|| "liquid glass state not managed".to_string())?;

    #[cfg(target_os = "macos")]
    {
        apply_or_clear(&window, enabled);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = &window;
        if enabled {
            log::warn!("liquid glass requested on unsupported platform");
        }
    }

    let mut guard = state.lock().unwrap_or_else(|e| e.into_inner());
    #[cfg(target_os = "macos")]
    {
        guard.enabled = enabled;
        guard.kind = if enabled {
            preferred_kind()
        } else {
            EffectKind::None
        };
    }
    #[cfg(not(target_os = "macos"))]
    {
        guard.enabled = false;
        guard.kind = EffectKind::None;
    }

    Ok(status_from(&guard, cfg!(target_os = "macos")))
}

/// NSAppKitVersionNumber threshold used by window-vibrancy for macOS 26+.
#[cfg(target_os = "macos")]
const MIN_APPKIT_VERSION_LIQUID_GLASS: f64 = 2685.0;

#[cfg(target_os = "macos")]
fn preferred_kind() -> EffectKind {
    // window-vibrancy gates liquid glass on NSAppKitVersionNumber >= 2685.0 (≈ 26).
    let major =
        if unsafe { objc2_app_kit::NSAppKitVersionNumber } >= MIN_APPKIT_VERSION_LIQUID_GLASS {
            26
        } else {
            15
        };
    effect_kind_for_macos_major(major)
}

#[cfg(target_os = "macos")]
fn apply_or_clear<R: Runtime>(window: &WebviewWindow<R>, enabled: bool) {
    clear_all_effects(window);

    if !enabled {
        return;
    }

    match preferred_kind() {
        EffectKind::Liquid => apply_liquid(window),
        EffectKind::Vibrancy => apply_vibrancy_fallback(window),
        EffectKind::None => {
            log::warn!("macOS too old for window vibrancy; leaving opaque");
        }
    }
}

#[cfg(target_os = "macos")]
fn clear_all_effects<R: Runtime>(window: &WebviewWindow<R>) {
    if let Err(error) = window_vibrancy::clear_liquid_glass(window) {
        log::debug!("clear_liquid_glass: {error}");
    }
    if let Err(error) = window_vibrancy::clear_vibrancy(window) {
        log::debug!("clear_vibrancy: {error}");
    }
    if let Err(error) = window.set_effects(None) {
        log::debug!("clear set_effects: {error}");
    }
}

#[cfg(target_os = "macos")]
fn apply_liquid<R: Runtime>(window: &WebviewWindow<R>) {
    use window_vibrancy::{apply_liquid_glass, LiquidGlassOptions, NSGlassEffectViewStyle};

    let window_ = window.clone();
    // Reparent WKWebView into NSGlassEffectView contentView (upstream Tauri example).
    if let Err(error) = window.with_webview(move |webview| {
        use objc2_web_kit::WKWebView;

        let webview: &WKWebView = unsafe { &*webview.inner().cast() };
        let options = LiquidGlassOptions::new(NSGlassEffectViewStyle::Regular)
            .radius(26.0)
            .opaque(WORKSPACE_LIQUID_GLASS_OPAQUE)
            .content_view(webview);

        if let Err(error) = apply_liquid_glass(&window_, options) {
            log::warn!("could not apply liquid glass: {error}");
        }
    }) {
        log::warn!("with_webview for liquid glass failed: {error}");
    }
}

#[cfg(target_os = "macos")]
fn apply_vibrancy_fallback<R: Runtime>(window: &WebviewWindow<R>) {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

    let material = if WORKSPACE_VIBRANCY_MATERIAL == "under-window-background" {
        NSVisualEffectMaterial::UnderWindowBackground
    } else {
        NSVisualEffectMaterial::Sidebar
    };
    if let Err(error) = apply_vibrancy(
        window,
        material,
        Some(NSVisualEffectState::FollowsWindowActiveState),
        None,
    ) {
        log::warn!("could not apply macOS vibrancy: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gates_liquid_at_macos_26() {
        assert_eq!(effect_kind_for_macos_major(26), EffectKind::Liquid);
        assert_eq!(effect_kind_for_macos_major(27), EffectKind::Liquid);
    }

    #[test]
    fn gates_vibrancy_before_26() {
        assert_eq!(effect_kind_for_macos_major(15), EffectKind::Vibrancy);
        assert_eq!(effect_kind_for_macos_major(14), EffectKind::Vibrancy);
        assert_eq!(effect_kind_for_macos_major(10), EffectKind::Vibrancy);
    }

    #[test]
    fn none_before_vibrancy_era() {
        assert_eq!(effect_kind_for_macos_major(9), EffectKind::None);
        assert_eq!(effect_kind_for_macos_major(0), EffectKind::None);
    }

    #[test]
    fn kind_strings_match_frontend_contract() {
        assert_eq!(EffectKind::Liquid.as_str(), "liquid");
        assert_eq!(EffectKind::Vibrancy.as_str(), "vibrancy");
        assert_eq!(EffectKind::None.as_str(), "none");
    }

    #[test]
    fn workspace_liquid_glass_stays_translucent_full_window() {
        // Opaque Sidebar glass paints a solid box under the effect — desktop
        // never shows through, so the UI looks like a flat tint. Full-window
        // Regular + translucent is the product contract.
        assert!(!WORKSPACE_LIQUID_GLASS_OPAQUE);
        assert_eq!(WORKSPACE_LIQUID_GLASS_STYLE, "regular");
        assert_eq!(WORKSPACE_VIBRANCY_MATERIAL, "under-window-background");
    }
}
