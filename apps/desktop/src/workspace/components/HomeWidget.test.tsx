import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeWidget } from "./HomeWidget";

afterEach(cleanup);

describe("HomeWidget", () => {
  it("calls onMaximizeChange with id, then null on Restore", () => {
    const onMaximizeChange = vi.fn();
    const { rerender } = render(
      <HomeWidget id="inbox" title="Inbox" maximizedId={null} onMaximizeChange={onMaximizeChange}>
        body
      </HomeWidget>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    expect(onMaximizeChange).toHaveBeenCalledWith("inbox");
    rerender(
      <HomeWidget id="inbox" title="Inbox" maximizedId="inbox" onMaximizeChange={onMaximizeChange}>
        body
      </HomeWidget>,
    );
    expect(screen.getByTestId("home-widget-inbox").getAttribute("data-maximized")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onMaximizeChange).toHaveBeenCalledWith(null);
  });
});
