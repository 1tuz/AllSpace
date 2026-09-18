import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppearanceSection } from "./AppearanceSection";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-glass");
  document.documentElement.classList.remove("dark");
});

beforeEach(() => {
  localStorage.clear();
});

describe("AppearanceSection", () => {
  it("renders mode, geek palettes, and liquid glass", () => {
    render(<AppearanceSection />);
    expect(screen.getByTestId("appearance-section")).toBeDefined();
    expect(screen.getByRole("button", { name: "System" })).toBeDefined();
    expect(screen.getByTestId("theme-palette-dracula")).toBeDefined();
    expect(screen.getByTestId("theme-palette-catppuccin")).toBeDefined();
    expect(screen.getByTestId("liquid-glass-toggle")).toBeDefined();
  });

  it("applies Dracula and liquid glass to the document", () => {
    render(<AppearanceSection />);
    fireEvent.click(screen.getByTestId("theme-palette-dracula"));
    expect(document.documentElement.dataset.theme).toBe("dracula");
    fireEvent.click(screen.getByTestId("liquid-glass-toggle"));
    expect(document.documentElement.dataset.glass).toBe("liquid");
  });

  it("keeps liquid glass after a second palette click (applyTheme must not drop it)", () => {
    render(<AppearanceSection />);
    fireEvent.click(screen.getByTestId("liquid-glass-toggle"));
    expect(document.documentElement.dataset.glass).toBe("liquid");
    fireEvent.click(screen.getByTestId("theme-palette-nord"));
    expect(document.documentElement.dataset.theme).toBe("nord");
    expect(document.documentElement.dataset.glass).toBe("liquid");
  });
});
