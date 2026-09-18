import { DevOpsSettingsSection } from "../../components/DevOpsSettingsSection";
import { Button } from "../../ui";
import type { RuntimeHandoff } from "../runtimeHandoff";
import { AppearanceSection } from "./AppearanceSection";

export function SettingsScreen({
  onOpenClassicIde,
}: {
  onOpenClassicIde?: (target?: RuntimeHandoff) => void;
}) {
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="settings-screen">
      <header className="border-b border-border px-6 py-5">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Settings</p>
        <h1 className="mt-1 text-xl font-semibold">Workspace</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Connector credentials go into the encrypted vault (OS keychain master key by default —
          no launch password gate on this workspace). Values are never read back into React.
        </p>
      </header>
      <div className="flex flex-col gap-8 px-6 py-5">
        <AppearanceSection />
        <DevOpsSettingsSection />
        <section className="max-w-2xl border-t border-border pt-5">
          <h2 className="text-sm font-semibold">Kubernetes OIDC (AppFarm)</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            AppFarm kubeconfigs use <span className="font-mono text-xs">kubectl oidc-login</span>. When the
            token expires (often daily), the next API call opens the system browser for Keycloak login —
            same as bare kubectl. That is the exec plugin, not DevOps vault credentials. Keep
            <span className="font-mono text-xs"> kubectl</span> / oidc-login on PATH (desktop already
            repairs login-shell PATH at startup).
          </p>
        </section>
        {onOpenClassicIde && (
          <div>
            <Button variant="ghost" onClick={() => onOpenClassicIde()}>
              Open classic Kubernetes IDE
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
