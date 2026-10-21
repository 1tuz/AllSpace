import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShortcutSheet } from "./ShortcutSheet";
import { WINDOW_SHORTCUT_ROWS } from "../lib/shortcuts";

describe("ShortcutSheet", () => {
  it("lists every window shortcut row", () => {
    render(<ShortcutSheet onClose={() => {}} apple />);
    const rows = screen.getAllByTestId("cheat-shortcut-row");
    expect(rows).toHaveLength(WINDOW_SHORTCUT_ROWS.length);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeDefined();
    expect(screen.getByText("Open the console")).toBeDefined();
    expect(screen.getByText("⌘K")).toBeDefined();
  });
});
