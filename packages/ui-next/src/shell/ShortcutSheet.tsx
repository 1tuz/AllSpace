import { isApplePlatform } from "@srelens/core";
import { Dialog } from "@srelens/ui-kit";
import { hint, WINDOW_SHORTCUT_ROWS } from "../lib/shortcuts";

/**
 * The `?` overlay for the new design: every window chord `BINDINGS` answers,
 * same rows Settings → Keyboard draws. Classic still uses core `SHORTCUTS` +
 * `ShortcutCheatSheet`; this sheet must not invent glyphs by hand.
 */
export function ShortcutSheet({
  onClose,
  apple = isApplePlatform(),
}: {
  onClose: () => void;
  apple?: boolean;
}) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} maxWidth={420} closeLabel="Close">
      <p className="mb-3 text-[0.75rem] text-muted">
        Press <kbd className="kbd">?</kbd> any time to bring this back. Same list as Settings → Keyboard.
      </p>
      <div role="list" aria-label="Keyboard shortcuts" className="flex flex-col">
        {WINDOW_SHORTCUT_ROWS.map(({ type, label }) => (
          <div
            key={type}
            role="listitem"
            data-testid="cheat-shortcut-row"
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-rule py-1.5 last:border-b-0"
          >
            <span className="min-w-0 flex-1 basis-40 text-[0.75rem] text-ink">{label}</span>
            <kbd className="kbd shrink-0">{hint(type, apple)}</kbd>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
