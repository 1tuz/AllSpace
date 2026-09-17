import { expect, it } from "vitest";

it("provides a harmless canvas context for xterm imports in jsdom", () => {
  expect(document.createElement("canvas").getContext("2d")).not.toBeNull();
});
