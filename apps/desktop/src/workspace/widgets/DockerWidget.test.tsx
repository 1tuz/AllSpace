import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Core from "@srelens/core";

const dockerEngineStatus = vi.hoisted(() => vi.fn());
const listDockerContainers = vi.hoisted(() => vi.fn());
const listDockerImages = vi.hoisted(() => vi.fn());

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  dockerEngineStatus,
  listDockerContainers,
  listDockerImages,
}));

import { DockerWidget } from "./DockerWidget";
import { clearWidgetCache } from "./useWidgetQuery";

const noop = () => {};
const props = { profile: null, profileId: "local", selection: null, onSelect: noop };

const ENDPOINT = "unix:///var/run/docker.sock";

function engineStatus(available: boolean, error: string | null = null) {
  return { available, endpoint: available ? ENDPOINT : null, error };
}

function containers(rows: Array<Record<string, unknown>>, error: string | null = null) {
  return { endpoint: ENDPOINT, containers: rows, error };
}

function images(rows: Array<Record<string, unknown>>, error: string | null = null) {
  return { endpoint: ENDPOINT, images: rows, error };
}

const running = {
  id: "a1",
  name: "payments-api-1",
  image: "registry.test/payments-api:latest",
  state: "running",
  status: "Up 3 hours (healthy)",
  project: "payments",
  service: "api",
  ports: ["0.0.0.0:8080->80/tcp"],
};

const stopped = {
  id: "b2",
  name: "payments-worker-1",
  image: "registry.test/payments-worker:latest",
  state: "exited",
  status: "Exited (1) 2 days ago",
  project: "payments",
  service: "worker",
  ports: [],
};

const unhealthy = {
  id: "c3",
  name: "checkout-api-1",
  image: "registry.test/checkout-api:latest",
  state: "running",
  status: "Up 10 minutes (unhealthy)",
  project: null,
  service: null,
  ports: ["0.0.0.0:9090->9090/tcp"],
};

function metric(label: string): string {
  const cell = screen.getByText(label).closest(".widget-metric");
  return cell?.textContent ?? "";
}

afterEach(() => {
  cleanup();
  clearWidgetCache();
  vi.clearAllMocks();
});

beforeEach(() => {
  dockerEngineStatus.mockReset();
  listDockerContainers.mockReset();
  listDockerImages.mockReset();
  dockerEngineStatus.mockResolvedValue(engineStatus(true));
  listDockerContainers.mockResolvedValue(containers([]));
  listDockerImages.mockResolvedValue(images([]));
});

