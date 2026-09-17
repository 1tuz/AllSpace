import { useEffect, useState } from "react";
import { App } from "./App";
import { WorkspaceApp } from "./workspace/WorkspaceApp";
import { LoginScreen } from "./components/LoginScreen";
import { fetchMe, type Me } from "@srelens/core";
import { isTauri, isWeb } from "@srelens/core/platform";
import { LoadingState } from "./ui";
import { saveRuntimeHandoff, type RuntimeHandoff } from "./workspace/runtimeHandoff";

type Auth = { status: "pending" } | { status: "authed"; me: Me | null } | { status: "anon" };

type Surface = "workspace" | "classic";

const SURFACE_KEY = "srelens.productSurface";

function loadSurface(): Surface {
  try {
    return localStorage.getItem(SURFACE_KEY) === "classic" ? "classic" : "workspace";
  } catch {
    return "workspace";
  }
}

function saveSurface(surface: Surface): void {
  try {
    localStorage.setItem(SURFACE_KEY, surface);
  } catch {
    /* ignore */
  }
}

/**
 * Auth gate, then delivery-first workspace by default.
 * Classic Kubernetes IDE remains an escape hatch until Stage 4 explorer lands.
 * Desktop starts directly in the workspace. Stored secrets use the OS
 * keychain by default; an optional master password is configured in Security.
 */
export default function AppGate() {
  const [auth, setAuth] = useState<Auth>(isWeb ? { status: "pending" } : { status: "authed", me: null });
  const [surface, setSurface] = useState<Surface>(loadSurface);

  useEffect(() => {
    if (!isWeb) return;
    let cancelled = false;
    void fetchMe()
      .then((me) => !cancelled && setAuth(me ? { status: "authed", me } : { status: "anon" }))
      .catch(() => !cancelled && setAuth({ status: "anon" }));
    return () => {
      cancelled = true;
    };
  }, []);

  function openClassicIde(target?: RuntimeHandoff) {
    if (target) saveRuntimeHandoff(target);
    saveSurface("classic");
    setSurface("classic");
  }

  if (auth.status === "pending") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState label="Checking session…" />
      </div>
    );
  }
  if (auth.status === "anon") return <LoginScreen />;

  const body =
    surface === "classic" ? (
      <div className="flex h-screen min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">Classic Kubernetes IDE — transitional escape hatch</span>
          <button
            type="button"
            className="font-medium underline-offset-2 hover:underline"
            onClick={() => {
              saveSurface("workspace");
              setSurface("workspace");
            }}
          >
            Back to workspace
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <App />
        </div>
      </div>
    ) : (
      <WorkspaceApp onOpenClassicIde={openClassicIde} />
    );

  return body;
}
