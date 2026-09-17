import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  devopsCredentialClear,
  devopsCredentialSet,
  devopsCredentialStatus,
  devopsProfileSelect,
  devopsProfilesList,
  devopsProfileUpsert,
  notify,
  type DevOpsCredentialRef,
  type DevOpsProfile,
  type DevOpsProvider,
} from "@srelens/core";
import { Button, TextInput } from "../ui";
import { CONTOUR_PRESETS, contourById, type ContourId } from "../workspace/contours";

export type ProfileDraft = {
  id: string;
  label: string;
  jiraUrl: string;
  gitlabUrl: string;
  gitlabProjects: string;
  bitbucketUrl: string;
  bitbucketProjects: string;
  jenkinsUrl: string;
  jenkinsJobs: string;
};

const EMPTY_DRAFT: ProfileDraft = {
  id: "appfarm",
  label: "AppFarm",
  jiraUrl: "",
  gitlabUrl: "",
  gitlabProjects: "",
  bitbucketUrl: "",
  bitbucketProjects: "",
  jenkinsUrl: "",
  jenkinsJobs: "",
};

function splitFilters(raw: string): string[] {
  return raw.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
}

function draftFor(profile?: DevOpsProfile): ProfileDraft {
  const jira = profile?.providers.find((provider) => provider.provider === "jira");
  const gitlab = profile?.providers.find((provider) => provider.provider === "gitlab");
  const bitbucket = profile?.providers.find((provider) => provider.provider === "bitbucketDc");
  const jenkins = profile?.providers.find((provider) => provider.provider === "jenkins");
  return profile
    ? {
        id: profile.id,
        label: profile.label,
        jiraUrl: jira?.baseUrl ?? "",
        gitlabUrl: gitlab?.baseUrl ?? "",
        gitlabProjects: gitlab?.projectFilters.join("\n") ?? "",
        bitbucketUrl: bitbucket?.baseUrl ?? "",
        bitbucketProjects: bitbucket?.projectFilters.join("\n") ?? "",
        jenkinsUrl: jenkins?.baseUrl ?? "",
        jenkinsJobs: jenkins?.projectFilters.join("\n") ?? "",
      }
    : EMPTY_DRAFT;
}

export function draftFromContour(id: ContourId): ProfileDraft {
  const contour = contourById(id);
  if (!contour) return EMPTY_DRAFT;
  const jira = contour.providers.find((p) => p.provider === "jira");
  const gitlab = contour.providers.find((p) => p.provider === "gitlab");
  const bitbucket = contour.providers.find((p) => p.provider === "bitbucketDc");
  const jenkins = contour.providers.find((p) => p.provider === "jenkins");
  return {
    id: contour.id,
    label: contour.label,
    jiraUrl: jira?.baseUrl ?? "",
    gitlabUrl: gitlab?.baseUrl ?? "",
    gitlabProjects: (gitlab?.projectFilters ?? []).join("\n"),
    bitbucketUrl: bitbucket?.baseUrl ?? "",
    bitbucketProjects: (bitbucket?.projectFilters ?? []).join("\n"),
    jenkinsUrl: jenkins?.baseUrl ?? "",
    jenkinsJobs: (jenkins?.projectFilters ?? []).join("\n"),
  };
}

