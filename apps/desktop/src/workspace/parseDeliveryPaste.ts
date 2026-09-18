import type { DeliveryAnchor } from "@srelens/core";
import type { Delivery } from "./model/deliveryTypes";

const ISSUE_RE = /^[A-Z][A-Z0-9]+-\d+$/i;
const SHA_RE = /^[a-f0-9]{7,40}$/i;
const MR_RE = /^(?:([\w./-]+)!|!)(\d+)$/;
const BUILD_HASH_RE = /^#(\d+)$/;
const BUILD_JOB_RE = /^([\w./-]+)#(\d+)$/;
const BUILD_COLON_RE = /^build:(\d+)$/i;
const DEPLOY_RE = /^deploy\/([^\s]+)$/i;
const WORKLOAD_RE = /^([a-z0-9](?:[-a-z0-9]*[a-z0-9])?)\/([a-z0-9](?:[-a-z0-9]*[a-z0-9])?)$/;

/**
 * Pure paste heuristics for ⌘K multi-anchor targets.
 * Returns null when the query is empty, noisy, or not a single paste token.
 */
export function parseDeliveryPaste(raw: string): DeliveryAnchor | null {
  const q = raw.trim();
  if (!q || /\s/.test(q)) return null;

  if (ISSUE_RE.test(q)) {
    return { kind: "issue", value: q.toUpperCase() };
  }

  const mr = q.match(MR_RE);
  if (mr) {
    const project = mr[1];
    const iid = mr[2];
    return { kind: "pullRequest", value: project ? `${project}!${iid}` : iid };
  }

  const buildHash = q.match(BUILD_HASH_RE);
  if (buildHash) {
    return { kind: "build", value: buildHash[1] };
  }

  const buildColon = q.match(BUILD_COLON_RE);
  if (buildColon) {
    return { kind: "build", value: buildColon[1] };
  }

  const buildJob = q.match(BUILD_JOB_RE);
  if (buildJob) {
    return { kind: "build", value: `${buildJob[1]}#${buildJob[2]}` };
  }

  const deploy = q.match(DEPLOY_RE);
  if (deploy) {
    const rest = deploy[1];
    if (rest && !rest.includes("//") && rest.split("/").every(Boolean)) {
      return { kind: "deployment", value: rest };
    }
    return null;
  }

  if (SHA_RE.test(q)) {
    return { kind: "commit", value: q.toLowerCase() };
  }

  const workload = q.match(WORKLOAD_RE);
  if (workload) {
    // Unambiguous ns/name only — skip deploy/* (handled above) and deeper paths.
    return { kind: "workload", value: `${workload[1]}/${workload[2]}` };
  }

  return null;
}

/** Human label for a paste Trace action. */
export function deliveryPasteLabel(anchor: DeliveryAnchor): string {
  switch (anchor.kind) {
    case "issue":
      return `Trace issue ${anchor.value}`;
    case "commit":
      return `Trace commit ${anchor.value}`;
    case "pullRequest":
      return anchor.value.includes("!")
        ? `Trace pull request ${anchor.value}`
        : `Trace pull request !${anchor.value}`;
    case "build":
      return anchor.value.includes("#")
        ? `Trace build ${anchor.value}`
        : `Trace build #${anchor.value}`;
    case "deployment":
      return `Trace deployment ${anchor.value}`;
    case "workload":
      return `Trace workload ${anchor.value}`;
    case "branch":
      return `Trace branch ${anchor.value}`;
    case "artifact":
      return `Trace artifact ${anchor.value}`;
  }
}

/** Empty Custom shell so a live provider can resolve a pasted anchor. */
export function pasteDeliveryShell(id: string, anchor: DeliveryAnchor): Delivery {
  return {
    id,
    workId: anchor.value,
    title: deliveryPasteLabel(anchor).replace(/^Trace\s+\S+\s+/i, ""),
    contour: "Custom",
    service: "—",
    stage: "attention",
    stageLabel: "Paste target",
    updated: "—",
    situations: [],
    nodes: [],
    edges: [],
    partial: false,
    sourceErrors: [],
  };
}
