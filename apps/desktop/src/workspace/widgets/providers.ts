import type { DevOpsProfile, DevOpsProvider } from "@srelens/core";

export type GitSource = "gitlab" | "bitbucketDc";
export type CiSource = "jenkins" | "gitlab";

function config(profile: DevOpsProfile | null, provider: DevOpsProvider) {
  return profile?.providers?.find((entry) => entry.provider === provider) ?? null;
}

/** Project filters the profile already names; never a scanned default. */
export function filtersFor(profile: DevOpsProfile | null, provider: DevOpsProvider): string[] {
  return config(profile, provider)?.projectFilters?.filter((value) => value.trim()) ?? [];
}

export function hasProvider(profile: DevOpsProfile | null, provider: DevOpsProvider): boolean {
  return config(profile, provider) !== null;
}

export function gitSource(profile: DevOpsProfile | null): GitSource | null {
  if (hasProvider(profile, "gitlab")) return "gitlab";
  if (hasProvider(profile, "bitbucketDc")) return "bitbucketDc";
  return null;
}

export function ciSource(profile: DevOpsProfile | null): CiSource | null {
  if (hasProvider(profile, "jenkins")) return "jenkins";
  if (hasProvider(profile, "gitlab")) return "gitlab";
  return null;
}

export function providerLabel(provider: DevOpsProvider): string {
  switch (provider) {
    case "jira":
      return "Jira";
    case "gitlab":
      return "GitLab";
    case "bitbucketDc":
      return "Bitbucket";
    case "jenkins":
      return "Jenkins";
  }
}

/** The profile's own label for its configured projects, for empty-state copy. */
export function filtersSummary(profile: DevOpsProfile | null, provider: DevOpsProvider): string {
  const filters = filtersFor(profile, provider);
  if (filters.length === 0) return "no project filter set";
  if (filters.length === 1) return filters[0];
  return `${filters[0]} +${filters.length - 1} more`;
}
