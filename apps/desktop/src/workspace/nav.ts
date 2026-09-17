export type WorkspaceRoute =
  | { name: "home" }
  | { name: "deliveries" }
  | { name: "delivery"; id: string }
  | { name: "connections" }
  | { name: "settings" }
  | { name: "kubernetes" }
  | { name: "first-run" };

export type NavItem = {
  id: "home" | "deliveries" | "kubernetes" | "connections" | "settings";
  label: string;
};

export const PRIMARY_NAV: NavItem[] = [
  { id: "home", label: "Home" },
  { id: "deliveries", label: "Deliveries" },
  { id: "kubernetes", label: "Kubernetes" },
];

export const SECONDARY_NAV: NavItem[] = [
  { id: "connections", label: "Connections" },
  { id: "settings", label: "Settings" },
];

export const FIRST_RUN_KEY = "srelens.workspace.firstRunDone";

export function loadFirstRunDone(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveFirstRunDone(): void {
  try {
    localStorage.setItem(FIRST_RUN_KEY, "1");
  } catch {
    /* storage blocked — stay on first-run until it works */
  }
}