export function profileFor(draft: ProfileDraft): DevOpsProfile {
  return {
    id: draft.id.trim(),
    label: draft.label.trim(),
    providers: [
      ...(draft.jiraUrl.trim()
        ? [{ provider: "jira" as const, baseUrl: draft.jiraUrl.trim(), authMethod: "session" as const, projectFilters: [] }]
        : []),
      ...(draft.gitlabUrl.trim()
        ? [{
            provider: "gitlab" as const,
            baseUrl: draft.gitlabUrl.trim().replace(/\/$/, ""),
            authMethod: "accessToken" as const,
            projectFilters: splitFilters(draft.gitlabProjects),
          }]
        : []),
      ...(draft.bitbucketUrl.trim()
        ? [{
            provider: "bitbucketDc" as const,
            baseUrl: draft.bitbucketUrl.trim().replace(/\/$/, ""),
            authMethod: "bearerToken" as const,
            projectFilters: splitFilters(draft.bitbucketProjects),
          }]
        : []),
      ...(draft.jenkinsUrl.trim()
        ? [{
            provider: "jenkins" as const,
            baseUrl: draft.jenkinsUrl.trim().replace(/\/$/, ""),
            authMethod: "basic" as const,
            projectFilters: splitFilters(draft.jenkinsJobs),
          }]
        : []),
    ],
  };
}

function configured(status: DevOpsCredentialRef[], profileId: string, provider: DevOpsProvider) {
  return status.some((entry) => entry.profileId === profileId && entry.provider === provider);
}

function providerLabel(provider: DevOpsProvider): string {
  switch (provider) {
    case "jira":
      return "Jira";
    case "gitlab":
      return "GitLab";
    case "bitbucketDc":
      return "Bitbucket";
    case "jenkins":
      return "Jenkins";
    default:
      return provider;
  }
}

/** Settings → DevOps. Public profile metadata is persisted through capabilities;
 * credentials go only through desktop vault commands and are never read back. */
