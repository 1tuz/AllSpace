import { invokeCapability, type Invoker } from "../transport/transport";

export type CicdFailure = {
  jobId: number;
  jobName: string;
  stage: string;
  failureReason?: string | null;
};

export type PipelineJobEntity = {
  id: string;
  kind: string;
  source: string;
  title: string;
  url?: string | null;
  attributes?: Record<string, unknown>;
};

export type PipelineJobsOutcome = {
  jobs: PipelineJobEntity[];
  failure?: CicdFailure | null;
  truncated?: boolean;
};

export type JobTraceOutcome = {
  text: string;
  truncated: boolean;
  projectId: number;
  jobId: number;
};

export type BuildLogOutcome = {
  text: string;
  truncated: boolean;
  jobPath: string;
  buildNumber: number;
  failureStage?: string | null;
};

/** `gitlab.getPipelineJobs` — stages/jobs + failure location. */
export async function getPipelineJobs(
  projectId: number,
  pipelineId: number,
  invoke: Invoker = invokeCapability,
): Promise<PipelineJobsOutcome> {
  return invoke<PipelineJobsOutcome>("gitlab.getPipelineJobs", { projectId, pipelineId });
}

/** `gitlab.getJobTrace` — bounded plain-text log tail. */
export async function getJobTrace(
  projectId: number,
  jobId: number,
  options: { maxBytes?: number } = {},
  invoke: Invoker = invokeCapability,
): Promise<JobTraceOutcome> {
  const payload: Record<string, unknown> = { projectId, jobId };
  if (options.maxBytes != null) payload.maxBytes = options.maxBytes;
  return invoke<JobTraceOutcome>("gitlab.getJobTrace", payload);
}

/** `jenkins.getBuildLog` — bounded consoleText tail (+ optional failure stage). */
export async function getBuildLog(
  jobPath: string,
  buildNumber: number,
  options: { maxBytes?: number } = {},
  invoke: Invoker = invokeCapability,
): Promise<BuildLogOutcome> {
  const payload: Record<string, unknown> = { jobPath, buildNumber };
  if (options.maxBytes != null) payload.maxBytes = options.maxBytes;
  return invoke<BuildLogOutcome>("jenkins.getBuildLog", payload);
}
