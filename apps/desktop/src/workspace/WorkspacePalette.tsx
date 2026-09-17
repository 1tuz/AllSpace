import { useEffect, useMemo, useState } from "react";
import { TextInput } from "../ui";
import { FIXTURE_DELIVERIES, type Delivery } from "./fixtures";

export type PaletteAction =
  | { kind: "delivery"; id: string; label: string }
  | { kind: "nav"; route: "home" | "deliveries" | "connections" | "settings" | "kubernetes"; label: string };

const NAV_ACTIONS: PaletteAction[] = [
  { kind: "nav", route: "home", label: "Go to Home" },
  { kind: "nav", route: "deliveries", label: "Go to Deliveries" },
  { kind: "nav", route: "kubernetes", label: "Go to Kubernetes" },
  { kind: "nav", route: "connections", label: "Go to Connections" },
  { kind: "nav", route: "settings", label: "Go to Settings" },
];

function deliveryActions(): PaletteAction[] {
  return FIXTURE_DELIVERIES.map((delivery: Delivery) => ({
    kind: "delivery" as const,
    id: delivery.id,
    label: `${delivery.workId} ${delivery.title} · ${delivery.contour}`,
  }));
}

/** Delivery-first command palette — Stage 2 foundation (no cluster indexing). */
export function WorkspacePalette({
  open,
  onClose,
  onAction,
}: {
  open: boolean;
  onClose: () => void;
  onAction: (action: PaletteAction) => void;
}) {
  const [query, setQuery] = useState("");
  const actions = useMemo(() => [...NAV_ACTIONS, ...deliveryActions()], []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((action) => action.label.toLowerCase().includes(needle));
  }, [actions, query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      data-testid="workspace-palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg border border-border bg-background shadow-lg">
        <div className="border-b border-border px-3 py-2">
          <TextInput
            aria-label="Search deliveries and navigation"
            placeholder="Search deliveries, navigation…"
            value={query}
            onValueChange={setQuery}
            onEscape={onClose}
            autoFocus
          />
        </div>
        <ul className="max-h-80 overflow-auto py-1">
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No matches.</li>
          )}
          {filtered.map((action) => (
            <li key={action.label}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted/60"
                onClick={() => {
                  onAction(action);
                  onClose();
                }}
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
