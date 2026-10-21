import { useState } from "react";
import { CONTOUR_PRESETS, type ContourId } from "../contours";
import { Button } from "../../ui";

export type FirstRunContourChoice = ContourId | "custom";

export function FirstRunScreen({
  onContinue,
}: {
  onContinue: (contour: FirstRunContourChoice) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<FirstRunContourChoice>("appfarm");
  const [busy, setBusy] = useState(false);

  async function handleContinue() {
    if (busy) return;
    setBusy(true);
    try {
      await onContinue(selected);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col overflow-auto px-8 py-10" data-testid="first-run">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">First run</p>
      <h1 className="mt-2 text-2xl font-semibold">Set up your engineering workspace</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Choose a contour to save public endpoints. Configure only the providers you use in Connections;
        credentials stay encrypted on this device, never in the profile. Cluster selection happens inside
        Kubernetes.
      </p>
      <div className="mt-8 grid max-w-3xl gap-3" role="radiogroup" aria-label="Contour">
        {CONTOUR_PRESETS.map((contour) => (
          <ContourCard
            key={contour.id}
            title={contour.label}
            detail={contour.summary}
            selected={selected === contour.id}
            onSelect={() => setSelected(contour.id)}
            testId={`first-run-contour-${contour.id}`}
          />
        ))}
        <ContourCard
          title="Custom"
          detail="Skip presets — configure endpoints later in Connections / Settings"
          selected={selected === "custom"}
          onSelect={() => setSelected("custom")}
          testId="first-run-contour-custom"
        />
      </div>
      <div className="mt-8 flex gap-2">
        <Button onClick={() => void handleContinue()} disabled={busy} data-testid="first-run-continue">
          Continue to Connections
        </Button>
      </div>
    </main>
  );
}

function ContourCard({
  title,
  detail,
  selected,
  onSelect,
  testId,
}: {
  title: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={testId}
      onClick={onSelect}
      className={`border px-4 py-3 text-left ${
        selected ? "border-foreground bg-muted/40" : "border-border"
      }`}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </button>
  );
}
