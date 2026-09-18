import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMe = vi.hoisted(() => vi.fn());

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  fetchMe,
}));

vi.mock("@srelens/core/platform", () => ({
  isTauri: () => false,
  isWeb: true,
}));

vi.mock("./workspace/WorkspaceApp", () => ({
  WorkspaceApp: () => <div data-testid="workspace-app" />,
}));

vi.mock("./App", () => ({ App: () => <div data-testid="classic-app" /> }));

import AppGate from "./AppGate";

beforeEach(() => {
  fetchMe.mockReset();
  fetchMe.mockResolvedValue(null);
});

describe("AppGate local Vite", () => {
  it("opens Workspace without a web session in development", async () => {
    render(<AppGate />);

    expect(await screen.findByTestId("workspace-app")).toBeDefined();
    expect(fetchMe).not.toHaveBeenCalled();
  });
});
