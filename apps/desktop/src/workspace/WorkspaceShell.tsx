import { useEffect, useState, type ReactNode } from "react";
import type { DevOpsProfile } from "@srelens/core";
import { ContextualTopBar, type TopBarDelivery } from "./ContextualTopBar";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { applyWorkspaceChrome } from "./chrome";
import { loadRailCollapsed, saveRailCollapsed, type WorkspaceRoute } from "./nav";

export function WorkspaceShell({
  route,
  onNavigate,
  profiles,
  activeProfileId,
  onSelectProfile,
  profileLabel,
  delivery = null,
  onBack,
  children,
}: {
  route: WorkspaceRoute;
  onNavigate: (route: WorkspaceRoute) => void;
  profiles: DevOpsProfile[];
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
  /** Display label for the active contour — not a second Combobox. */
  profileLabel: string;
  delivery?: TopBarDelivery | null;
  onBack?: () => void;
  children: ReactNode;
}) {
  const [chrome, setChrome] = useState<"overlay" | "system">("system");
  const [railCollapsed, setRailCollapsed] = useState(() => loadRailCollapsed());

  useEffect(() => {
    let cancelled = false;
    void applyWorkspaceChrome().then((mode) => {
      if (!cancelled) setChrome(mode);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function onCollapsedChange(collapsed: boolean) {
    setRailCollapsed(collapsed);
    saveRailCollapsed(collapsed);
  }

  return (
    <div
      className="workspace-shell flex h-screen min-h-0 bg-background text-foreground"
      data-testid="workspace-shell"
      data-chrome={chrome}
      data-rail-collapsed={railCollapsed ? "true" : "false"}
    >
      <WorkspaceSidebar
        route={route}
        onNavigate={onNavigate}
        profiles={profiles}
        activeProfileId={activeProfileId}
        onSelectProfile={onSelectProfile}
        collapsed={railCollapsed}
        onCollapsedChange={onCollapsedChange}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className="workspace-shell__drag workspace-shell__main-drag shrink-0"
          data-tauri-drag-region
          data-testid="workspace-main-drag"
          aria-hidden
        />
        <ContextualTopBar
          profileLabel={profileLabel}
          delivery={delivery}
          onBack={onBack}
        />
        {children}
      </div>
    </div>
  );
}
