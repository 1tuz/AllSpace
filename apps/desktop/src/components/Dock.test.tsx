import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("./PodTerminal", () => ({
  PodTerminal: ({ pod, active }: { pod: string; active?: boolean }) => (
    <div data-testid="terminal" data-active={active === false ? "false" : "true"}>
      {pod}
    </div>
  ),
}));
vi.mock("./LocalTerminal", () => ({
  LocalTerminal: ({ context, active }: { context: string; active?: boolean }) => (
    <div data-testid="shell" data-active={active === false ? "false" : "true"}>
      {context}
    </div>
  ),
}));
vi.mock("./LogsView", () => ({
  LogsView: ({
    source,
    active,
  }: {
    source: { pod?: string; name?: string };
    active?: boolean;
  }) => (
    <div data-testid="logs" data-active={active === false ? "false" : "true"}>
      {source.pod ?? source.name}
    </div>
  ),
}));

import { Dock, type DockSession } from "./Dock";

const sessions: DockSession[] = [
  { id: 1, kind: "terminal", context: "c", namespace: "default", pod: "web-1" },
  { id: 2, kind: "logs", context: "c", namespace: "default", pod: "web-2" },
];

function renderDock(overrides: Partial<React.ComponentProps<typeof Dock>> = {}) {
  const props = {
    sessions,
    activeId: 1,
    height: 300,
    onActivate: vi.fn(),
    onCloseTab: vi.fn(),
    onClose: vi.fn(),
    onResize: vi.fn(),
    ...overrides,
  };
  render(<Dock {...props} />);
  return props;
}

beforeEach(() => vi.clearAllMocks());

describe("Dock", () => {
  it("renders a tab per session and the active terminal", () => {
    renderDock();
    expect(screen.getByRole("tab", { name: /web-1/ })).toBeDefined();
    expect(screen.getByRole("tab", { name: /web-2/ })).toBeDefined();
    // active terminal (id 1) is web-1
    expect(screen.getByTestId("terminal").textContent).toBe("web-1");
  });

  it("distinguishes two shells into different containers of one pod", () => {
    // Both tabs would otherwise read "web-1" and the user couldn't tell the
    // sidecar's shell from the app's (#262).
    renderDock({
      sessions: [
        { id: 1, kind: "terminal", context: "c", namespace: "default", pod: "web-1", container: "app" },
        { id: 2, kind: "terminal", context: "c", namespace: "default", pod: "web-1", container: "istio-proxy" },
      ],
    });
    expect(screen.getByRole("tab", { name: /web-1 · app/ })).toBeDefined();
    expect(screen.getByRole("tab", { name: /web-1 · istio-proxy/ })).toBeDefined();
  });

  it("keeps every session mounted and shows only the active one", () => {
    renderDock({ activeId: 2 });
    // Both panes are mounted (so terminals/streams survive tab switches)…
    expect(screen.getByTestId("logs").textContent).toBe("web-2");
    expect(screen.getByTestId("terminal").textContent).toBe("web-1");
    // …but only the active session's pane is displayed.
    expect((screen.getByTestId("logs").parentElement as HTMLElement).style.display).toBe("block");
    expect((screen.getByTestId("terminal").parentElement as HTMLElement).style.display).toBe("none");
  });

  it("passes active=false to inactive terminal and logs panes", () => {
    renderDock({ activeId: 2 });
    expect(screen.getByTestId("terminal").getAttribute("data-active")).toBe("false");
    expect(screen.getByTestId("logs").getAttribute("data-active")).toBe("true");
  });

  it("passes active=false to an inactive local shell pane", () => {
    renderDock({
      sessions: [
        { id: 1, kind: "shell", context: "kind-dev", namespace: "" },
        { id: 2, kind: "logs", context: "c", namespace: "default", pod: "web-2" },
      ],
      activeId: 2,
    });
    expect(screen.getByTestId("shell").getAttribute("data-active")).toBe("false");
    expect(screen.getByTestId("logs").getAttribute("data-active")).toBe("true");
  });

  it("activates a tab on click", () => {
    const props = renderDock();
    fireEvent.click(screen.getByRole("tab", { name: /web-2/ }));
    expect(props.onActivate).toHaveBeenCalledWith(2);
  });

  it("closes a single tab and the whole dock", () => {
    const props = renderDock();
    fireEvent.click(screen.getByLabelText("Close web-1 terminal"));
    expect(props.onCloseTab).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByLabelText("Close dock"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("shows a New terminal button only when a handler is given", () => {
    const { rerender } = render(
      <Dock
        sessions={sessions}
        activeId={1}
        height={300}
        onActivate={vi.fn()}
        onCloseTab={vi.fn()}
        onClose={vi.fn()}
        onResize={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("New terminal")).toBeNull();

    const onNewTerminal = vi.fn();
    rerender(
      <Dock
        sessions={sessions}
        activeId={1}
        height={300}
        onActivate={vi.fn()}
        onCloseTab={vi.fn()}
        onClose={vi.fn()}
        onResize={vi.fn()}
        onNewTerminal={onNewTerminal}
      />,
    );
    fireEvent.click(screen.getByLabelText("New terminal"));
    expect(onNewTerminal).toHaveBeenCalledTimes(1);
  });
});
