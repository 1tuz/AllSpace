import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HomeMosaic } from "./HomeMosaic";

afterEach(cleanup);

describe("HomeMosaic", () => {
  it("hides non-maximized widgets when maximizedId is set", () => {
    render(
      <HomeMosaic
        maximizedId="trace"
        onMaximizeChange={() => {}}
        summary={<span>S</span>}
        inbox={<span>I</span>}
        trace={<span>T</span>}
      />,
    );
    expect(screen.getByTestId("home-mosaic").getAttribute("data-home-mosaic-mode")).toBe(
      "maximized",
    );
    expect(screen.getByTestId("home-mosaic").getAttribute("data-maximized-region")).toBe("trace");
    expect(screen.getByTestId("home-widget-trace").getAttribute("data-maximized")).toBe("true");
    expect(screen.getByTestId("home-widget-inbox").getAttribute("data-maximized")).toBe("false");
    expect(screen.getByTestId("home-widget-summary").hidden).toBe(true);
    expect(screen.getByTestId("home-widget-inbox").hidden).toBe(true);
    expect(screen.getByTestId("home-widget-trace").hidden).toBe(false);
  });

  it("shows all widgets in grid mode", () => {
    render(
      <HomeMosaic
        maximizedId={null}
        onMaximizeChange={() => {}}
        summary={<span>S</span>}
        inbox={<span>I</span>}
        trace={<span>T</span>}
      />,
    );
    expect(screen.getByTestId("home-mosaic").getAttribute("data-home-mosaic-mode")).toBe("grid");
    expect(screen.getByTestId("home-widget-summary").hidden).toBe(false);
    expect(screen.getByTestId("home-widget-inbox").hidden).toBe(false);
    expect(screen.getByTestId("home-widget-trace").hidden).toBe(false);
    expect(screen.getByText("Summary")).toBeDefined();
    expect(screen.getByText("Inbox")).toBeDefined();
    expect(screen.getByText("Trace")).toBeDefined();
  });
});