export function DevOpsSettingsSection() {
  const [profiles, setProfiles] = useState<DevOpsProfile[]>([]);
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [stored, setStored] = useState<DevOpsCredentialRef[]>([]);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const active = useMemo(() => profiles.find((profile) => profile.id === activeId), [activeId, profiles]);

  function refresh() {
    return Promise.all([devopsProfilesList(), devopsCredentialStatus()]).then(([state, credentials]) => {
      setProfiles(state.profiles);
      const id = state.activeProfileId ?? state.profiles[0]?.id ?? "";
      setActiveId(id);
      setDraft(draftFor(state.profiles.find((profile) => profile.id === id)));
      setStored(credentials);
    });
  }

  useEffect(() => {
    refresh().catch((error) => notify.error(String(error)));
  }, []);

  async function chooseProfile(profileId: string) {
    setBusy(true);
    try {
      const state = await devopsProfileSelect(profileId);
      setProfiles(state.profiles);
      setActiveId(profileId);
      setDraft(draftFor(state.profiles.find((profile) => profile.id === profileId)));
    } catch (error) {
      notify.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function applyContour(id: ContourId) {
    const next = draftFromContour(id);
    setDraft(next);
    setBusy(true);
    try {
      const state = await devopsProfileUpsert(profileFor(next), true);
      setProfiles(state.profiles);
      setActiveId(next.id);
      notify.success(`${next.label} public endpoints saved — paste credentials below (from sibling .env)`);
    } catch (error) {
      notify.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    const profile = profileFor(draft);
    if (!profile.id || !profile.label || profile.providers.length === 0) {
      notify.error("Enter profile name and at least one HTTPS endpoint");
      return;
    }
    setBusy(true);
    try {
      const state = await devopsProfileUpsert(profile, true);
      setProfiles(state.profiles);
      setActiveId(profile.id);
      setDraft(draftFor(profile));
      notify.success("DevOps profile saved");
    } catch (error) {
      notify.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveCredential(provider: DevOpsProvider) {
    const profileId = active?.id;
    const secret = secrets[provider]?.trim();
    if (!profileId || !secret) return;
    setBusy(true);
    try {
      await devopsCredentialSet(profileId, provider, usernames[provider] ?? "", secret);
      setSecrets((values) => ({ ...values, [provider]: "" }));
      setStored(await devopsCredentialStatus());
      notify.success(`${providerLabel(provider)} credential saved`);
    } catch (error) {
      notify.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function clearCredential(provider: DevOpsProvider) {
    if (!active) return;
    setBusy(true);
    try {
      await devopsCredentialClear(active.id, provider);
      setStored(await devopsCredentialStatus());
      notify.success("Credential removed");
    } catch (error) {
      notify.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  function field(name: keyof ProfileDraft, label: string, placeholder: string) {
    return (
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">{label}</span>
        <TextInput value={draft[name]} placeholder={placeholder} onValueChange={(value) => setDraft((current) => ({ ...current, [name]: value }))} />
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">DevOps sources</h2>
        <p className="text-sm text-muted-foreground">
          Profiles keep endpoint metadata. Credentials are encrypted locally and this screen never reads them back.
          Contour presets match sibling AppFarm / Komus repos — see docs/devops-cockpit/CONTOURS.md.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {CONTOUR_PRESETS.map((contour) => (
          <Button key={contour.id} variant="secondary" disabled={busy} onClick={() => void applyContour(contour.id)}>
            Apply {contour.label} endpoints
          </Button>
        ))}
      </div>

      {profiles.length > 0 && (
        <label className="flex max-w-md flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Active profile</span>
          <select className="h-9 rounded-md border border-border bg-background px-2" value={activeId} onChange={(event) => chooseProfile(event.target.value)} disabled={busy}>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
          </select>
        </label>
      )}

      <div className="flex max-w-xl flex-col gap-3 border-t border-border pt-5">
        {field("id", "Profile ID", "appfarm")}
        {field("label", "Profile name", "AppFarm")}
        {field("jiraUrl", "Jira base URL", "https://sdlc.go.rshbank.ru/jira")}
        {field("gitlabUrl", "GitLab base URL", "https://gitlab.rshbdev.ru")}
        {field("gitlabProjects", "GitLab projects", "group/project")}
        {field("bitbucketUrl", "Bitbucket DC base URL", "https://bitbucket-app.komus.net")}
        {field("bitbucketProjects", "Bitbucket projects", "CORP")}
        {field("jenkinsUrl", "Jenkins base URL", "https://p-doffice-cicd01.komus.net")}
        {field("jenkinsJobs", "Jenkins job path prefixes", "folder/job")}
        <div><Button onClick={saveProfile} disabled={busy}>Save profile</Button></div>
      </div>

      {active?.providers.map((provider) => {
        const hasCredential = configured(stored, active.id, provider.provider);
        const label = providerLabel(provider.provider);
        const needsUser = provider.provider === "jira" || provider.provider === "jenkins";
        const secretLabel =
          provider.provider === "gitlab" || provider.provider === "bitbucketDc" ? "Access / bearer token" : "Password / API token";
        return (
          <div key={provider.provider} className="flex max-w-xl flex-col gap-3 border-t border-border pt-5">
            <div>
              <h3 className="text-sm font-semibold">{label}</h3>
              <p className="text-xs text-muted-foreground">
                {hasCredential ? "credential stored" : "credential missing"} · {provider.baseUrl}
              </p>
            </div>
            {needsUser && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted-foreground">Username</span>
                <TextInput
                  value={usernames[provider.provider] ?? ""}
                  onValueChange={(value) => setUsernames((current) => ({ ...current, [provider.provider]: value }))}
                />
              </label>
            )}
            <div className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="text-xs text-muted-foreground">{secretLabel}</span>
                <TextInput
                  type="password"
                  placeholder={hasCredential ? "•••• (stored) — enter a new value to replace" : "Paste credential"}
                  value={secrets[provider.provider] ?? ""}
                  onValueChange={(value) => setSecrets((current) => ({ ...current, [provider.provider]: value }))}
                />
              </label>
              <Button onClick={() => saveCredential(provider.provider)} disabled={busy || !secrets[provider.provider]?.trim()}>
                Save
              </Button>
              {hasCredential && (
                <Button variant="ghost" onClick={() => clearCredential(provider.provider)} disabled={busy} aria-label={`Remove ${label} credential`}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
