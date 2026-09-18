/**
 * Live connection health for Workspace Connections.
 * Credentials stay in the vault — only presence + probe outcomes reach React.
 */

import {
  describeError,
  devopsCredentialStatus,
  devopsProfilesList,
  invokeCapability,
  type DevOpsCredentialRef,
  type DevOpsProfile,
  type DevOpsProvider,
} from "@srelens/core";

/** Distinct failure / success modes — never collapse into empty success. */
export type ConnectionHealthKind =
  | "loading"
  | "credential_missing"
  | "credential_configured"
  | "ok"
  | "valid_empty"
  | "auth_failure"
  | "authorization"
  | "tls"
  | "reachability"
  | "status_unavailable"
  | "probe_unavailable";

export interface ProviderHealthRow {
  profileId: string;
  profileLabel: string;
  provider: DevOpsProvider;
  providerLabel: string;
  baseUrl: string;
  kind: ConnectionHealthKind;
  /** Short product copy — never secrets. */
  detail: string;
}

const PROVIDER_LABEL: Record<DevOpsProvider, string> = {
  jira: "Jira",
  gitlab: "GitLab",
  bitbucketDc: "Bitbucket DC",
  jenkins: "Jenkins",
};

/** Lightweight read probe per provider — same caps panels already use. */
const PROBE: Record<
  DevOpsProvider,
  { capability: string; payload: Record<string, unknown>; listKey: string }
> = {
  jira: { capability: "jira.searchIssues", payload: { issueKeys: [] }, listKey: "issues" },
  gitlab: { capability: "gitlab.listMergeRequests", payload: {}, listKey: "mergeRequests" },
  bitbucketDc: { capability: "bitbucket.listPullRequests", payload: {}, listKey: "pullRequests" },
  jenkins: { capability: "jenkins.listBuilds", payload: {}, listKey: "builds" },
};

export function providerLabel(provider: DevOpsProvider): string {
  return PROVIDER_LABEL[provider];
}

export function healthKindLabel(kind: ConnectionHealthKind): string {
  switch (kind) {
    case "loading":
      return "Checking";
    case "credential_missing":
      return "Credential missing";
    case "credential_configured":
      return "Credential stored";
    case "ok":
      return "Reachable";
    case "valid_empty":
      return "Reachable (empty)";
    case "auth_failure":
      return "Authentication failed";
    case "authorization":
      return "Not authorized";
    case "tls":
      return "TLS problem";
    case "reachability":
      return "Unreachable";
    case "status_unavailable":
      return "Status unavailable";
    case "probe_unavailable":
      return "Check failed";
  }
}

/**
 * Map a provider error string to the health taxonomy.
 * Prefer raw message patterns over kube-oriented describeError titles.
 */
export function classifyProviderError(input: unknown): ConnectionHealthKind {
  const raw = describeError(input, { domain: "http" }).raw.toLowerCase();

  if (/no credential is stored|credential missing|missing credential/.test(raw)) {
    return "credential_missing";
  }
  if (/certificate|x509|\btls\b|self.?signed|unknown authority|ssl/.test(raw)) {
    return "tls";
  }
  if (
    /connection refused|failed to connect|connect error|\(connect\)|no route to host|network is unreachable|unreachable|timed out|timeout|deadline exceeded|no such host|failed to lookup|name or service not known|could not resolve|cannot resolve|dns/.test(
      raw,
    )
  ) {
    return "reachability";
  }
  // 401 / bad password / invalid token — authentication, not RBAC.
  if (/unauthorized|\b401\b|authentication|invalid (bearer|token|credentials|password)|login failed|wrong password/.test(raw)) {
    return "auth_failure";
  }
  // 403 / forbidden — authenticated but not allowed.
  if (/forbidden|\b403\b|access denied|permission denied|not permitted/.test(raw)) {
    return "authorization";
  }
  return "probe_unavailable";
}

