import { str, type K8sObject } from "@srelens/core";
import { KV } from "@srelens/ui-kit";
import { Section } from "./Section";

/**
 * A RuntimeClass's handler — classic's `RuntimeClassBody`.
 */
export function RuntimeClassDetailsBody({ object }: { object: K8sObject }) {
  return (
    <Section title="Runtime Class">
      <KV k="Handler" v={str(object.handler)} mono />
    </Section>
  );
}
