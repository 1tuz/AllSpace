import { invokeCapability, invokeCommand } from "../transport/transport";

export type DevOpsProvider = "jira" | "gitlab" | "bitbucketDc" | "jenkins";
export type DevOpsAuthMethod = "session" | "accessToken" | "basic" | "bearerToken";

export interface DevOpsProviderConfig {
  provider: DevOpsProvider;
  baseUrl: string;
  authMethod: DevOpsAuthMethod;
  projectFilters: string[];
}

/** Durable public configuration. Credentials deliberately do not belong here. */
export interface DevOpsProfile {
  id: string;
  label: string;
  providers: DevOpsProviderConfig[];
}

export interface DevOpsProfilesState {
  activeProfileId?: string;
  profiles: DevOpsProfile[];
}

/** A reference with a stored value. The value itself is never returned. */
export interface DevOpsCredentialRef {
  profileId: string;
  provider: DevOpsProvider;
}

export interface DevOpsTraceNode {
  id: string;
  kind: string;
  source: string;
  title: string;
  url: string | null;
  attributes: Record<string, unknown>;
}

export interface DevOpsTraceEdge {
  from: string;
  to: string;
  relation: string;
  confidence: "exact" | "strong" | "heuristic";
  evidence: { kind: string; detail: string }[];
}

export interface DevOpsTrace {
  nodes: DevOpsTraceNode[];
  edges: DevOpsTraceEdge[];
  situations: { level: string; label: string }[];
  partial: boolean;
  sourceErrors: { source: string; message: string }[];
}

const TRACE_TTL_MS = 30_000;

type TraceCacheEntry = { at: number; value: Promise<DevOpsTrace> };

/** Module-level TTL cache for live delivery traces — cleared on profile switch. */
const traceDeliveryCache = new Map<string, TraceCacheEntry>();

/** Drop cached delivery traces (call after profile select / upsert). */
export function clearDevopsTraceCache(): void {
  traceDeliveryCache.clear();
}

export function devopsProfilesList(): Promise<DevOpsProfilesState> {
  return invokeCapability("devops.profiles.list", {});
}

export async function devopsProfileUpsert(profile: DevOpsProfile, select = false): Promise<DevOpsProfilesState> {
  const state = await invokeCapability<DevOpsProfilesState>("devops.profiles.upsert", { profile, select });
  clearDevopsTraceCache();
  return state;
}

export async function devopsProfileSelect(profileId: string): Promise<DevOpsProfilesState> {
  const state = await invokeCapability<DevOpsProfilesState>("devops.profiles.select", { profileId });
  clearDevopsTraceCache();
  return state;
}

/** Desktop-only command. The secret goes directly to the encrypted vault. */
export function devopsCredentialSet(
  profileId: string,
  provider: DevOpsProvider,
  username: string,
  secret: string,
): Promise<void> {
  return invokeCommand("devops_credential_set", { profileId, provider, username, secret });
}

export function devopsCredentialClear(profileId: string, provider: DevOpsProvider): Promise<void> {
  return invokeCommand("devops_credential_clear", { profileId, provider });
}

/** Reports configured profile/provider pairs; never usernames or secret values. */
export function devopsCredentialStatus(): Promise<DevOpsCredentialRef[]> {
  return invokeCommand("devops_credential_status");
}

/** Live join across configured DevOps sources. Join and evidence live in the backend. */
export function devopsTraceDelivery(issueKey: string): Promise<DevOpsTrace> {
  const now = Date.now();
  const hit = traceDeliveryCache.get(issueKey);
  if (hit && now - hit.at < TRACE_TTL_MS) {
    return hit.value;
  }
  const value = invokeCapability<DevOpsTrace>("devops.traceDelivery", { issueKey });
  traceDeliveryCache.set(issueKey, { at: now, value });
  return value;
}

/**
 * Trace a work item. Prefers the live backend join; when that returns no nodes,
 * falls back to the fixture capability so demos without credentials still answer.
 */
export async function devopsTraceIssue(issueKey: string): Promise<DevOpsTrace> {
  try {
    const live = await devopsTraceDelivery(issueKey);
    if (live.nodes.length > 0) return live;
    const fixture = await invokeCapability<DevOpsTrace>("devops.traceIssue", { issueKey });
    if (fixture.nodes.length > 0) {
      return {
        ...fixture,
        partial: live.partial || live.sourceErrors.length > 0,
        sourceErrors: live.sourceErrors,
      };
    }
    return live;
  } catch {
    return invokeCapability<DevOpsTrace>("devops.traceIssue", { issueKey });
  }
}
