import { useEffect, useId, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { devopsSearch, type DeliveryAnchor } from "@srelens/core";
import { TextInput } from "../ui";
import {
  deliveryPasteLabel,
  parseDeliveryPaste,
} from "./parseDeliveryPaste";

export type PaletteAction =
  | { kind: "delivery"; id: string; label: string }
  | { kind: "anchor"; anchor: DeliveryAnchor; label: string }
  | {
      kind: "nav";
      route: "home" | "deliveries" | "workspace" | "connections" | "settings" | "kubernetes";
      label: string;
    };

const NAV_ACTIONS: PaletteAction[] = [
  { kind: "nav", route: "home", label: "Go to My Work" },
  { kind: "nav", route: "deliveries", label: "Go to Deliveries" },
  { kind: "nav", route: "kubernetes", label: "Go to Kubernetes" },
  { kind: "nav", route: "connections", label: "Go to Connections" },
  { kind: "nav", route: "settings", label: "Go to Settings" },
];

function pasteAction(query: string): PaletteAction | null {
  const anchor = parseDeliveryPaste(query);
  if (!anchor) return null;
  const label = deliveryPasteLabel(anchor);
  return { kind: "anchor", anchor, label };
}

function anchorKey(anchor: DeliveryAnchor): string {
  return `${anchor.kind}:${anchor.value}`;
}

function actionKey(action: PaletteAction): string {
  if (action.kind === "delivery") return `delivery:${action.id}:${action.label}`;
  if (action.kind === "anchor") return `anchor:${anchorKey(action.anchor)}`;
  return `nav:${action.route}`;
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
  const listId = useId();
  const optionId = (index: number) => `${listId}-opt-${index}`;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchActions, setSearchActions] = useState<PaletteAction[]>([]);
  const actions = useMemo(() => NAV_ACTIONS, []);
  const paste = useMemo(() => pasteAction(query), [query]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const base = !needle
      ? actions
      : actions.filter((action) => action.label.toLowerCase().includes(needle));
    const rest =
      paste?.kind === "delivery"
        ? base.filter((a) => !(a.kind === "delivery" && a.id === paste.id && a.label !== paste.label))
        : base;
    const pasteKeys = new Set(
      paste?.kind === "anchor"
        ? [anchorKey(paste.anchor)]
        : paste?.kind === "delivery"
          ? []
          : [],
    );
    const fromSearch = searchActions.filter((action) => {
      if (action.kind !== "anchor") return true;
      return !pasteKeys.has(anchorKey(action.anchor));
    });
    if (paste) return [paste, ...fromSearch, ...rest];
    return [...fromSearch, ...rest];
  }, [actions, paste, query, searchActions]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, filtered.length]);

  // After paste miss: capability search (no provider fetch from React).
  useEffect(() => {
    if (!open) {
      setSearchActions([]);
      return;
    }
    const needle = query.trim();
    if (!needle || pasteAction(query)) {
      setSearchActions([]);
      return;
    }
    let cancelled = false;
    devopsSearch(needle)
      .then((result) => {
        if (cancelled) return;
        setSearchActions(
          result.anchors.map((anchor) => ({
            kind: "anchor" as const,
            anchor,
            label: deliveryPasteLabel(anchor),
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setSearchActions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, query]);

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

  function choose(action: PaletteAction) {
    onAction(action);
    onClose();
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
      return;
    }
    if (event.key === "Enter") {
      const action = filtered[activeIndex];
      if (!action) return;
      event.preventDefault();
      choose(action);
    }
  }

  if (!open) return null;

  const safeIndex = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1);

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
            role="combobox"
            aria-label="Search deliveries and navigation"
            aria-controls={listId}
            aria-expanded={true}
            aria-autocomplete="list"
            aria-activedescendant={safeIndex >= 0 ? optionId(safeIndex) : undefined}
            placeholder="Search deliveries, paste issue / SHA / !MR / #build…"
            value={query}
            onValueChange={setQuery}
            onEscape={onClose}
            onKeyDown={onInputKeyDown}
            autoFocus
          />
        </div>
        <ul
          id={listId}
          role="listbox"
          aria-label="Palette results"
          className="max-h-80 overflow-auto py-1"
        >
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground" role="presentation">
              No matches.
            </li>
          )}
          {filtered.map((action, index) => {
            const selected = index === safeIndex;
            return (
              <li key={actionKey(action)} role="presentation">
                <button
                  type="button"
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  className={`w-full px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    selected ? "bg-muted/60" : "hover:bg-muted/60"
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(action)}
                >
                  {action.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
