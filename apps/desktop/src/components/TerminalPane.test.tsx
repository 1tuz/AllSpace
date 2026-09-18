import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import React from "react";
import type { TerminalConnection, TerminalDriver } from "@srelens/core";

const writeSpy = vi.fn();

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    write = writeSpy;
    open = vi.fn();
    focus = vi.fn();
    clear = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    onData = vi.fn();
    onResize = vi.fn();
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext = vi.fn();
    findPrevious = vi.fn();
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { TerminalPane } from "./TerminalPane";

function fakeDriver(connectImpl?: TerminalDriver["connect"]): {
  driver: TerminalDriver;
  close: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn();
  const connect = vi.fn(
    connectImpl ??
      (async () =>
        ({
          send: vi.fn(),
          resize: vi.fn(),
          close,
        }) satisfies TerminalConnection),
  );
  return {
    close,
    connect,
    driver: {
      kind: "pod",
      reconnectable: true,
      connect,
    },
  };
}

beforeEach(() => {
  writeSpy.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TerminalPane stop-on-hide", () => {
  it("starts a session when active and closes it when the Dock pane becomes inactive", async () => {
    const { driver, close, connect } = fakeDriver();
    const { rerender } = render(<TerminalPane driver={driver} active />);

    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("live")).toBeDefined());

    rerender(<TerminalPane driver={driver} active={false} />);

    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls.some((c) => String(c[0]).includes("paused (tab hidden)"))).toBe(true);
    expect(await screen.findByText(/paused \(tab hidden\)/)).toBeDefined();
  });

  it("opens a new shell when shown again and labels it honestly", async () => {
    const { driver, close, connect } = fakeDriver();
    const { rerender } = render(<TerminalPane driver={driver} active />);
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));

    rerender(<TerminalPane driver={driver} active={false} />);
    await waitFor(() => expect(close).toHaveBeenCalled());

    rerender(<TerminalPane driver={driver} active />);
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("live")).toBeDefined());
    expect(writeSpy.mock.calls.some((c) => String(c[0]).includes("reconnected (new shell)"))).toBe(
      true,
    );
  });

  it("does not start a session while inactive", async () => {
    const { driver, connect } = fakeDriver();
    render(<TerminalPane driver={driver} active={false} />);
    // Give the async xterm import a turn; connect must stay idle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(connect).not.toHaveBeenCalled();
    expect(await screen.findByText(/paused \(tab hidden\)/)).toBeDefined();
  });
});
