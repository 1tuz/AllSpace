import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount React trees between tests so repeated render() calls don't stack —
// without this a query for a button finds every previous test's copy too.
afterEach(() => cleanup());

// The design preference lives in localStorage, so one test's writes must not
// leak into the next.
afterEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
});

// xterm feature-detects a 2D canvas as its module loads. The UI-next unit
// suite does not exercise terminal drawing, and jsdom otherwise reports this
// missing browser API once per import.
if (typeof window !== "undefined") {
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({}),
  });
}
