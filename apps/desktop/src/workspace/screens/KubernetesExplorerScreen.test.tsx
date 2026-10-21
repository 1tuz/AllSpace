import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listContexts = vi.hoisted(() => vi.fn());
const listCrds = vi.hoisted(() => vi.fn());

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  listContexts,
  listCrds,
}));

vi.mock("../../components/ResourceBrowser", () => ({
  ResourceBrowser: ({
    context,
    kind,
    onOpenEdit,
    onOpenNew,
  }: {
    context: string;
    kind: string;
    onOpenEdit?: (kind: string, namespace: string | null, name: string) => void;
    onOpenNew?: (initialKind?: string) => void;
  }) => (
    <div data-testid="resource-browser">
      {context}/{kind}
      <button type="button" onClick={() => onOpenEdit?.("Deployment", "default", "web")}>
        edit-web
      </button>
      <button type="button" onClick={() => onOpenNew?.("Secret")}>
        new-secret
      </button>
    </div>
  ),
}));

vi.mock("../../components/Dock", () => ({
  Dock: () => <div data-testid="workspace-dock" />,
}));

vi.mock("../../components/HelmReleasesView", () => ({
  HelmReleasesView: ({ context }: { context: string }) => (
    <div data-testid="helm-releases-view">helm:{context}</div>
  ),
}));

vi.mock("../../components/PortForwardsView", () => ({
  PortForwardsView: ({ context }: { context?: string }) => (
    <div data-testid="port-forwards-view">forwards:{context}</div>
  ),
}));

vi.mock("../../components/CustomResourceBrowser", () => ({
  CustomResourceBrowser: ({ context, crd }: { context: string; crd: { name: string; kind: string } }) => (
    <div data-testid="custom-resource-browser">
      {context}/{crd.kind}/{crd.name}
    </div>
  ),
}));

vi.mock("../../components/NewResourceEditor", () => ({
  NewResourceEditor: ({ context, initialKind }: { context: string; initialKind?: string }) => (
    <div data-testid="new-resource-editor">
      new:{context}/{initialKind ?? ""}
    </div>
  ),
}));

vi.mock("../../components/EditResourceTab", () => ({
  EditResourceTab: ({
    context,
    kind,
    namespace,
    name,
  }: {
    context: string;
    kind: string;
    namespace: string | null;
    name: string;
  }) => (
    <div data-testid="edit-resource-tab">
      edit:{context}/{kind}/{namespace ?? ""}/{name}
    </div>
  ),
}));

import { KubernetesExplorerScreen } from "./KubernetesExplorerScreen";

beforeEach(() => {
  listContexts.mockReset();
  listContexts.mockResolvedValue({ contexts: [{ name: "kind-dev", cluster: "kind" }], error: undefined });
  listCrds.mockReset();
  listCrds.mockResolvedValue({
    crds: [
      {
        name: "widgets.acme.io",
        group: "acme.io",
        version: "v1",
        kind: "Widget",
        plural: "widgets",
        namespaced: true,
      },
    ],
  });
});

const FORBIDDEN_PRIMARY = /Secondary mode|oidc-login|\$KUBECONFIG|exec plugin|OS keychain/i;

describe("KubernetesExplorerScreen vitrina copy", () => {
  it("shows task-oriented guidance without developer jargon in the primary blurb", async () => {
    render(<KubernetesExplorerScreen focus={null} />);
    const blurb = await screen.findByTestId("explorer-guidance");
    expect(blurb.textContent).toMatch(/Pick a cluster/i);
    expect(blurb.textContent).toMatch(/contour/i);
    expect(blurb.textContent).not.toMatch(FORBIDDEN_PRIMARY);
    expect(blurb.textContent).not.toMatch(/empty result, not a failed call/i);
  });

  it("keeps operational cluster-access detail behind a disclosure", async () => {
    render(<KubernetesExplorerScreen focus={null} />);
    const help = await screen.findByTestId("explorer-access-help");
    expect(help.tagName.toLowerCase()).toBe("details");
    expect(help.textContent).toMatch(/\$KUBECONFIG|oidc-login/i);
  });

  it("describes an empty context list as no clusters, not a failed-call lecture", async () => {
    listContexts.mockResolvedValue({ contexts: [], error: undefined });
    render(<KubernetesExplorerScreen focus={null} />);
    expect(await screen.findByTestId("explorer-empty-contexts")).toBeDefined();
    expect(screen.getByTestId("explorer-empty-contexts").textContent).toMatch(/No clusters/i);
    expect(screen.getByTestId("explorer-empty-contexts").textContent).not.toMatch(
      /empty result, not a failed call/i,
    );
  });
});

