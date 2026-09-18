import { invokeCapability, type Invoker } from "../transport/transport";

/** One bounded changed file from GitLab MR / Bitbucket PR diff caps. */
export type ChangeDiffFile = {
  path: string;
  oldPath?: string | null;
  status: string;
  patch?: string | null;
};

export type ChangeDiffOutcome = {
  files: ChangeDiffFile[];
  truncated: boolean;
  totalFiles: number;
};

export type GetMergeRequestDiffInput = {
  projectId: string | number;
  iid: string | number;
  maxFiles?: number;
};

export type GetPullRequestDiffInput = {
  projectKey: string;
  repositorySlug: string;
  pullRequestId: string | number;
  maxFiles?: number;
};

/** `gitlab.getMergeRequestDiff` — lazy bounded file diffs for one MR. */
export async function getMergeRequestDiff(
  input: GetMergeRequestDiffInput,
  invoke: Invoker = invokeCapability,
): Promise<ChangeDiffOutcome> {
  const payload: Record<string, unknown> = {
    projectId: String(input.projectId),
    iid: Number(input.iid),
  };
  if (input.maxFiles != null) payload.maxFiles = input.maxFiles;
  return invoke<ChangeDiffOutcome>("gitlab.getMergeRequestDiff", payload);
}

/** `bitbucket.getPullRequestDiff` — lazy bounded file diffs for one PR. */
export async function getPullRequestDiff(
  input: GetPullRequestDiffInput,
  invoke: Invoker = invokeCapability,
): Promise<ChangeDiffOutcome> {
  const payload: Record<string, unknown> = {
    projectKey: input.projectKey,
    repositorySlug: input.repositorySlug,
    pullRequestId: Number(input.pullRequestId),
  };
  if (input.maxFiles != null) payload.maxFiles = input.maxFiles;
  return invoke<ChangeDiffOutcome>("bitbucket.getPullRequestDiff", payload);
}
