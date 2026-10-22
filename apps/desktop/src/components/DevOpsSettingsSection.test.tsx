import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@srelens/core/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const devops = vi.hoisted(() => ({
  devopsProfilesList: vi.fn(),
  devopsProfileSelect: vi.fn(),
  devopsProfileUpsert: vi.fn(),
  devopsProfileDelete: vi.fn(),
  devopsCredentialSet: vi.fn(),
  devopsCredentialClear: vi.fn(),
  devopsCredentialStatus: vi.fn(),
}));
vi.mock("@srelens/core/lib/devops", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core/lib/devops")>()),
  ...devops,
}));

import { DevOpsSettingsSection } from "./DevOpsSettingsSection";

const appfarm = {
  id: "appfarm",
  label: "AppFarm",
  providers: [
    { provider: "jira" as const, baseUrl: "https://jira.example.test", authMethod: "session" as const, projectFilters: [] },
  ],
};
const komus = {
  id: "komus",
  label: "Komus",
  providers: [
    { provider: "jenkins" as const, baseUrl: "https://jenkins.example.test", authMethod: "basic" as const, projectFilters: [] },
  ],
};
const both = { activeProfileId: "appfarm", profiles: [appfarm, komus] };

beforeEach(() => {
  devops.devopsProfilesList.mockReset().mockResolvedValue(both);
  devops.devopsCredentialStatus.mockReset().mockResolvedValue([{ profileId: "appfarm", provider: "jira" }]);
  devops.devopsProfileDelete
    .mockReset()
    .mockResolvedValue({ activeProfileId: "komus", profiles: [komus] });
  devops.devopsProfileUpsert.mockReset().mockResolvedValue({
    activeProfileId: "appfarm-copy",
    profiles: [...both.profiles, { ...appfarm, id: "appfarm-copy", label: "AppFarm copy" }],
  });
  devops.devopsCredentialClear.mockReset().mockResolvedValue(undefined);
});

describe("DevOpsSettingsSection profiles", () => {
  it("drops a profile's credentials before deleting the profile itself", async () => {
    render(<DevOpsSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete active profile" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete profile" }));

    await waitFor(() => expect(devops.devopsProfileDelete).toHaveBeenCalledWith("appfarm"));
    expect(devops.devopsCredentialClear).toHaveBeenCalledWith("appfarm", "jira");
    // The capability picks the remaining profile, so the form follows it.
    await waitFor(() =>
      expect((screen.getByLabelText("Profile ID") as HTMLInputElement).value).toBe("komus"),
    );
  });

  it("duplicates the active profile under a free id and label", async () => {
    render(<DevOpsSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate active profile" }));

    await waitFor(() => expect(devops.devopsProfileUpsert).toHaveBeenCalled());
    const [copy, select] = devops.devopsProfileUpsert.mock.calls[0];
    expect(copy.id).toBe("appfarm-copy");
    expect(copy.label).toBe("AppFarm copy");
    expect(copy.providers).toEqual(appfarm.providers);
    expect(select).toBe(true);
  });
});
