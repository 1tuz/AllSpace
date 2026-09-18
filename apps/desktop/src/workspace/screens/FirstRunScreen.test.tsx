import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { draftFromContour, profileFor } from "../../components/DevOpsSettingsSection";
import { FirstRunScreen } from "./FirstRunScreen";

/** Profile JSON must stay public — no secret field names, no sibling .env paths. */
function assertPublicProfile(profile: ReturnType<typeof profileFor>) {
  expect(profile).not.toHaveProperty("password");
  expect(profile).not.toHaveProperty("token");
  expect(profile).not.toHaveProperty("secret");
  expect(profile).not.toHaveProperty("username");
  expect(profile).not.toHaveProperty("credentialEnvFile");
  const raw = JSON.stringify(profile);
  expect(raw).not.toMatch(/\/Users\//);
  expect(raw).not.toMatch(/\.env"/);
  for (const provider of profile.providers) {
    expect(provider).toEqual(
      expect.objectContaining({
        provider: expect.any(String),
        baseUrl: expect.stringMatching(/^https?:\/\//),
        authMethod: expect.any(String),
        projectFilters: expect.any(Array),
      }),
    );
    expect(Object.keys(provider).sort()).toEqual(
      ["authMethod", "baseUrl", "projectFilters", "provider"].sort(),
    );
  }
}

describe("first-run public contour profiles", () => {
  it("builds AppFarm and Komus profiles without secrets", () => {
    for (const id of ["appfarm", "komus"] as const) {
      const profile = profileFor(draftFromContour(id));
      assertPublicProfile(profile);
      expect(profile.id).toBe(id);
      expect(profile.tls?.allowInsecure).toBe(true);
    }
  });
});

describe("FirstRunScreen", () => {
  it("explains that connectors are optional and credentials stay out of the profile", () => {
    render(<FirstRunScreen onContinue={vi.fn()} />);

    expect(screen.getByText(/Configure only the providers you use/i)).toBeDefined();
    expect(screen.getByText(/encrypted vault/i)).toBeDefined();
  });

  it("Continue selects AppFarm by default and calls onContinue with that contour", async () => {
    const onContinue = vi.fn().mockResolvedValue(undefined);
    render(<FirstRunScreen onContinue={onContinue} />);

    expect(screen.getByTestId("first-run-contour-appfarm").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("first-run-continue"));
    await vi.waitFor(() => expect(onContinue).toHaveBeenCalledWith("appfarm"));
  });

  it("Continue with Komus selected passes komus", async () => {
    const onContinue = vi.fn().mockResolvedValue(undefined);
    render(<FirstRunScreen onContinue={onContinue} />);

    fireEvent.click(screen.getByTestId("first-run-contour-komus"));
    fireEvent.click(screen.getByTestId("first-run-continue"));
    await vi.waitFor(() => expect(onContinue).toHaveBeenCalledWith("komus"));
  });

});
