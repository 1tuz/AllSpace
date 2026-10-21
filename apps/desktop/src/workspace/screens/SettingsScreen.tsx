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
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground" data-testid="settings-guidance">
          Connector credentials are stored encrypted on this device. Values are never read back into
          the UI.
        </p>
        <details
          className="mt-2 max-w-2xl text-sm text-muted-foreground"
          data-testid="settings-vault-help"
        >
          <summary className="cursor-pointer text-foreground/80 hover:text-foreground">
            How secrets are stored
          </summary>
          <p className="mt-2">
            The encrypted vault uses an OS keychain master key by default — no launch password gate
            on this workspace.
          </p>
        </details>
      </header>
      <div className="flex flex-col gap-8 px-6 py-5">
        <AppearanceSection />
        <DevOpsSettingsSection />
        <section className="max-w-2xl border-t border-border pt-5">
          <h2 className="text-sm font-semibold">Cluster sign-in (AppFarm)</h2>
          <p className="mt-2 text-sm text-muted-foreground" data-testid="settings-oidc-guidance">
            Some AppFarm clusters ask you to sign in in the browser when the session expires —
            usually once a day.
          </p>
          <details
            className="mt-2 text-sm text-muted-foreground"
            data-testid="settings-oidc-help"
          >
            <summary className="cursor-pointer text-foreground/80 hover:text-foreground">
              Technical details
            </summary>
            <p className="mt-2">
              AppFarm kubeconfigs use{" "}
              <span className="font-mono text-xs">kubectl oidc-login</span>. That is the exec
              plugin, not DevOps vault credentials — same flow as bare kubectl. Keep{" "}
              <span className="font-mono text-xs">kubectl</span> / oidc-login on PATH (desktop
              already repairs login-shell PATH at startup).
            </p>
          </details>
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