describe("KubernetesExplorerScreen contour kubeconfig", () => {
  it("lists contexts from the Komus contour only (replaceDefaults)", async () => {
    render(
      <KubernetesExplorerScreen
        focus={null}
        profile={{ id: "komus", label: "Komus", providers: [] }}
      />,
    );
    await screen.findByRole("combobox", { name: "Cluster context" });
    expect(listContexts).toHaveBeenCalled();
    const [paths, , options] = listContexts.mock.calls[0]!;
    expect(paths.every((path: string) => path.includes("/komus/kubeconfigs/"))).toBe(true);
    expect(paths.every((path: string) => !path.includes("/AppFarm/"))).toBe(true);
    expect(options).toEqual({ replaceDefaults: true });
  });

  it("does not force replaceDefaults when no profile contour is known", async () => {
    render(<KubernetesExplorerScreen focus={null} profile={null} />);
    await screen.findByRole("combobox", { name: "Cluster context" });
    const [paths, , options] = listContexts.mock.calls[0]!;
    expect(paths).toEqual([]);
    expect(options?.replaceDefaults).toBeFalsy();
  });
});

describe("KubernetesExplorerScreen parity hosts", () => {
  it("lists expanded taxonomy plus Helm, Port Forwards, and Custom Resources", async () => {
    render(<KubernetesExplorerScreen focus={null} />);
    fireEvent.click(await screen.findByRole("combobox", { name: "Resource kind" }));
    for (const label of [
      "Horizontal Pod Autoscalers",
      "Namespaces",
      "Endpoints",
      "Ingress Classes",
      "Helm Releases",
      "Port Forwards",
      "Custom Resources",
    ]) {
      expect(screen.getByRole("option", { name: label })).toBeDefined();
    }
  });

  it("mounts HelmReleasesView when Helm Releases is selected", async () => {
    render(<KubernetesExplorerScreen focus={null} />);
    fireEvent.click(await screen.findByRole("combobox", { name: "Cluster context" }));
    fireEvent.click(screen.getByRole("option", { name: "kind-dev" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Resource kind" }));
    fireEvent.click(screen.getByRole("option", { name: "Helm Releases" }));
    expect(await screen.findByTestId("explorer-helm-releases")).toBeDefined();
    expect(screen.getByTestId("helm-releases-view").textContent).toContain("kind-dev");
  });

  it("mounts PortForwardsView when Port Forwards is selected", async () => {
    render(<KubernetesExplorerScreen focus={null} />);
    fireEvent.click(await screen.findByRole("combobox", { name: "Cluster context" }));
    fireEvent.click(screen.getByRole("option", { name: "kind-dev" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Resource kind" }));
    fireEvent.click(screen.getByRole("option", { name: "Port Forwards" }));
    expect(await screen.findByTestId("explorer-port-forwards")).toBeDefined();
    expect(screen.getByTestId("port-forwards-view").textContent).toContain("kind-dev");
  });

  it("mounts CustomResourceBrowser after picking a CRD", async () => {
    render(<KubernetesExplorerScreen focus={null} />);
    fireEvent.click(await screen.findByRole("combobox", { name: "Cluster context" }));
    fireEvent.click(screen.getByRole("option", { name: "kind-dev" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Resource kind" }));
    fireEvent.click(screen.getByRole("option", { name: "Custom Resources" }));
    expect(await screen.findByTestId("explorer-custom-resources")).toBeDefined();
    expect(listCrds).toHaveBeenCalledWith("kind-dev");
    fireEvent.click(await screen.findByRole("combobox", { name: "Custom resource definition" }));
    fireEvent.click(screen.getByRole("option", { name: /Widget/ }));
    expect(await screen.findByTestId("custom-resource-browser")).toBeDefined();
    expect(screen.getByTestId("custom-resource-browser").textContent).toContain("Widget");
  });

  it("wires onOpenEdit into EditResourceTab and onOpenNew into NewResourceEditor", async () => {
    render(<KubernetesExplorerScreen focus={null} />);
    fireEvent.click(await screen.findByRole("combobox", { name: "Cluster context" }));
    fireEvent.click(screen.getByRole("option", { name: "kind-dev" }));
    expect(await screen.findByTestId("resource-browser")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "edit-web" }));
    expect(await screen.findByTestId("explorer-edit-resource")).toBeDefined();
    expect(screen.getByTestId("edit-resource-tab").textContent).toContain("Deployment/default/web");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("resource-browser")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "new-secret" }));
    expect(await screen.findByTestId("explorer-new-resource")).toBeDefined();
    expect(screen.getByTestId("new-resource-editor").textContent).toContain("Secret");
  });
});
