/** Public contour presets — URLs and paths only. Secrets stay in sibling .env / vault. */

export type ContourId = "appfarm" | "komus";

export interface ContourProviderPreset {
  provider: "jira" | "gitlab" | "bitbucketDc" | "jenkins";
  label: string;
  baseUrl: string;
  authMethod: "session" | "accessToken" | "basic" | "bearerToken";
  /** Env keys in the sibling credential file (values never committed here). */
  envKeys: string[];
  /** Optional project / job path prefixes applied when the contour is loaded. */
  projectFilters?: string[];
}

export interface ContourPreset {
  id: ContourId;
  label: string;
  summary: string;
  credentialEnvFile: string;
  kubeconfigDir: string;
  kubeconfigHints: string[];
  providers: ContourProviderPreset[];
}

export const CONTOUR_PRESETS: ContourPreset[] = [
  {
    id: "appfarm",
    label: "AppFarm",
    summary: "Jira DC · GitLab CE · Kubernetes (ops/kubeconfigs)",
    credentialEnvFile: "/Users/antony/Documents/projects/AppFarm/scripts/daily-reports-master/.env",
    kubeconfigDir: "/Users/antony/Documents/projects/AppFarm/ops/kubeconfigs",
    kubeconfigHints: ["cpstbl.yaml", "devstbl.yaml", "rcsdstbl.yaml", "apistbl.yaml", "infrastbl.yaml", "cpdev.yaml"],
    providers: [
      {
        provider: "jira",
        label: "Jira Data Center",
        baseUrl: "https://sdlc.go.rshbank.ru/jira",
        authMethod: "session",
        envKeys: ["JIRA_USERNAME", "JIRA_PASSWORD", "JIRA_DOMAIN"],
      },
      {
        provider: "gitlab",
        label: "GitLab CE",
        baseUrl: "https://gitlab.rshbdev.ru",
        authMethod: "accessToken",
        // GITLAB_PROJECTS: comma-separated group/project paths (user fills; not seeded here).
        envKeys: ["GITLAB_URL", "GITLAB_TOKEN", "GITLAB_PROJECTS"],
        projectFilters: [],
      },
    ],
  },
  {
    id: "komus",
    label: "Komus",
    summary: "Bitbucket DC · Jenkins · Kubernetes (kubeconfigs/)",
    credentialEnvFile: "/Users/antony/Documents/projects/komus/.ai/mcp/mcp.env",
    kubeconfigDir: "/Users/antony/Documents/projects/komus/kubeconfigs",
    kubeconfigHints: ["dev.yaml", "stage.yaml", "uat.yaml", "prod.yaml", "qa.yaml"],
    providers: [
      {
        provider: "bitbucketDc",
        label: "Bitbucket Data Center",
        baseUrl: "https://bitbucket-app.komus.net",
        authMethod: "bearerToken",
        envKeys: ["BITBUCKET_URL", "BITBUCKET_TOKEN"],
        projectFilters: ["CORP"],
      },
      {
        provider: "jenkins",
        label: "Jenkins",
        baseUrl: "https://p-doffice-cicd01.komus.net",
        authMethod: "basic",
        envKeys: ["JENKINS_URL", "JENKINS_USERNAME", "JENKINS_PASSWORD"],
        projectFilters: [],
      },
    ],
  },
];

export function contourById(id: string): ContourPreset | undefined {
  return CONTOUR_PRESETS.find((c) => c.id === id);
}
