/**
 * Launch / lock password UI for the secrets vault.
 *
 * The vault, master-password setup, biometric skip, and Security settings
 * stay in the tree. This flag only stops the blocking cover (classic
 * `VaultGate`, next-design `LockGate`) from raising on launch or via
 * Lock workspace — so a machine-key vault opens without a passphrase prompt.
 *
 * Default OFF. Re-enable with settings key `srelens.vaultPasswordGate` = `1`,
 * or `__setVaultPasswordGateEnabledForTests(true)` in unit tests.
 */

import { settingsStorage } from "./settingsStorage";

export const VAULT_PASSWORD_GATE_SETTINGS_KEY = "srelens.vaultPasswordGate";

let testOverride: boolean | null = null;

/** Test seam — pass `null` to clear. */
export function __setVaultPasswordGateEnabledForTests(value: boolean | null): void {
  testOverride = value;
}

export function isVaultPasswordGateEnabled(): boolean {
  if (testOverride !== null) return testOverride;
  try {
    const raw = settingsStorage.getItem(VAULT_PASSWORD_GATE_SETTINGS_KEY);
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
  } catch {
    /* ignore */
  }
  return false;
}
