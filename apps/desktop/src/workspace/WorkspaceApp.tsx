import { useEffect, useMemo, useState } from "react";
import {
  devopsProfileUpsert,
  notify,
  type DeliveryAnchor,
  type DevOpsProfile,
  type DevOpsProfilesState,
} from "@srelens/core";
import { WorkspacePalette, type PaletteAction } from "./WorkspacePalette";
import { WorkspaceShell } from "./WorkspaceShell";
import type { TopBarDelivery } from "./ContextualTopBar";
import { ConnectionsScreen } from "./screens/ConnectionsScreen";
import { DeliveriesScreen } from "./screens/DeliveriesScreen";
import { DeliveryTraceScreen } from "./screens/DeliveryTraceScreen";
import { FirstRunScreen, type FirstRunContourChoice } from "./screens/FirstRunScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { clearWidgetCache } from "./widgets/useWidgetQuery";
import { KubernetesExplorerScreen } from "./screens/KubernetesExplorerScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { draftFromContour, profileFor } from "../components/DevOpsSettingsSection";
import {
  loadWorkspaceProfiles,
  selectWorkspaceProfile,
} from "./model/activeProfile";
import type { RuntimeHandoff } from "./runtimeHandoff";
import { runtimeScopeFromHandoff } from "./runtimeHandoff";
import type { DevOpsRuntimeScope } from "@srelens/core";
import type { DeliveryListItem } from "./delivery/summaryToDelivery";
import {
  loadFirstRunDone,
  saveFirstRunDone,
  type WorkspaceRoute,
} from "./nav";

function topBarDeliveryFromRoute(route: WorkspaceRoute): TopBarDelivery | null {
  if (route.name !== "delivery") return null;
  return {
    workId: route.anchor?.value ?? route.id,
    title: "",
  };
}

