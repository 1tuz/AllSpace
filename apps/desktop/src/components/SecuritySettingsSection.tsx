import { useEffect, useState } from "react";
import { Button, TextInput } from "../ui";
import { notify } from "@srelens/core";
import {
  getMcpTokenStorage,
  vaultBiometricDisable,
  vaultBiometricEnable,
  vaultBiometricStatus,
  vaultBiometricUnlock,
  vaultChangePassword,
  vaultSetupPassword,
  type VaultBiometricStatus,
  type VaultKeySource,
} from "@srelens/core";

/**
 * Settings → Security: everything protecting the secrets vault (the master
 * password set up at first launch, the Touch ID / Windows Hello skip, and
 * the state of the key that encrypts `secrets.enc`). Moved out of the MCP
 * section — these guard ALL stored secrets, not just the MCP token.
 */
export function SecuritySettingsSection() {
  const [keySource, setKeySource] = useState<VaultKeySource | null>(null);
  const [biometric, setBiometric] = useState<VaultBiometricStatus | null>(null);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);

  // What the OS calls its biometric unlock — the plugin backs onto Touch ID
  // on macOS and Windows Hello on Windows (Linux has no backend, so the
  // control never renders there and this label is moot).
  const bioLabel = navigator.userAgent.includes("Windows") ? "Windows Hello" : "Touch ID";

  useEffect(() => {
    void refreshVaultState();
  }, []);

  /** Re-read both vault facts the controls render from. */
  async function refreshVaultState() {
    await Promise.all([
      getMcpTokenStorage().then(setKeySource).catch(() => {}),
      vaultBiometricStatus().then(setBiometric).catch(() => {}),
    ]);
  }

  async function toggleBiometric(on: boolean) {
    setBiometricBusy(true);
    try {
      if (on) {
        await vaultBiometricEnable();
        notify.success(`${bioLabel} required to unlock secrets from the next launch`);
      } else {
        await vaultBiometricDisable();
        notify.success(`${bioLabel} requirement removed`);
      }
    } catch (e) {
      notify.error(String(e));
    } finally {
      setBiometricBusy(false);
      await refreshVaultState();
    }
  }

  async function unlockBiometric() {
    setBiometricBusy(true);
    try {
      await vaultBiometricUnlock();
      notify.success("Secrets unlocked");
    } catch (e) {
      notify.error(String(e));
    } finally {
      setBiometricBusy(false);
      await refreshVaultState();
    }
  }

  async function changePassword() {
    if (pwNew !== pwConfirm) {
      notify.error("The new passwords don't match");
      return;
    }
    setPwBusy(true);
    try {
      // The backend refreshes the keychain recovery copy only if one exists,
      // preserving the opt-in/opt-out made at setup. A warning means the
      // change landed but the biometric enrollment had to be turned off.
      const warning = await vaultChangePassword(pwCurrent, pwNew);
      if (warning) {
        notify.info(`Master password changed — ${warning}`);
        await refreshVaultState();
      } else {
        notify.success("Master password changed");
      }
      setPwCurrent("");
      setPwNew("");
      setPwConfirm("");
    } catch (e) {
      notify.error(String(e));
    } finally {
      setPwBusy(false);
    }
  }

  async function setupMasterPassword() {
    if (setupPassword !== setupConfirm) {
      notify.error("The passwords don't match");
      return;
    }
    setSetupBusy(true);
    try {
      await vaultSetupPassword(setupPassword, true);
      notify.success("Master password enabled");
      setSetupPassword("");
      setSetupConfirm("");
      await refreshVaultState();
    } catch (e) {
      notify.error(String(e));
    } finally {
      setSetupBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Security</h2>
        <p className="text-sm text-muted-foreground">
          Stored secrets use the OS keychain by default. The launch password cover is off
          (`srelens.vaultPasswordGate`); set that setting to <span className="font-mono text-xs">1</span>{" "}
          to require unlock again. Master password / biometric setup below stays available as opt-in.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        {keySource === "file" && (
          <p className="text-sm text-amber-600 dark:text-amber-500">
            No OS keychain is available here, so the key that encrypts srelens's secrets is stored
            in a plain file on disk (readable only by your user account) rather than the OS
            keychain — the encrypted secrets file is then only obfuscation.
          </p>
        )}
        {keySource === "locked" && (
          <p className="text-sm text-destructive">
            srelens couldn't load the key that encrypts its secrets when it started — the OS
            keychain was unreachable, or the key file couldn't be created. Stored secrets can't be
            read or changed right now; they are untouched. Restart srelens once the keychain is
            available again.
          </p>
        )}
        {keySource === "biometric-locked" && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-amber-600 dark:text-amber-500">
              Secrets are locked behind {bioLabel} for this session.
            </p>
            <Button size="sm" disabled={biometricBusy} onClick={() => void unlockBiometric()}>
              Unlock with {bioLabel}
            </Button>
          </div>
        )}
        {biometric?.available && keySource !== "locked" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={biometric.enabled}
              disabled={biometricBusy || (!biometric.unlocked && !biometric.enabled)}
              onChange={(e) => void toggleBiometric(e.target.checked)}
            />
            <span>Unlock with {bioLabel} instead of the master password</span>
            <span className="text-xs text-muted-foreground">
              — asks once each time srelens starts
            </span>
          </label>
        )}
      </section>

      {(keySource === "keychain" || keySource === "file") && (
        <section className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-sm font-medium">Add a master password</h3>
          <p className="max-w-md text-sm text-muted-foreground">
            Optional. The app stays open now; future launches will ask for this password before
            stored credentials are available.
          </p>
          <div className="flex max-w-md flex-col gap-2">
            <TextInput
              type="password"
              placeholder="New master password (at least 8 characters)"
              value={setupPassword}
              onValueChange={setSetupPassword}
            />
            <TextInput
              type="password"
              placeholder="Confirm master password"
              value={setupConfirm}
              onValueChange={setSetupConfirm}
            />
            <div>
              <Button
                disabled={setupBusy || setupPassword.length < 8 || setupPassword !== setupConfirm}
                onClick={() => void setupMasterPassword()}
              >
                Protect with password
              </Button>
            </div>
          </div>
        </section>
      )}

      {(keySource === "password" || keySource === "biometric") && (
        <section className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-sm font-medium">Change master password</h3>
          <div className="flex max-w-md flex-col gap-2">
            <TextInput
              type="password"
              placeholder="Current password"
              value={pwCurrent}
              onValueChange={setPwCurrent}
            />
            <TextInput
              type="password"
              placeholder="New password (at least 8 characters)"
              value={pwNew}
              onValueChange={setPwNew}
            />
            <TextInput
              type="password"
              placeholder="Confirm new password"
              value={pwConfirm}
              onValueChange={setPwConfirm}
            />
            <div>
              <Button
                disabled={pwBusy || !pwCurrent || pwNew.length < 8}
                onClick={() => void changePassword()}
              >
                Change password
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
