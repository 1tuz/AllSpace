import { str, type K8sObject } from "@srelens/core";
import { KV } from "@srelens/ui-kit";
import { Section } from "./Section";

/**
 * A PriorityClass's value / default / preemption — classic's `PriorityClassBody`.
 */
export function PriorityClassDetailsBody({ object }: { object: K8sObject }) {
  return (
    <Section title="Priority Class">
      <KV k="Value" v={str(object.value)} />
      <KV k="Global default" v={object.globalDefault === true ? "Yes" : "No"} />
      <KV k="Preemption policy" v={str(object.preemptionPolicy)} />
    </Section>
  );
}
