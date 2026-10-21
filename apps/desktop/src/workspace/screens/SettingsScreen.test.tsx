import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/DevOpsSettingsSection", () => ({
  DevOpsSettingsSection: () => <div data-testid="devops-settings-section" />,
}));

vi.mock("./AppearanceSection", () => ({
  AppearanceSection: () => <div data-testid="appearance-section" />,
}));

import { SettingsScreen } from "./SettingsScreen";

const FORBIDDEN_PRIMARY = /Secondary mode|oidc-login|\$KUBECONFIG|exec plugin|OS keychain/i;

describe("SettingsScreen vitrina copy", () => {
  it("explains credential storage in task terms without keychain/exec jargon up front", () => {
    render(<SettingsScreen />);
    const blurb = screen.getByTestId("settings-guidance");
    expect(blurb.textContent).toMatch(/credential/i);
    expect(blurb.textContent).toMatch(/encrypt/i);
    expect(blurb.textContent).not.toMatch(FORBIDDEN_PRIMARY);
  });

  it("keeps vault and OIDC operational detail behind disclosures", () => {
    render(<SettingsScreen />);
    const vaultHelp = screen.getByTestId("settings-vault-help");
    expect(vaultHelp.tagName.toLowerCase()).toBe("details");
    expect(vaultHelp.textContent).toMatch(/OS keychain/i);

    const oidcHelp = screen.getByTestId("settings-oidc-help");
    expect(oidcHelp.tagName.toLowerCase()).toBe("details");
    expect(oidcHelp.textContent).toMatch(/oidc-login|exec plugin/i);

    const oidcPrimary = screen.getByTestId("settings-oidc-guidance");
    expect(oidcPrimary.textContent).toMatch(/sign in|browser|session/i);
    expect(oidcPrimary.textContent).not.toMatch(FORBIDDEN_PRIMARY);
  });
});
