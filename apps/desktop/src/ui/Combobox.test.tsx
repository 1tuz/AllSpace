import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { Combobox } from "./Combobox";

const options = [
  { value: "", label: "All namespaces" },
  { value: "default" },
  { value: "kube-system" },
  { value: "monitoring" },
];

beforeEach(() => vi.clearAllMocks());

describe("Combobox", () => {
  it("filters options by the search box and selects one", async () => {
    const onValueChange = vi.fn();
    render(
      <Combobox value="" onValueChange={onValueChange} options={options} ariaLabel="Namespace" searchPlaceholder="Search namespaces…" />,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Namespace" }));
    await userEvent.type(screen.getByPlaceholderText("Search namespaces…"), "kube");

    // Only the matching option remains.
    expect(screen.getByRole("option", { name: "kube-system" })).toBeDefined();
    expect(screen.queryByRole("option", { name: "default" })).toBeNull();

    await userEvent.click(screen.getByRole("option", { name: "kube-system" }));
    expect(onValueChange).toHaveBeenCalledWith("kube-system");
  });

  it("shows the selected option's label on the trigger", () => {
    render(<Combobox value="" onValueChange={vi.fn()} options={options} ariaLabel="Namespace" />);
    expect(screen.getByRole("combobox", { name: "Namespace" }).textContent).toContain("All namespaces");
  });

  it("keeps the search icon inside the input group (not overflowing via w-full)", async () => {
    render(
      <Combobox
        value=""
        onValueChange={vi.fn()}
        options={options}
        ariaLabel="Namespace"
        searchPlaceholder="Search namespaces…"
      />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Namespace" }));
    const input = screen.getByPlaceholderText("Search namespaces…");
    const group = input.closest("[data-slot=input-group]");
    expect(group).toBeTruthy();
    expect(group!.querySelector("svg")).toBeTruthy();
    expect(input.className).toMatch(/flex-1/);
    expect(input.className.split(/\s+/)).not.toContain("w-full");
  });

  it("does not stack a second opaque Command shell inside the popover (crooked double frame)", async () => {
    // PopoverContent already owns bg-popover; Command's own bg-popover + radius
    // drew a second inset frame that looked misaligned over liquid glass.
    render(
      <Combobox
        value=""
        onValueChange={vi.fn()}
        options={options}
        ariaLabel="Namespace"
        searchPlaceholder="Search namespaces…"
      />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Namespace" }));
    const command = document.querySelector('[data-slot="command"]');
    expect(command).toBeTruthy();
    expect(command!.className).toMatch(/bg-transparent/);
    expect(command!.className.split(/\s+/)).not.toContain("bg-popover");
  });
});
