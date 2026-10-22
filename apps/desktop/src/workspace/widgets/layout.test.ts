import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOARD_LAYOUT,
  boardLayoutKey,
  loadBoardLayout,
  moveWidget,
  normalizeBoardLayout,
  saveBoardLayout,
  toggleWidgetSpan,
} from "./layout";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    raw: map,
  };
}

describe("board layout", () => {
  it("ships a default layout that needs no configuration", () => {
    const storage = memoryStorage();
    expect(loadBoardLayout("appfarm", storage)).toEqual(DEFAULT_BOARD_LAYOUT);
    expect(loadBoardLayout("appfarm", storage).some((slot) => slot.id === "trace")).toBe(true);
  });

  it("round-trips per profile", () => {
    const storage = memoryStorage();
    const layout = moveWidget(DEFAULT_BOARD_LAYOUT, "ci", -1);
    saveBoardLayout("komus", layout, storage);
    expect(loadBoardLayout("komus", storage)).toEqual(layout);
    expect(loadBoardLayout("appfarm", storage)).toEqual(DEFAULT_BOARD_LAYOUT);
    expect(storage.getItem(boardLayoutKey("komus"))).toContain('"ci"');
  });

  it("drops unknown widgets and re-adds widgets introduced after the layout was saved", () => {
    const normalized = normalizeBoardLayout([
      { id: "trace", span: 2 },
      { id: "retired-provider", span: 1 },
      { id: "trace", span: 1 },
      { id: "jira", span: 7 },
    ]);
    expect(normalized.map((slot) => slot.id)).toEqual([
      "trace",
      "jira",
      "summary",
      "git",
      "ci",
      "kubernetes",
    ]);
    expect(normalized[1].span).toBe(1);
    expect(normalized[0].span).toBe(2);
  });

  it("survives a corrupt saved value", () => {
    const storage = memoryStorage();
    storage.setItem(boardLayoutKey("x"), "{not json");
    expect(loadBoardLayout("x", storage)).toEqual(DEFAULT_BOARD_LAYOUT);
  });

  it("moves only within bounds and toggles a span", () => {
    expect(moveWidget(DEFAULT_BOARD_LAYOUT, "summary", -1)).toEqual(DEFAULT_BOARD_LAYOUT);
    const moved = moveWidget(DEFAULT_BOARD_LAYOUT, "summary", 1);
    expect(moved[0].id).toBe("jira");
    expect(moved[1].id).toBe("summary");
    expect(toggleWidgetSpan(DEFAULT_BOARD_LAYOUT, "jira")[1].span).toBe(2);
  });
});
