import { asRecord, str, type K8sObject } from "@srelens/core";
import { KV } from "@srelens/ui-kit";
import { Section } from "./Section";

/**
 * An IngressClass's controller — classic's `IngressClassBody`.
 */
export function IngressClassDetailsBody({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  return (
    <Section title="Ingress Class">
      <KV k="Controller" v={str(spec.controller)} mono />
    </Section>
  );
}
