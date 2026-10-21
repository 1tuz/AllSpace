import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { K8sObject, PodMetric, PodSummary } from "@srelens/core";

// A ConfigMap has no `relatedPodSelector` match, so `GenericBody`'s Pods
// section never fires for it — `podsForSelector`/`podMetrics` are mocked
// anyway, purely so the composition test below can render `GenericBody`
// without a live cluster call escaping the mock boundary.
const { podsForSelector, podMetrics, updateConfigData } = vi.hoisted(() => ({
  podsForSelector: vi.fn(async (): Promise<{ pods?: PodSummary[]; error?: string }> => ({ pods: [] })),
  podMetrics: vi.fn(async (): Promise<{ metrics?: PodMetric[]; error?: string }> => ({ metrics: [] })),
  updateConfigData: vi.fn(async (): Promise<{ ok?: boolean; error?: string }> => ({ ok: true })),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  podsForSelector,
  podMetrics,
  updateConfigData,
}));

// Access gating is preflighted via useAccess; mock so Save tests control
// whether it is permitted. Default: allowed.
vi.mock("@srelens/core/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@srelens/core/react")>();
  return { ...actual, useAccess: vi.fn() };
});
import { useAccess } from "@srelens/core/react";

import { ConfigDetailsBody } from "./ConfigBody";
import { GenericBody } from "./GenericBody";
import { detailFacts } from "./detailData";

function configMap(data: Record<string, string> = {}): K8sObject {
  return {
    kind: "ConfigMap",
    apiVersion: "v1",
    metadata: { name: "app-config", namespace: "default" },
    data,
  } as K8sObject;
}

describe("ConfigDetailsBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    podsForSelector.mockResolvedValue({ pods: [] });
    podMetrics.mockResolvedValue({ metrics: [] });
    updateConfigData.mockResolvedValue({ ok: true });
    vi.mocked(useAccess).mockReturnValue({
      allowed: () => true,
      reason: () => "",
      known: () => true,
      loading: false,
    });
  });

  it("shows each key and its value, unmasked", () => {
    render(<ConfigDetailsBody object={configMap({ "app.conf": "level=info", "feature.flag": "on" })} context="ctx" />);
    expect(screen.getByText("Data (2 keys)")).toBeDefined();
    expect(screen.getByText("app.conf")).toBeDefined();
    expect((screen.getByLabelText("Value for app.conf") as HTMLTextAreaElement).value).toBe("level=info");
    expect(screen.getByText("feature.flag")).toBeDefined();
    expect((screen.getByLabelText("Value for feature.flag") as HTMLTextAreaElement).value).toBe("on");
  });

  it("preserves a multi-line value's line breaks", () => {
    render(
      <ConfigDetailsBody object={configMap({ "nginx.conf": "server {\n  listen 80;\n}" })} context="ctx" />,
    );
    expect((screen.getByLabelText("Value for nginx.conf") as HTMLTextAreaElement).value).toBe(
      "server {\n  listen 80;\n}",
    );
  });

  it("shows an empty state for a ConfigMap with no data", () => {
    render(<ConfigDetailsBody object={configMap()} context="ctx" />);
    expect(screen.getByText("Data (0 keys)")).toBeDefined();
    expect(screen.getByText("No data")).toBeDefined();
  });

  it("is a flat block, not a card", () => {
    const { container } = render(
      <ConfigDetailsBody object={configMap({ "app.conf": "level=info" })} context="ctx" />,
    );
    expect(container.querySelector("section.section")).not.toBeNull();
    expect(container.querySelector(".card")).toBeNull();
  });

  it("saves an edited value via updateConfigData", async () => {
    render(<ConfigDetailsBody object={configMap({ "app.conf": "level=info" })} context="kind-dev" />);
    fireEvent.change(screen.getByLabelText("Value for app.conf"), { target: { value: "level=debug" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateConfigData).toHaveBeenCalledWith("kind-dev", "ConfigMap", "default", "app-config", {
        "app.conf": "level=debug",
      }),
    );
  });

  it("disables Save when the user can't update the ConfigMap", async () => {
    vi.mocked(useAccess).mockReturnValue({
      allowed: () => false,
      reason: () => "RBAC: no rule",
      known: () => true,
      loading: false,
    });
    render(<ConfigDetailsBody object={configMap({ "app.conf": "level=info" })} context="kind-dev" />);
    fireEvent.change(screen.getByLabelText("Value for app.conf"), { target: { value: "level=debug" } });
    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(save.getAttribute("title")).toEqual(expect.stringContaining("permission to update configmaps"));
  });

  it("keeps values read-only when there is no context", () => {
    render(<ConfigDetailsBody object={configMap({ "app.conf": "level=info" })} context="" />);
    expect((screen.getByLabelText("Value for app.conf") as HTMLTextAreaElement).readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText("Value for app.conf"), { target: { value: "level=debug" } });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("shows a friendly message when a save fails", async () => {
    updateConfigData.mockResolvedValue({ error: "configmaps is forbidden: cannot update" });
    render(<ConfigDetailsBody object={configMap({ "app.conf": "level=info" })} context="kind-dev" />);
    fireEvent.change(screen.getByLabelText("Value for app.conf"), { target: { value: "level=debug" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText(/permission|RBAC roles/i)).toBeDefined());
    expect(screen.queryByText(/is forbidden: cannot update/)).toBeNull();
  });

  describe("composition with GenericBody", () => {
    it("states the ConfigMap's namespace once, as a fact the screen draws, and renders no Pods section", async () => {
      const cm = configMap({ "app.conf": "level=info" });
      render(
        <GenericBody kind="ConfigMap" object={cm} context="ctx">
          <ConfigDetailsBody object={cm} context="ctx" />
        </GenericBody>,
      );
      expect(detailFacts({ kind: "ConfigMap", object: cm }).map((f) => f.label)).toContain("Namespace");
      expect(screen.queryByText("Namespace")).toBeNull();
      expect(screen.queryAllByRole("heading", { name: "Pods" })).toHaveLength(0);
      expect(podsForSelector).not.toHaveBeenCalled();
    });

    it("lands the body's blocks as bare siblings, so the rules between them draw", () => {
      const cm = configMap({ "app.conf": "level=info" });
      const { container } = render(
        <GenericBody kind="ConfigMap" object={cm} context="ctx">
          <ConfigDetailsBody object={cm} context="ctx" />
        </GenericBody>,
      );
      const blocks = [...container.children];
      expect(blocks).toHaveLength(1);
      for (const block of blocks) expect(block.matches("section.section")).toBe(true);
    });
  });
});
