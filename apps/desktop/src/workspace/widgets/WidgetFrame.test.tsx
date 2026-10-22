import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WidgetFrame } from "./WidgetFrame";
import type { WidgetId } from "./types";

function Harness({
  onExpand = () => {},
  id = "jira" as WidgetId,
  title = "Jira",
}: {
  onExpand?: (id: WidgetId | null) => void;
  id?: WidgetId;
  title?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  return (
    <WidgetFrame
      id={id}
      title={title}
      expanded={expanded}
      pinned={pinned}
      onPinnedChange={setPinned}
      onExpandChange={(next) => {
        setExpanded(next === id);
        onExpand(next);
      }}
      hoverIntentMs={0}
      hoverGraceMs={0}
      summary={<p>compact row</p>}
    >
      <div data-testid="detail">detail body</div>
    </WidgetFrame>
  );
}

const frame = () => screen.getByTestId("widget-jira");
const state = () => frame().getAttribute("data-widget-state");

describe("WidgetFrame", () => {
  it("opens on pointer intent and closes after the pointer leaves", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(state()).toBe("compact");
    expect(screen.queryByTestId("detail")).toBeNull();

    await user.hover(frame());
    await waitFor(() => expect(state()).toBe("hover"));
    expect(screen.getByTestId("detail")).not.toBeNull();

    await user.unhover(frame());
    await waitFor(() => expect(state()).toBe("compact"));
    // Collapsing must not throw the body away: scroll and in-flight reads live there.
    expect(screen.getByTestId("detail")).not.toBeNull();
  });

  it("stays open when pinned, and Escape unpins it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Pin Jira" }));
    expect(state()).toBe("pinned");
    expect(screen.getByRole("button", { name: "Unpin Jira" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    await user.keyboard("{Escape}");
    expect(state()).toBe("compact");
    expect(screen.getByRole("button", { name: "Pin Jira" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("pins when the compact card is clicked, without opening on hover first", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("compact row"));
    expect(state()).toBe("pinned");
  });

  it("hands expansion to the board and can restore", async () => {
    const onExpand = vi.fn();
    const user = userEvent.setup();
    render(<Harness onExpand={onExpand} />);
    await user.click(screen.getByRole("button", { name: "Expand Jira" }));
    expect(onExpand).toHaveBeenLastCalledWith("jira");
    expect(state()).toBe("expanded");
    await user.click(screen.getByRole("button", { name: "Restore Jira" }));
    expect(onExpand).toHaveBeenLastCalledWith(null);
  });

  it("announces the open state from its header", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const title = screen.getByRole("button", { name: "Jira" });
    expect(title.getAttribute("aria-expanded")).toBe("false");
    await user.click(title);
    expect(title.getAttribute("aria-expanded")).toBe("true");
  });
});
