import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const devopsMyWork = vi.hoisted(() => vi.fn());

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  devopsMyWork,
}));

import { HomeScreen } from "./HomeScreen";

afterEach(() => {
  cleanup();
});

describe("HomeScreen empty", () => {
  it("shows one calm screen-level empty state — never empty headings", async () => {
    devopsMyWork.mockResolvedValue({ deliveries: [], partial: false, sourceErrors: [] });
    render(
      <HomeScreen
        profile={{ id: "appfarm", label: "AppFarm", providers: [] }}
        onExploreRuntime={() => {}}
      />,
    );

    expect(await screen.findByTestId("home-live-empty")).toBeDefined();
    expect(screen.getByRole("status").textContent).toMatch(/Nothing needs attention/);
    expect(screen.queryByRole("heading", { name: "Needs attention" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "In progress" })).toBeNull();
    expect(screen.queryByText(/Nothing here/i)).toBeNull();
  });
});
