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
export interface DevOpsTlsConfig {
  /** Explicit escape hatch — never implied. Default false = system trust. */
  allowInsecure?: boolean;
  /** Optional path to a PEM CA bundle (corporate private CA). */
  caBundlePath?: string;
}

export interface DevOpsProfile {
  id: string;
  label: string;
  providers: DevOpsProviderConfig[];
  tls?: DevOpsTlsConfig;
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

/** Provider-neutral delivery entry. Matches Rust `DeliveryAnchor`. */
export type DeliveryAnchor =
  | { kind: "issue"; value: string; source?: string }
  | { kind: "branch"; value: string; source?: string }
  | { kind: "pullRequest"; value: string; source?: string }
  | { kind: "commit"; value: string; source?: string }
  | { kind: "build"; value: string; source?: string }
  | { kind: "artifact"; value: string; source?: string }
  | { kind: "deployment"; value: string; source?: string }
  | { kind: "workload"; value: string; source?: string };

export type DeliveryAnchorKind = DeliveryAnchor["kind"];

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

export interface DevOpsTraceSituation {
  level: string;
  label: string;
  primaryAction?: string;
}

export interface DevOpsChainVerdict {
  summary: string;
  severity: string;
  primaryAction?: string;
  ageSeconds?: number;
}

export interface DevOpsTrace {
  nodes: DevOpsTraceNode[];
  edges: DevOpsTraceEdge[];
  situations: DevOpsTraceSituation[];
  /** Present when the chain had successful evidence to judge. */
  verdict?: DevOpsChainVerdict;
  partial: boolean;
  sourceErrors: { source: string; message: string }[];
}

const TRACE_TTL_MS = 30_000;

type TraceCacheEntry = { at: number; value: Promise<DevOpsTrace> };

/** Explicit read-only runtime scope for the live delivery → Kubernetes join. */
export interface DevOpsRuntimeScope {
  kubeContext: string;
  namespaces?: string[];
}

/** Module-level TTL cache for live delivery traces — cleared on profile switch. */
const traceDeliveryCache = new Map<string, TraceCacheEntry>();

const LIST_TTL_MS = 30_000;

type ListCacheEntry = { at: number; value: Promise<DevOpsDeliveryList> };

/** Module-level TTL cache for My Work / listDeliveries — partitioned by profileId. */
const listDeliveriesCache = new Map<string, ListCacheEntry>();

/** Last selected profile — default cache partition when callers omit options.profileId. */
let activeCacheProfileId = "";

/** Drop cached delivery traces (call after profile select / upsert). */
export function clearDevopsTraceCache(): void {
  traceDeliveryCache.clear();
  listDeliveriesCache.clear();
}

function rememberActiveProfile(state: DevOpsProfilesState, fallback?: string): void {
  activeCacheProfileId = state.activeProfileId ?? fallback ?? activeCacheProfileId;
}

export async function devopsProfilesList(): Promise<DevOpsProfilesState> {
  const state = await invokeCapability<DevOpsProfilesState>("devops.profiles.list", {});
  rememberActiveProfile(state);
  return state;
}

export async function devopsProfileUpsert(profile: DevOpsProfile, select = false): Promise<DevOpsProfilesState> {
  const state = await invokeCapability<DevOpsProfilesState>("devops.profiles.upsert", { profile, select });
  clearDevopsTraceCache();
  rememberActiveProfile(state, select ? profile.id : undefined);
  return state;
}

export async function devopsProfileSelect(profileId: string): Promise<DevOpsProfilesState> {
  const state = await invokeCapability<DevOpsProfilesState>("devops.profiles.select", { profileId });
  clearDevopsTraceCache();
  rememberActiveProfile(state, profileId);
  return state;
}

/** Deleting the active profile moves the selection to a remaining one. */
export async function devopsProfileDelete(profileId: string): Promise<DevOpsProfilesState> {
  const state = await invokeCapability<DevOpsProfilesState>("devops.profiles.delete", { profileId });
  clearDevopsTraceCache();
  rememberActiveProfile(state);
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

function anchorCacheKey(anchor: DeliveryAnchor): string {
  return `${anchor.kind}\u0000${anchor.value}\u0000${anchor.source ?? ""}`;
}

function tracePayload(anchor: DeliveryAnchor, scope?: DevOpsRuntimeScope): Record<string, unknown> {
  const runtimeScope = scope?.kubeContext
    ? { kubeContext: scope.kubeContext, namespaces: scope.namespaces ?? [] }
    : {};
  // Prefer the multi-anchor contract. Legacy issueKey kept only for issue anchors
  // so older backends still accept the call during rollout.
  if (anchor.kind === "issue") {
    return { anchor, issueKey: anchor.value, ...runtimeScope };
  }
  return { anchor, ...runtimeScope };
}

/** Optional cache-partition key — AppFarm vs Komus must not share a TTL hit. */
export interface DevOpsTraceOptions {
  profileId?: string;
}

/** Live join across configured DevOps sources. Join and evidence live in the backend. */
export function devopsTraceDelivery(
  anchor: DeliveryAnchor | string,
  scope?: DevOpsRuntimeScope,
  options?: DevOpsTraceOptions,
): Promise<DevOpsTrace> {
  const resolved: DeliveryAnchor = typeof anchor === "string" ? { kind: "issue", value: anchor } : anchor;
  const now = Date.now();
  const runtimeScope = scope?.kubeContext
    ? { kubeContext: scope.kubeContext, namespaces: scope.namespaces ?? [] }
    : undefined;
  const profileId = options?.profileId ?? activeCacheProfileId;
  const cacheKey = `${anchorCacheKey(resolved)}\u0000${runtimeScope?.kubeContext ?? ""}\u0000${runtimeScope?.namespaces.join("\u0001") ?? ""}\u0000${profileId}`;
  const hit = traceDeliveryCache.get(cacheKey);
  if (hit && now - hit.at < TRACE_TTL_MS) {
    return hit.value;
  }
  const value = invokeCapability<DevOpsTrace>("devops.traceDelivery", tracePayload(resolved, scope));
  traceDeliveryCache.set(cacheKey, { at: now, value });
  return value;
}

/** Alias — same wire capability `devops.traceDelivery`. */
export const resolveDelivery = devopsTraceDelivery;

/** Provider-neutral search hits — anchors only; never invent provider facts in the UI. */
export interface DevOpsSearchResult {
  anchors: DeliveryAnchor[];
  partial: boolean;
  sourceErrors: { source: string; message: string }[];
}

export interface DevOpsSearchOptions {
  profileId?: string;
}

/**
 * `devops.search` — local issue-key/SHA/PR/build suggestions via the capability
 * seam, plus Jira/GitLab/Bitbucket/Jenkins confirmation on the active profile.
 * Answers stay partial (list snapshots, not full history); React must not fetch
 * providers itself.
 */
export function devopsSearch(query: string, options?: DevOpsSearchOptions): Promise<DevOpsSearchResult> {
  const payload: Record<string, unknown> = { query };
  if (options?.profileId) {
    payload.profileId = options.profileId;
  }
  return invokeCapability<DevOpsSearchResult>("devops.search", payload);
}

/** Compact live Delivery row — matches Rust `DeliverySummary`. */
export interface DevOpsDeliverySummary {
  id: string;
  anchor: DeliveryAnchor;
  title: string;
  workId?: string;
  stage: string;
  stageLabel: string;
  updated?: string;
  situations: DevOpsTraceSituation[];
  verdict?: DevOpsChainVerdict;
  partial: boolean;
  sourceErrors: { source: string; message: string }[];
}

export interface DevOpsDeliveryList {
  deliveries: DevOpsDeliverySummary[];
  partial: boolean;
  sourceErrors: { source: string; message: string }[];
}

export interface DevOpsListOptions {
  profileId?: string;
  /** Max rows (backend default 40, hard max 80). */
  limit?: number;
}

function listPayload(options?: DevOpsListOptions): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (options?.profileId) {
    payload.profileId = options.profileId;
  }
  if (options?.limit != null) {
    payload.limit = options.limit;
  }
  return payload;
}

function listCacheKey(capability: string, options?: DevOpsListOptions): string {
  const profileId = options?.profileId ?? activeCacheProfileId;
  return `${capability}\u0000${profileId}\u0000${options?.limit ?? ""}`;
}

function cachedListInvoke(
  capability: "devops.listDeliveries" | "devops.myWork",
  options?: DevOpsListOptions,
): Promise<DevOpsDeliveryList> {
  const now = Date.now();
  const cacheKey = listCacheKey(capability, options);
  const hit = listDeliveriesCache.get(cacheKey);
  if (hit && now - hit.at < LIST_TTL_MS) {
    return hit.value;
  }
  const value = invokeCapability<DevOpsDeliveryList>(capability, listPayload(options));
  listDeliveriesCache.set(cacheKey, { at: now, value });
  return value;
}

/**
 * `devops.listDeliveries` — bounded live Delivery summaries from active profile
 * providers.
 */
export function devopsListDeliveries(options?: DevOpsListOptions): Promise<DevOpsDeliveryList> {
  return cachedListInvoke("devops.listDeliveries", options);
}

/**
 * `devops.myWork` — actionable / recent subset of the same live source.
 */
export function devopsMyWork(options?: DevOpsListOptions): Promise<DevOpsDeliveryList> {
  return cachedListInvoke("devops.myWork", options);
}

/** One Jira issue link from `jira.getIssue`. */
export interface JiraIssueLink {
  relation: string;
  issueKey: string;
  summary?: string;
}

/** Bounded comment/activity row from `jira.getIssue`. */
export interface JiraIssueActivity {
  kind: string;
  summary: string;
  author?: string;
  at?: string;
}

/** Selected-issue detail — summary/status/assignee on `issue.attributes`, plus links/activity. */
export interface JiraIssueDetail {
  issue: {
    id: string;
    kind: string;
    source: string;
    title: string;
    url: string | null;
    attributes: Record<string, unknown>;
  };
  links: JiraIssueLink[];
  activity: JiraIssueActivity[];
}

/**
 * `jira.getIssue` — live selected-issue detail through the active DevOps profile.
 */
export function jiraGetIssue(issueKey: string): Promise<JiraIssueDetail> {
  return invokeCapability<JiraIssueDetail>("jira.getIssue", { issueKey });
}
