import { formatChord, isTypingTarget, type KeyEventLike, type KeyToken } from "@srelens/core";

export type WindowAction =
  | { type: "close-tab" }
  | { type: "new-tab" }
  | { type: "reopen-tab" }
  | { type: "prev-tab" }
  | { type: "next-tab" }
  | { type: "select-tab"; index: number }
  | { type: "console" }
  | { type: "lock" }
  | { type: "zoom-in" }
  | { type: "zoom-out" }
  | { type: "zoom-reset" };

/**
 * Rows for Settings → Keyboard and the `?` cheat sheet. Labels live here so
 * the pane and the overlay cannot disagree; chords always come from {@link hint}.
 */
export const WINDOW_SHORTCUT_ROWS: ReadonlyArray<{ type: WindowAction["type"]; label: string }> = [
  { type: "console", label: "Open the console" },
  { type: "lock", label: "Lock the workspace" },
  { type: "new-tab", label: "New tab" },
  { type: "close-tab", label: "Close tab" },
  { type: "reopen-tab", label: "Reopen the last closed tab" },
  { type: "prev-tab", label: "Previous tab" },
  { type: "next-tab", label: "Next tab" },
  { type: "select-tab", label: "Jump to a tab (1–9)" },
  { type: "zoom-in", label: "Zoom in" },
  { type: "zoom-out", label: "Zoom out" },
  { type: "zoom-reset", label: "Reset zoom" },
];

type Binding = { chord: KeyToken[]; action: WindowAction; whileTyping?: boolean };

/**
 * The window's accelerators, bound once in `Window`. Core's matcher treats
 * `Mod` as Meta-or-Control, which is right for a palette and wrong here: on a
 * Mac, Ctrl+W belongs to the terminal it was typed into, and the mock's
 * `metaKey || ctrlKey` closed the document tab instead. So the modifier is
 * strict per platform and only the hint formatting is shared with core.
 */
const BINDINGS: Binding[] = [
  { chord: ["Mod", "W"], action: { type: "close-tab" } },
  { chord: ["Mod", "T"], action: { type: "new-tab" } },
  { chord: ["Mod", "Shift", "T"], action: { type: "reopen-tab" } },
  { chord: ["Mod", "["], action: { type: "prev-tab" } },
  { chord: ["Mod", "]"], action: { type: "next-tab" } },
  ...Array.from({ length: 9 }, (_, i) => ({
    chord: ["Mod", String(i + 1)],
    action: { type: "select-tab", index: i } as WindowAction,
  })),
  { chord: ["Mod", "K"], action: { type: "console" }, whileTyping: true },
  // §23 draws this beside `Lock now` and §25 names it. `whileTyping`, unlike
  // every other chord here: a reader who reaches for the lock with the caret
  // in a filter box, a YAML editor or a terminal is asking for the vault to be
  // sealed, and a security chord that quietly stood down because something had
  // focus is the kind of surprise that gets discovered after it mattered. The
  // window's own handler is what turns this into `vault_lock` — see `Window`.
  { chord: ["Mod", "Shift", "L"], action: { type: "lock" }, whileTyping: true },
  { chord: ["Mod", "="], action: { type: "zoom-in" } },
  // `+` is Shift+= on US/UK layouts, so the keydown really carries Shift; a
  // chord without the token would be a row that can never fire.
  { chord: ["Mod", "Shift", "+"], action: { type: "zoom-in" } },
  { chord: ["Mod", "-"], action: { type: "zoom-out" } },
  { chord: ["Mod", "0"], action: { type: "zoom-reset" } },
];

function matches(chord: KeyToken[], e: KeyEventLike, apple: boolean): boolean {
  const mod = apple ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const wantsShift = chord.includes("Shift");
  const key = chord[chord.length - 1];
  if (chord.includes("Mod") !== mod) return false;
  if (e.altKey) return false;
  if (wantsShift !== e.shiftKey) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}

export function matchWindowKey(
  e: KeyEventLike & { target?: EventTarget | null },
  apple: boolean,
): WindowAction | null {
  const typing = isTypingTarget(e.target ?? null);
  for (const b of BINDINGS) {
    if (typing && !b.whileTyping) continue;
    if (matches(b.chord, e, apple)) return b.action;
  }
  return null;
}

export function hint(type: WindowAction["type"], apple: boolean): string {
  if (type === "select-tab") {
    // Nine chords share the action; show the range rather than only Mod+1.
    return `${formatChord(["Mod", "1"], apple)}–${formatChord(["Mod", "9"], apple)}`;
  }
  const b = BINDINGS.find((x) => x.action.type === type);
  return b ? formatChord(b.chord, apple) : "";
}