export function detailForKind(kind: ConnectionHealthKind, rawMessage?: string): string {
  switch (kind) {
    case "loading":
      return "Checking…";
    case "credential_missing":
      return "No credential in the vault for this provider. Store one in Settings after unlock.";
    case "credential_configured":
      return "Credential stored. Select this profile to run a reachability check.";
    case "ok":
      return "Provider answered with data.";
    case "valid_empty":
      return "Provider answered; no matching items for current filters (valid empty).";
    case "auth_failure":
      return rawMessage
        ? `Authentication failed: ${rawMessage}`
        : "Authentication failed — check username, password, or token in Settings.";
    case "authorization":
      return rawMessage
        ? `Not authorized: ${rawMessage}`
        : "Authenticated, but this account lacks permission for the request.";
    case "tls":
      return rawMessage
        ? `TLS: ${rawMessage}. Fix in Settings → DevOps: set a corporate CA PEM path, or enable Allow insecure TLS only as an explicit escape hatch.`
        : "TLS certificate could not be verified. Fix in Settings → DevOps: set a corporate CA PEM path (preferred), or enable Allow insecure TLS only as an explicit escape hatch.";
    case "reachability":
      return rawMessage
        ? `Unreachable: ${rawMessage}`
        : "Host could not be reached (network, DNS, or timeout).";
    case "status_unavailable":
      return rawMessage
        ? `Could not read credential status: ${rawMessage}`
        : "Could not read credential status (vault locked or host unavailable).";
    case "probe_unavailable":
      return rawMessage ?? "Provider check failed.";
  }
}

function credentialStored(
  refs: DevOpsCredentialRef[],
  profileId: string,
  provider: DevOpsProvider,
): boolean {
  return refs.some((r) => r.profileId === profileId && r.provider === provider);
}

function listLength(out: unknown, listKey: string): number {
  if (!out || typeof out !== "object") return 0;
  const value = (out as Record<string, unknown>)[listKey];
  return Array.isArray(value) ? value.length : 0;
}

async function probeProvider(provider: DevOpsProvider): Promise<{
  kind: ConnectionHealthKind;
  detail: string;
}> {
  const spec = PROBE[provider];
  try {
    const out = await invokeCapability<unknown>(spec.capability, spec.payload);
    const n = listLength(out, spec.listKey);
    if (n === 0) {
      return { kind: "valid_empty", detail: detailForKind("valid_empty") };
    }
    return { kind: "ok", detail: detailForKind("ok") };
  } catch (reason: unknown) {
    const kind = classifyProviderError(reason);
    const friendly = describeError(reason, { domain: "http" });
    const short = friendly.raw || friendly.detail;
    return { kind, detail: detailForKind(kind, short) };
  }
}

export interface LoadConnectionHealthOptions {
  /** Injectable for tests. */
  listProfiles?: typeof devopsProfilesList;
  credentialStatus?: typeof devopsCredentialStatus;
  probe?: typeof probeProvider;
}

/**
 * Build health rows for every provider on every profile.
 * Probes the active profile when its credential is stored.
 */
export async function loadConnectionHealth(
  options: LoadConnectionHealthOptions,
): Promise<{ rows: ProviderHealthRow[]; statusError: string | null }> {
  const listProfiles = options.listProfiles ?? devopsProfilesList;
  const credentialStatus = options.credentialStatus ?? devopsCredentialStatus;
  const probe = options.probe ?? probeProvider;

  let profiles: DevOpsProfile[] = [];
  let activeProfileId = "";
  let refs: DevOpsCredentialRef[] = [];
  let statusError: string | null = null;

  try {
    const [state, credentials] = await Promise.all([listProfiles(), credentialStatus()]);
    profiles = state.profiles ?? [];
    activeProfileId = state.activeProfileId ?? profiles[0]?.id ?? "";
    refs = credentials ?? [];
  } catch (reason: unknown) {
    const friendly = describeError(reason, { domain: "local" });
    statusError = detailForKind("status_unavailable", friendly.raw || friendly.detail);
    return { rows: [], statusError };
  }

  const rows: ProviderHealthRow[] = [];

  for (const profile of profiles) {
    // Provider caps resolve the *active* profile only — never probe another
    // contour's credential against the wrong connection.
    const canProbe = profile.id === activeProfileId;

    for (const p of profile.providers) {
      const base: Omit<ProviderHealthRow, "kind" | "detail"> = {
        profileId: profile.id,
        profileLabel: profile.label,
        provider: p.provider,
        providerLabel: providerLabel(p.provider),
        baseUrl: p.baseUrl,
      };

      if (!credentialStored(refs, profile.id, p.provider)) {
        rows.push({
          ...base,
          kind: "credential_missing",
          detail: detailForKind("credential_missing"),
        });
        continue;
      }

      if (!canProbe) {
        rows.push({
          ...base,
          kind: "credential_configured",
          detail: detailForKind("credential_configured"),
        });
        continue;
      }

      const result = await probe(p.provider);
      rows.push({ ...base, kind: result.kind, detail: result.detail });
    }
  }

  return { rows, statusError };
}
