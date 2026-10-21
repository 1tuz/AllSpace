import { asRecord, str, type K8sObject } from "@srelens/core";
import { KV } from "@srelens/ui-kit";
import { Section } from "./Section";

/**
 * A PodDisruptionBudget's facts — classic's `PdbBody`. Min/max availability
 * and the live healthy / disruptionsAllowed counts from status.
 */
export function PdbDetailsBody({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);

  return (
    <Section title="Disruption Budget">
      <KV k="Min available" v={str(spec.minAvailable)} />
      <KV k="Max unavailable" v={str(spec.maxUnavailable)} />
      <KV k="Healthy" v={`${str(status.currentHealthy)} / ${str(status.desiredHealthy)}`} />
      <KV k="Disruptions allowed" v={str(status.disruptionsAllowed)} />
    </Section>
  );
}
