import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dockerEngineStatus,
  listDockerContainers,
  listDockerImages,
  type DockerContainersOutcome,
} from "./docker";

describe("docker wrappers", () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
  });

  it("dockerEngineStatus calls docker.engineStatus with an empty payload", async () => {
    invoke.mockResolvedValue({
      available: true,
      endpoint: "unix:///var/run/docker.sock",
      error: null,
    });

    const out = await dockerEngineStatus(invoke);

    expect(invoke).toHaveBeenCalledWith("docker.engineStatus", {});
    expect(out).toEqual({
      available: true,
      endpoint: "unix:///var/run/docker.sock",
      error: null,
    });
  });

  it("listDockerContainers calls docker.listContainers and passes the camelCase payload through", async () => {
    invoke.mockResolvedValue({
      endpoint: "unix:///var/run/docker.sock",
      containers: [
        {
          id: "3f2a1b",
          name: "payments-api-1",
          image: "registry.test/payments-api:latest",
          state: "running",
          status: "Up 3 hours (healthy)",
          project: "payments",
          service: "api",
          ports: ["0.0.0.0:8080->80/tcp"],
        },
      ],
      error: null,
    });

    const out = await listDockerContainers(invoke);

    expect(invoke).toHaveBeenCalledWith("docker.listContainers", {});
    expect(out.endpoint).toBe("unix:///var/run/docker.sock");
    expect(out.error).toBeNull();
    expect(out.containers[0]).toEqual({
      id: "3f2a1b",
      name: "payments-api-1",
      image: "registry.test/payments-api:latest",
      state: "running",
      status: "Up 3 hours (healthy)",
      project: "payments",
      service: "api",
      ports: ["0.0.0.0:8080->80/tcp"],
    });
  });

  it("listDockerImages calls docker.listImages and keeps sizeBytes/created as the engine sent them", async () => {
    invoke.mockResolvedValue({
      endpoint: "unix:///var/run/docker.sock",
      images: [
        {
          id: "sha256:abc",
          tags: ["registry.test/payments-api:latest"],
          sizeBytes: 187_400_123,
          created: 1_760_000_000,
        },
      ],
      error: null,
    });

    const out = await listDockerImages(invoke);

    expect(invoke).toHaveBeenCalledWith("docker.listImages", {});
    expect(out.images[0].sizeBytes).toBe(187_400_123);
    expect(out.images[0].created).toBe(1_760_000_000);
    expect(out.images[0].tags).toEqual(["registry.test/payments-api:latest"]);
  });

  it("does not swallow a failed read reported inside the outcome", async () => {
    const failed: DockerContainersOutcome = {
      endpoint: "unix:///var/run/docker.sock",
      containers: [],
      error: "dial unix /var/run/docker.sock: permission denied",
    };
    invoke.mockResolvedValue(failed);

    const out = await listDockerContainers(invoke);

    expect(out).toEqual(failed);
    expect(out.error).toBe("dial unix /var/run/docker.sock: permission denied");
  });

  it("does not turn an image read failure into an empty list", async () => {
    invoke.mockResolvedValue({
      endpoint: "unix:///var/run/docker.sock",
      images: [],
      error: "image list timed out",
    });

    const out = await listDockerImages(invoke);

    expect(out.images).toEqual([]);
    expect(out.error).toBe("image list timed out");
  });
});
