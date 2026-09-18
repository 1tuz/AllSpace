import React from "react";
import { Input } from "@/components/ui/input";

export interface TextInputProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Called when the user presses Enter. */
  onEnter?: () => void;
  /** Called when the user presses Escape. */
  onEscape?: () => void;
  /** Extra key handling (runs before onEnter / onEscape). */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  type?: "text" | "search" | "number" | "password";
  autoFocus?: boolean;
  role?: string;
  "aria-label"?: string;
  "aria-controls"?: string;
  "aria-activedescendant"?: string;
  "aria-autocomplete"?: "none" | "inline" | "list" | "both";
  "aria-expanded"?: boolean;
}

/**
 * Themed single-line text input with a value-first onChange contract. Local
 * wrapper over shadcn's Input — the value-first API and onEnter are preserved
 * so callers don't depend on the underlying library.
 */
export function TextInput({
  value,
  onValueChange,
  onEnter,
  onEscape,
  onKeyDown,
  placeholder,
  disabled,
  className,
  type = "text",
  autoFocus,
  role,
  "aria-label": ariaLabel,
  "aria-controls": ariaControls,
  "aria-activedescendant": ariaActiveDescendant,
  "aria-autocomplete": ariaAutocomplete,
  "aria-expanded": ariaExpanded,
}: TextInputProps) {
  return (
    <Input
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Enter" && onEnter) onEnter();
        if (e.key === "Escape" && onEscape) onEscape();
      }}
      placeholder={placeholder}
      disabled={disabled}
      type={type}
      autoFocus={autoFocus}
      className={className}
      role={role}
      aria-label={ariaLabel}
      aria-controls={ariaControls}
      aria-activedescendant={ariaActiveDescendant}
      aria-autocomplete={ariaAutocomplete}
      aria-expanded={ariaExpanded}
    />
  );
}
