import { useEffect, useId, useRef } from "react";
import {
  GitBranch,
  Home,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShipWheel,
} from "lucide-react";
import type { DevOpsProfile } from "@srelens/core";
import { Combobox } from "@/ui";
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem, type WorkspaceRoute } from "./nav";

const ICONS: Record<NavItem["id"], typeof Home> = {
  home: Home,
  deliveries: GitBranch,
  kubernetes: ShipWheel,
  connections: Link2,
  settings: Settings,
};

export function WorkspaceSidebar({
  route,
  onNavigate,
  profiles,
  activeProfileId,
  onSelectProfile,
  collapsed,
  onCollapsedChange,
}: {
  route: WorkspaceRoute;
  onNavigate: (route: WorkspaceRoute) => void;
  profiles: DevOpsProfile[];
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const labelId = useId();
  const navRef = useRef<HTMLElement>(null);
  const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const profileOptions = profiles.map((p) => ({ value: p.id, label: p.label }));

  useEffect(() => {
    const root = navRef.current;
    if (!root) return;
    function onKey(event: KeyboardEvent) {
      if (!root) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-nav-item]"));
      if (buttons.length === 0) return;
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === "ArrowDown"
        ? buttons[(index + 1) % buttons.length]
        : buttons[(index - 1 + buttons.length) % buttons.length];
      next?.focus();
    }
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, []);

  function go(item: NavItem) {
    switch (item.id) {
      case "home":
        onNavigate({ name: "home" });
        break;
      case "deliveries":
        onNavigate({ name: "deliveries" });
        break;
      case "kubernetes":
        onNavigate({ name: "kubernetes" });
        break;
      case "connections":
        onNavigate({ name: "connections" });
        break;
      case "settings":
        onNavigate({ name: "settings" });
        break;
    }
  }

  return (
    <nav
      ref={navRef}
      className="workspace-shell__rail workspace-shell__drag flex shrink-0 flex-col border-r border-border"
      aria-labelledby={labelId}
      data-testid="workspace-sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      data-tauri-drag-region
    >
      <div className={`border-b border-border ${collapsed ? "px-1.5 pb-2 pt-2" : "px-3 pb-3 pt-2"}`}>
        <p id={labelId} className="sr-only">
          Salience
        </p>
        {!collapsed && profiles.length > 0 ? (
          <div className="workspace-shell__no-drag" data-testid="profile-switcher">
            <Combobox
              ariaLabel="Active profile"
              className="h-8 w-full"
              options={profileOptions}
              value={active?.id ?? activeProfileId}
              onValueChange={onSelectProfile}
              placeholder="Profile"
              searchPlaceholder="Search profiles…"
            />
          </div>
        ) : null}
      </div>
      <ul className={`flex flex-1 flex-col gap-0.5 ${collapsed ? "p-1" : "p-1.5"}`} role="list">
        {PRIMARY_NAV.map((item) => (
          <li key={item.id}>
            <NavButton
              item={item}
              active={route.name === item.id || (item.id === "deliveries" && route.name === "delivery")}
              collapsed={collapsed}
              onClick={() => go(item)}
            />
          </li>
        ))}
      </ul>
      <ul className={`flex flex-col gap-0.5 border-t border-border ${collapsed ? "p-1" : "p-1.5"}`} role="list">
        {SECONDARY_NAV.map((item) => (
          <li key={item.id}>
            <NavButton item={item} active={route.name === item.id} collapsed={collapsed} onClick={() => go(item)} />
          </li>
        ))}
      </ul>
      <div className={`border-t border-border ${collapsed ? "p-1" : "p-1.5"}`}>
        <button
          type="button"
          className={`workspace-shell__no-drag flex w-full items-center rounded-[var(--ws-radius)] text-muted-foreground hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            collapsed ? "justify-center px-0 py-2" : "gap-2 px-2.5 py-1.5 text-left text-[13px]"
          }`}
          onClick={() => onCollapsedChange(!collapsed)}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          data-testid="workspace-rail-collapse"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-3.5 shrink-0 opacity-80" aria-hidden="true" />
          ) : (
            <>
              <PanelLeftClose className="size-3.5 shrink-0 opacity-80" aria-hidden="true" />
              <span>Collapse</span>
            </>
          )}
          {collapsed ? <span className="sr-only">Expand sidebar</span> : null}
        </button>
      </div>
    </nav>
  );
}

function NavButton({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const Icon = ICONS[item.id];
  return (
    <button
      type="button"
      data-nav-item={item.id}
      onClick={onClick}
      aria-label={item.label}
      title={item.label}
      className={`workspace-shell__no-drag flex w-full items-center rounded-[var(--ws-radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        collapsed ? "justify-center px-0 py-2" : "gap-2 px-2.5 py-1.5 text-left text-[13px]"
      } ${
        active
          ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-border"
          : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
      }`}
      aria-current={active ? "page" : undefined}
    >
      {!collapsed ? (
        <span
          className={`h-4 w-0.5 shrink-0 rounded-full ${active ? "bg-primary" : "bg-transparent"}`}
          aria-hidden="true"
        />
      ) : null}
      <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden="true" />
      {!collapsed ? <span>{item.label}</span> : null}
    </button>
  );
}
