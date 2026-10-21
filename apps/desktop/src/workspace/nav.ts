import type { DeliveryAnchor } from "@srelens/core";

export type WorkspaceRoute =
  | { name: "home" }
  | { name: "deliveries" }
  | { name: "delivery"; id: string; anchor?: DeliveryAnchor }
  | { name: "connections" }
  | { name: "settings" }
  | { name: "kubernetes" }
  | { name: "first-run" };

export type NavItem = {
  id: "home" | "deliveries" | "kubernetes" | "connections" | "settings";
  label: string;
};

export const PRIMARY_NAV: NavItem[] = [
  { id: "home", label: "My Work" },
  { id: "deliveries", label: "Deliveries" },
  { id: "kubernetes", label: "Kubernetes" },
];

export const SECONDARY_NAV: NavItem[] = [
  { id: "connections", label: "Connections" },
  { id: "settings", label: "Settings" },
];

export const FIRST_RUN_KEY = "srelens.workspace.firstRunDone";
export const RAIL_COLLAPSED_KEY = "srelens.workspace.railCollapsed";

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

export function loadRailCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveRailCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}
