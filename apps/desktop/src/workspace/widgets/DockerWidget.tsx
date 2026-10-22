import {
  dockerEngineStatus,
  listDockerContainers,
  listDockerImages,
  type DockerContainer,
  type DockerContainersOutcome,
  type DockerEngineStatus,
  type DockerImagesOutcome,
} from "@srelens/core";
import { useWidgetQuery } from "./useWidgetQuery";
import { WidgetMetric, WidgetMetrics, WidgetState } from "./WidgetParts";
import type { WidgetSourceProps } from "./types";

const COMPACT_ROWS = 3;
const DETAIL_ROWS = 50;

/**
 * The engine's own words decide attention: a stopped, unhealthy or restarting
 * container. One short word, so the row never relies on the dot's colour to
 * carry it.
 */
function attentionWord(container: DockerContainer): string | null {
  const status = container.status.toLowerCase();
  if (status.includes("unhealthy")) return "unhealthy";
  if (status.includes("restarting")) return "restarting";
  return null;
}

/** Calm only when the container is up and the engine calls it healthy. */
function toneFor(container: DockerContainer): "calm" | "notable" | "loud" {
  if (attentionWord(container)) return "loud";
  switch (container.state) {
    case "running":
      return "calm";
    case "exited":
    case "dead":
      return "loud";
    default:
      return "notable";
  }
}

function needsAttention(container: DockerContainer): boolean {
  if (attentionWord(container)) return true;
  return container.state !== "running";
}

function composeLabel(container: DockerContainer): string | null {
  if (container.project && container.service) {
    return `${container.project}/${container.service}`;
  }
  return container.project ?? container.service;
}

/**
 * One container. Not `EntityRow`: that derives the dot from the status word
 * through the provider vocabulary, where `running` reads as neither calm nor
 * failed — so a healthy container and an unhealthy one would share a dot. This
 * row derives both from the container's own state and says the word beside the
 * dot.
 */
function ContainerRow({ container }: { container: DockerContainer }) {
  const tone = toneFor(container);
  const word = attentionWord(container) ?? (container.state || container.status);
  const meta = [
    container.image,
    composeLabel(container),
    container.ports.length > 0 ? container.ports.join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="widget-row-shell">
      <div className="widget-row" data-selectable="false">
        <span className="widget-row__dot" data-tone={tone} aria-hidden />
        <span className="widget-row__title">{container.name}</span>
        <span className="widget-row__status" data-tone={tone}>
          {word}
        </span>
        {meta ? <span className="widget-row__meta">{meta}</span> : null}
      </div>
    </div>
  );
}

/**
 * Docker widget: the local engine's containers and images. An absent engine is
 * a fact to name, not an empty list; a failed read stays a failure.
 */
export function DockerWidget({ profileId, variant = "compact" }: WidgetSourceProps) {
  const statusQuery = useWidgetQuery<DockerEngineStatus>({
    key: "docker.engineStatus",
    profileId,
    load: dockerEngineStatus,
  });
  const available = statusQuery.data?.available === true;
  const containersQuery = useWidgetQuery<DockerContainersOutcome>({
    key: "docker.containers",
    profileId,
    enabled: available,
    load: listDockerContainers,
  });
  const imagesQuery = useWidgetQuery<DockerImagesOutcome>({
    key: "docker.images",
    profileId,
    enabled: available,
    load: listDockerImages,
  });

  if (statusQuery.loading) {
    return <WidgetState kind="loading" text="Looking for a Docker engine…" />;
  }
  if (statusQuery.error) {
    return (
      <WidgetState kind="error" text={`Docker engine status could not be read: ${statusQuery.error}`} />
    );
  }
  const engine = statusQuery.data;
  if (!engine) {
    return <WidgetState kind="error" text="Docker engine status did not answer." />;
  }
  if (!engine.available) {
    return (
      <WidgetState
        kind="unavailable"
        text={`No Docker engine on this machine: ${engine.error ?? "the engine gave no reason"}`}
      />
    );
  }
  if (containersQuery.error) {
    return (
      <WidgetState
        kind="error"
        text={`Docker engine did not list containers: ${containersQuery.error}`}
      />
    );
  }
  if (imagesQuery.error) {
    return (
      <WidgetState kind="error" text={`Docker engine did not list images: ${imagesQuery.error}`} />
    );
  }
  if (containersQuery.loading || imagesQuery.loading) {
    return <WidgetState kind="loading" text="Reading Docker containers…" />;
  }

  const containers = containersQuery.data;
  const images = imagesQuery.data;
  if (!containers || !images) {
    return <WidgetState kind="loading" text="Reading Docker containers…" />;
  }
  if (containers.error) {
    return (
      <WidgetState
        kind="error"
        text={`Docker engine could not list containers: ${containers.error}`}
      />
    );
  }
  if (images.error) {
    return (
      <WidgetState kind="error" text={`Docker engine could not list images: ${images.error}`} />
    );
  }

  if (containers.containers.length === 0) {
    return <WidgetState kind="empty" text="The engine reports no containers." />;
  }

  const running = containers.containers.filter((container) => container.state === "running").length;
  const attention = containers.containers.filter(needsAttention).length;
  const shown =
    variant === "detail"
      ? containers.containers.slice(0, DETAIL_ROWS)
      : containers.containers.slice(0, COMPACT_ROWS);

  return (
    <div className="widget-body" data-widget-variant={variant}>
      <WidgetMetrics>
        <WidgetMetric label="Running" value={running} tone={running > 0 ? "notable" : "default"} />
        <WidgetMetric label="Containers" value={containers.containers.length} />
        <WidgetMetric label="Images" value={images.images.length} />
        {attention > 0 ? <WidgetMetric label="Attention" value={attention} tone="loud" /> : null}
      </WidgetMetrics>
      <div className={variant === "detail" ? "widget-detail-rows" : "widget-compact-rows"}>
        {shown.map((container) => (
          <ContainerRow key={container.id} container={container} />
        ))}
      </div>
      {variant === "detail" && containers.containers.length > DETAIL_ROWS ? (
        <p className="px-4 py-1.5 text-[11px] text-muted-foreground">
          Showing {DETAIL_ROWS} of {containers.containers.length} containers.
        </p>
      ) : null}
    </div>
  );
}
