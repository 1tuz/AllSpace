import { invokeCapability, type Invoker } from "../transport/transport";

export type DockerEngineStatus = {
  available: boolean;
  endpoint: string | null;
  error: string | null;
};

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  project: string | null;
  service: string | null;
  ports: string[];
};

export type DockerImage = {
  id: string;
  tags: string[];
  sizeBytes: number;
  created: number;
};

export type DockerContainersOutcome = {
  endpoint: string;
  containers: DockerContainer[];
  error: string | null;
};

export type DockerImagesOutcome = {
  endpoint: string;
  images: DockerImage[];
  error: string | null;
};

/** `docker.engineStatus` — whether a local engine answered, and where. */
export async function dockerEngineStatus(
  invoke: Invoker = invokeCapability,
): Promise<DockerEngineStatus> {
  return invoke<DockerEngineStatus>("docker.engineStatus", {});
}

/** `docker.listContainers` — the engine's container list; `error` is a failed read, never "none". */
export async function listDockerContainers(
  invoke: Invoker = invokeCapability,
): Promise<DockerContainersOutcome> {
  return invoke<DockerContainersOutcome>("docker.listContainers", {});
}

/** `docker.listImages` — the engine's image list; `error` is a failed read, never "none". */
export async function listDockerImages(
  invoke: Invoker = invokeCapability,
): Promise<DockerImagesOutcome> {
  return invoke<DockerImagesOutcome>("docker.listImages", {});
}