describe("DockerWidget", () => {
  it("names an absent engine and the reason instead of showing an empty list", async () => {
    dockerEngineStatus.mockResolvedValue(
      engineStatus(false, "no socket at /var/run/docker.sock"),
    );

    render(<DockerWidget {...props} />);

    const state = await screen.findByText(/No Docker engine on this machine/);
    expect(state.textContent).toMatch(/no socket at \/var\/run\/docker\.sock/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(listDockerContainers).not.toHaveBeenCalled();
    expect(listDockerImages).not.toHaveBeenCalled();
  });

  it("renders a thrown engine status call as an error, not as no engine", async () => {
    dockerEngineStatus.mockRejectedValue(new Error("permission denied"));

    render(<DockerWidget {...props} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/permission denied/);
    expect(screen.queryByText(/No Docker engine/)).toBeNull();
  });

  it("renders a thrown container call as an error naming the failed read", async () => {
    listDockerContainers.mockRejectedValue(new Error("socket hung up"));

    render(<DockerWidget {...props} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/did not list containers/);
    expect(alert.textContent).toMatch(/socket hung up/);
  });

  it("renders a thrown image call as an error naming the failed read", async () => {
    listDockerImages.mockRejectedValue(new Error("image API refused"));

    render(<DockerWidget {...props} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/did not list images/);
    expect(alert.textContent).toMatch(/image API refused/);
  });

  it("shows a loading state while the engine has not answered", async () => {
    dockerEngineStatus.mockReturnValue(new Promise(() => {}));

    render(<DockerWidget {...props} />);

    const state = screen.getByText(/Looking for a Docker engine/);
    expect(state.closest(".widget-state")?.getAttribute("data-kind")).toBe("loading");
    expect(screen.queryByText(/reports no containers/)).toBeNull();
  });

  it("renders a failed container read as an error naming the failed read", async () => {
    listDockerContainers.mockResolvedValue(
      containers([], "dial unix /var/run/docker.sock: permission denied"),
    );

    render(<DockerWidget {...props} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not list containers/);
    expect(alert.textContent).toMatch(/permission denied/);
    expect(screen.queryByText(/reports no containers/)).toBeNull();
  });

  it("renders a failed image read as an error naming the failed read", async () => {
    listDockerContainers.mockResolvedValue(containers([running]));
    listDockerImages.mockResolvedValue(images([], "image list timed out"));

    render(<DockerWidget {...props} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not list images/);
    expect(alert.textContent).toMatch(/image list timed out/);
  });

  it("renders a truthful empty answer when the engine reports no containers", async () => {
    render(<DockerWidget {...props} />);

    const state = await screen.findByText("The engine reports no containers.");
    expect(state.closest(".widget-state")?.getAttribute("data-kind")).toBe("empty");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(listDockerImages).toHaveBeenCalled();
  });

  it("shows metrics and container rows, flagging containers that need attention", async () => {
    listDockerContainers.mockResolvedValue(containers([running, stopped, unhealthy]));
    listDockerImages.mockResolvedValue(
      images([
        { id: "sha256:1", tags: ["registry.test/payments-api:latest"], sizeBytes: 10, created: 1 },
        { id: "sha256:2", tags: [], sizeBytes: 20, created: 2 },
      ]),
    );

    render(<DockerWidget {...props} variant="detail" />);

    await screen.findByText("payments-api-1");

    expect(metric("Running")).toContain("2");
    expect(metric("Containers")).toContain("3");
    expect(metric("Images")).toContain("2");
    expect(metric("Attention")).toContain("2");

    const healthyRow = screen.getByText("payments-api-1").closest(".widget-row");
    expect(healthyRow?.textContent).toContain("running");
    expect(healthyRow?.textContent).toContain("registry.test/payments-api:latest");
    expect(healthyRow?.textContent).toContain("payments/api");
    expect(healthyRow?.textContent).toContain("0.0.0.0:8080->80/tcp");
    expect(healthyRow?.querySelector(".widget-row__dot")?.getAttribute("data-tone")).toBe("calm");

    const stoppedRow = screen.getByText("payments-worker-1").closest(".widget-row");
    expect(stoppedRow?.textContent).toContain("exited");
    expect(stoppedRow?.querySelector(".widget-row__dot")?.getAttribute("data-tone")).toBe("loud");

    const unhealthyRow = screen.getByText("checkout-api-1").closest(".widget-row");
    // The word, not the colour, is the signal: the engine says the container
    // is up, and its health sentence says it is failing.
    expect(unhealthyRow?.textContent).toContain("unhealthy");
    expect(unhealthyRow?.querySelector(".widget-row__dot")?.getAttribute("data-tone")).toBe("loud");

    // A container is not a delivery anchor: rows are text, never buttons.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(healthyRow?.getAttribute("data-selectable")).toBe("false");
  });

  it("shows three rows compact, all rows in detail, and says when it truncates", async () => {
    const many = Array.from({ length: 55 }, (_, index) => ({
      ...running,
      id: `c${index}`,
      name: `container-${index}`,
    }));
    listDockerContainers.mockResolvedValue(containers(many));

    const { unmount } = render(<DockerWidget {...props} />);
    await waitFor(() => expect(screen.getByText("container-0")).toBeDefined());
    expect(screen.queryByText("container-3")).toBeNull();
    unmount();

    render(<DockerWidget {...props} variant="detail" />);
    await waitFor(() => expect(screen.getByText("container-0")).toBeDefined());
    expect(screen.getByText("Showing 50 of 55 containers.")).toBeDefined();
    expect(screen.queryByText("container-50")).toBeNull();
  });
});
