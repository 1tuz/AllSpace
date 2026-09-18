import { useEffect, useMemo, useState } from "react";
import {
  devopsProfileUpsert,
  notify,
  type DeliveryAnchor,
  type DevOpsProfile,
} from "@srelens/core";
import { WorkspacePalette, type PaletteAction } from "./WorkspacePalette";
import { WorkspaceShell } from "./WorkspaceShell";
import { ConnectionsScreen } from "./screens/ConnectionsScreen";
import { DeliveriesScreen } from "./screens/DeliveriesScreen";
import { DeliveryTraceScreen } from "./screens/DeliveryTraceScreen";
import { FirstRunScreen, type FirstRunContourChoice } from "./screens/FirstRunScreen";
import { HomeScreen } from "./screens/HomeScreen";
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
import {
  loadFirstRunDone,
  saveFirstRunDone,
  type WorkspaceRoute,
} from "./nav";

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

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null,
    [profiles, activeProfileId],
  );

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

  async function onSelectProfile(profileId: string) {
    setActiveProfileId(profileId);
    // Contour switch must drop the prior Explorer pin — otherwise Delivery
    // live kube fan-out keeps talking to the other contour's context.
    setRuntimeScope(null);
    setRuntimeFocus(null);
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

  function onPaletteAction(action: PaletteAction) {
    if (action.kind === "delivery") {
      openDelivery(action.id);
      return;
    }
    if (action.kind === "anchor") {
      openFromAnchor(action.anchor);
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
      onOpenPalette={() => setPaletteOpen(true)}
      profiles={profiles}
      activeProfileId={activeProfileId}
      onSelectProfile={(id) => void onSelectProfile(id)}
    >
      <WorkspacePalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onAction={onPaletteAction} />
      {route.name === "first-run" && (
        <FirstRunScreen
          onContinue={(contour) => void finishFirstRun(contour)}
        />
      )}
      {route.name === "home" && (
        <HomeScreen
          profile={activeProfile}
          onOpenDelivery={openDelivery}
        />
      )}
      {route.name === "deliveries" && (
        <DeliveriesScreen
          profile={activeProfile}
          filter={deliveryFilter}
          onFilter={setDeliveryFilter}
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
          onExploreRuntime={(target) => {
            setRuntimeFocus(target ?? null);
            if (target) setRuntimeScope(runtimeScopeFromHandoff(target));
            setRoute({ name: "kubernetes" });
          }}
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
