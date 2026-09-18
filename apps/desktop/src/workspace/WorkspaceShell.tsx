import { useEffect, useState, type ReactNode } from "react";
import type { DevOpsProfile } from "@srelens/core";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { applyWorkspaceChrome } from "./chrome";
import type { WorkspaceRoute } from "./nav";

export function WorkspaceShell({
  route,
  onNavigate,
  onOpenPalette,
  profiles,
  activeProfileId,
  onSelectProfile,
  children,
}: {
  route: WorkspaceRoute;
  onNavigate: (route: WorkspaceRoute) => void;
  onOpenPalette: () => void;
  profiles: DevOpsProfile[];
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
  children: ReactNode;
}) {
  const [chrome, setChrome] = useState<"overlay" | "system">("system");

  useEffect(() => {
    let cancelled = false;
    void applyWorkspaceChrome().then((mode) => {
      if (!cancelled) setChrome(mode);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="workspace-shell flex h-screen min-h-0 bg-background text-foreground"
      data-testid="workspace-shell"
      data-chrome={chrome}
    >
      <WorkspaceSidebar
        route={route}
        onNavigate={onNavigate}
        onOpenPalette={onOpenPalette}
        profiles={profiles}
        activeProfileId={activeProfileId}
        onSelectProfile={onSelectProfile}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className="workspace-shell__drag workspace-shell__main-drag shrink-0"
          data-tauri-drag-region
          data-testid="workspace-main-drag"
          aria-hidden
        />
        {children}
      </div>
    </div>
  );
}
