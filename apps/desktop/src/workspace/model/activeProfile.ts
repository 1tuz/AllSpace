/** Active DevOps contour/profile for Workspace chrome isolation. */

import { devopsProfilesList, devopsProfileSelect, devopsProfileUpsert, type DevOpsProfile } from "@srelens/core";

type ContourName = "AppFarm" | "Komus" | "Custom";

const FALLBACK_PROFILES: DevOpsProfile[] = [
  { id: "appfarm", label: "AppFarm", providers: [] },
  { id: "komus", label: "Komus", providers: [] },
];

const ACTIVE_KEY = "srelens.workspace.activeProfileId";

function contourForProfile(profile: Pick<DevOpsProfile, "id" | "label">): ContourName {
  const blob = `${profile.id} ${profile.label}`.toLowerCase();
  if (blob.includes("komus")) return "Komus";
  if (blob.includes("appfarm") || blob.includes("app-farm")) return "AppFarm";
  return "Custom";
}

function loadStoredActiveProfileId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function storeActiveProfileId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

export async function loadWorkspaceProfiles(): Promise<{
  profiles: DevOpsProfile[];
  activeProfileId: string;
}> {
  let profiles = FALLBACK_PROFILES;
  let activeProfileId = loadStoredActiveProfileId() ?? "appfarm";
  try {
    const state = await devopsProfilesList();
    if (state.profiles?.length) {
      // Contour switcher always offers AppFarm + Komus even if vault only
      // holds one profile — isolation is a product primitive, not optional UI.
      profiles = mergeContourProfiles(state.profiles);
      activeProfileId =
        state.activeProfileId ??
        loadStoredActiveProfileId() ??
        state.profiles[0]?.id ??
        "appfarm";
    }
  } catch {
    /* offline / no vault — keep fallbacks */
  }
  if (!profiles.some((p) => p.id === activeProfileId)) {
    activeProfileId = profiles[0]?.id ?? "appfarm";
  }
  storeActiveProfileId(activeProfileId);
  return { profiles, activeProfileId };
}

/** Ensure both product contours exist in the switcher list. */
function mergeContourProfiles(stored: DevOpsProfile[]): DevOpsProfile[] {
  const out = [...stored];
  for (const fallback of FALLBACK_PROFILES) {
    const want = contourForProfile(fallback);
    if (!out.some((p) => contourForProfile(p) === want)) {
      out.push(fallback);
    }
  }
  return out;
}

/**
 * Select the active DevOps profile for live adapters.
 * Contour fallbacks appear in the switcher before they exist in the vault —
 * upsert+select so the UI label and backend active profile stay the same.
 */
export async function selectWorkspaceProfile(profileId: string): Promise<{
  profiles: DevOpsProfile[];
  activeProfileId: string;
}> {
  storeActiveProfileId(profileId);
  try {
    const state = await devopsProfileSelect(profileId);
    if (state.profiles?.length) {
      return {
        profiles: mergeContourProfiles(state.profiles),
        activeProfileId: state.activeProfileId ?? profileId,
      };
    }
  } catch {
    const fallback = FALLBACK_PROFILES.find((p) => p.id === profileId);
    if (fallback) {
      try {
        const state = await devopsProfileUpsert(fallback, true);
        return {
          profiles: mergeContourProfiles(state.profiles ?? [fallback]),
          activeProfileId: state.activeProfileId ?? profileId,
        };
      } catch {
        /* offline — UI-only switch */
      }
    }
  }
  return { profiles: FALLBACK_PROFILES, activeProfileId: profileId };
}
