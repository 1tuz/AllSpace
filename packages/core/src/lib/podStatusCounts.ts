import { invokeCapability, type Invoker } from "../transport/transport";

/**
 * Pod tallies by Kubernetes phase. Counts only — the backend never ships
 * pod bodies (see `crates/kube/src/pod_status_counts.rs`).
 */
export interface PodStatusCounts {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  unknown: number;
  /** Phase outside the five named Pod phases; normally zero. */
  other: number;
}

export interface PodStatusCountsOutcome {
  counts?: PodStatusCounts;
  error?: string;
}

/**
 * Load a cluster's pod phase distribution via `k8s.podStatusCounts`.
 * Timeout / transport failure → `error` with no `counts`, never a zero row.
 */
export async function podStatusCounts(
  context: string,
  invoke: Invoker = invokeCapability,
): Promise<PodStatusCountsOutcome> {
  try {
    const counts = await invoke<PodStatusCounts>("k8s.podStatusCounts", { context });
    return { counts };
  } catch (e) {
    return { error: String(e) };
  }
}
