import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextualTopBar } from "./ContextualTopBar";

afterEach(() => {
  cleanup();
});

describe("ContextualTopBar", () => {
  it("shows the active contour/profile label", () => {
    render(<ContextualTopBar profileLabel="Komus" />);

    expect(screen.getByTestId("top-bar-profile").textContent).toBe("Komus");
    expect(screen.queryByTestId("top-bar-delivery")).toBeNull();
    expect(screen.queryByTestId("top-bar-back")).toBeNull();
  });

  it("shows selected Delivery work id/title and back when present", () => {
    const onBack = vi.fn();
    render(
      <ContextualTopBar
        profileLabel="AppFarm"
        delivery={{ workId: "OPS-142", title: "Fix auth timeout" }}
        onBack={onBack}
      />,
    );

    expect(screen.getByTestId("top-bar-delivery").textContent).toMatch(/OPS-142/);
    expect(screen.getByTestId("top-bar-delivery").textContent).toMatch(/Fix auth timeout/);
    fireEvent.click(screen.getByTestId("top-bar-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("never surfaces a Kubernetes cluster as identity chrome", () => {
    render(<ContextualTopBar profileLabel="AppFarm" />);

    const bar = screen.getByTestId("contextual-top-bar");
    expect(bar.textContent).not.toMatch(/cluster/i);
    expect(bar.textContent).not.toMatch(/context/i);
    expect(bar.classList.contains("border-b")).toBe(true);
    expect(bar.classList.contains("rounded")).toBe(false);
  });
});