/** Delivery-first product shell. No global cluster selection. */
export function WorkspaceApp({
  onOpenClassicIde,
  initialRoute,
}: {
  onOpenClassicIde?: (target?: RuntimeHandoff) => void;
  initialRoute?: WorkspaceRoute;
} = {}) {
  const [route, setRoute] = useState<WorkspaceRoute>(() => {
    if (initialRoute) return initialRoute;
    // My Work is the product default.
    return loadFirstRunDone() ? { name: "home" } : { name: "first-run" };
  });
  const [deliveryFilter, setDeliveryFilter] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [runtimeFocus, setRuntimeFocus] = useState<RuntimeHandoff | null>(null);
  /** Last Explorer / Explore-handoff kube scope for live reverse/runtime join. */
  const [runtimeScope, setRuntimeScope] = useState<DevOpsRuntimeScope | null>(null);
  const [profiles, setProfiles] = useState<DevOpsProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("appfarm");
  /** Home / Deliveries master-detail selection — surfaces in the top bar. */
  const [listSelection, setListSelection] = useState<DeliveryListItem | null>(null);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null,
    [profiles, activeProfileId],
  );

  const profileLabel = activeProfile?.label ?? "";

  const topBarDelivery =
    topBarDeliveryFromRoute(route) ??
    (listSelection
      ? { workId: listSelection.workId, title: listSelection.title }
      : null);

  const onTopBarBack =
    route.name === "delivery"
      ? () => setRoute({ name: "deliveries" })
      : listSelection
        ? () => setListSelection(null)
        : undefined;

  useEffect(() => {
    // Selection is per-surface; drop it on any route change (incl. home↔deliveries).
    setListSelection(null);
  }, [route.name]);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspaceProfiles().then((next) => {
      if (cancelled) return;
      setProfiles(next.profiles);
      setActiveProfileId(next.activeProfileId);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Settings edits profiles in place, so the board has to hear about them live.
  useEffect(() => {
    function onProfiles(event: Event) {
      const state = (event as CustomEvent<DevOpsProfilesState>).detail;
      if (!state) return;
      setProfiles(state.profiles);
      const nextId = state.activeProfileId ?? state.profiles[0]?.id ?? "";
      if (nextId === activeProfileId) return;
      setActiveProfileId(nextId);
      setRuntimeScope(null);
      setRuntimeFocus(null);
      setListSelection(null);
      clearWidgetCache();
    }
    window.addEventListener("srelens:devops-profiles", onProfiles);
    return () => window.removeEventListener("srelens:devops-profiles", onProfiles);
  }, [activeProfileId]);

  async function onSelectProfile(profileId: string) {
    setActiveProfileId(profileId);
    // Contour switch must drop the prior Explorer pin — otherwise Delivery
    // live kube fan-out keeps talking to the other contour's context.
    setRuntimeScope(null);
    setRuntimeFocus(null);
    setListSelection(null);
    clearWidgetCache();
    const next = await selectWorkspaceProfile(profileId);
    setProfiles(next.profiles);
    setActiveProfileId(next.activeProfileId);
  }

  function openDelivery(id: string, anchor?: DeliveryAnchor) {
    setRoute(anchor ? { name: "delivery", id, anchor } : { name: "delivery", id });
  }

  function openFromAnchor(anchor: DeliveryAnchor) {
    openDelivery(`paste:${anchor.kind}:${encodeURIComponent(anchor.value)}`, anchor);
  }

  async function finishFirstRun(contour: FirstRunContourChoice) {
    if (contour !== "custom") {
      try {
        const profile = profileFor(draftFromContour(contour));
        const state = await devopsProfileUpsert(profile, true);
        setProfiles(state.profiles ?? [profile]);
        setActiveProfileId(state.activeProfileId ?? profile.id);
      } catch (error: unknown) {
        notify.error(String(error));
      }
    }
    saveFirstRunDone();
    setRoute({ name: "connections" });
  }

  function exploreRuntime(target?: RuntimeHandoff) {
    setRuntimeFocus(target ?? null);
    if (target) setRuntimeScope(runtimeScopeFromHandoff(target));
    setRoute({ name: "kubernetes" });
  }

  const paletteContextAnchor: DeliveryAnchor | null =
    route.name === "delivery"
      ? (route.anchor ?? null)
      : (listSelection?.anchor ?? null);

  function onPaletteAction(action: PaletteAction) {
    if (action.kind === "delivery") {
      openDelivery(action.id);
      return;
    }
    if (action.kind === "anchor") {
      openFromAnchor(action.anchor);
      return;
    }
    if (action.kind === "explore") {
      exploreRuntime(action.target);
      return;
    }
    switch (action.route) {
      case "home":
        setRoute({ name: "home" });
        break;
      case "deliveries":
        setRoute({ name: "deliveries" });
        break;
      case "connections":
        setRoute({ name: "connections" });
        break;
      case "settings":
        setRoute({ name: "settings" });
        break;
      case "kubernetes":
        setRoute({ name: "kubernetes" });
        break;
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <WorkspaceShell
      route={route}
      onNavigate={setRoute}
      profiles={profiles}
      activeProfileId={activeProfileId}
      onSelectProfile={(id) => void onSelectProfile(id)}
      profileLabel={profileLabel}
      delivery={topBarDelivery}
      onBack={onTopBarBack}
    >
      <WorkspacePalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onAction={onPaletteAction}
        contextAnchor={paletteContextAnchor}
        profileId={activeProfileId}
      />
      {route.name === "first-run" && (
        <FirstRunScreen
          onContinue={(contour) => void finishFirstRun(contour)}
        />
      )}
      {route.name === "home" && (
        <HomeScreen
          profile={activeProfile}
          runtimeScope={runtimeScope}
          selected={listSelection}
          onSelect={setListSelection}
          onExploreRuntime={exploreRuntime}
        />
      )}
      {route.name === "deliveries" && (
        <DeliveriesScreen
          profile={activeProfile}
          filter={deliveryFilter}
          onFilter={setDeliveryFilter}
          runtimeScope={runtimeScope}
          selected={listSelection}
          onSelect={setListSelection}
          onExploreRuntime={exploreRuntime}
        />
      )}
      {route.name === "delivery" && (
        <DeliveryTraceScreen
          deliveryId={route.id}
          anchor={route.anchor}
          runtimeScope={runtimeScope}
          profile={activeProfile}
          profileId={activeProfileId}
          onBack={() => setRoute({ name: "deliveries" })}
          onExploreRuntime={exploreRuntime}
        />
      )}
      {route.name === "connections" && <ConnectionsScreen />}
      {route.name === "settings" && (
        <SettingsScreen
          onOpenClassicIde={onOpenClassicIde}
        />
      )}
      {route.name === "kubernetes" && (
        <KubernetesExplorerScreen
          focus={runtimeFocus}
          onRuntimeScopeChange={setRuntimeScope}
          profile={activeProfile}
        />
      )}
    </WorkspaceShell>
  );
}
