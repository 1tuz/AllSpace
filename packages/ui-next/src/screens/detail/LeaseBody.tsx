import { ageFromTimestamp, asRecord, str, type K8sObject } from "@srelens/core";
import { KV } from "@srelens/ui-kit";
import { Section } from "./Section";

/**
 * A Lease's holder / duration / renew age — classic's `LeaseBody`.
 */
export function LeaseDetailsBody({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const renew = str(spec.renewTime);

  return (
    <Section title="Lease">
      <KV k="Holder" v={str(spec.holderIdentity)} mono />
      <KV
        k="Duration"
        v={spec.leaseDurationSeconds != null ? `${str(spec.leaseDurationSeconds)}s` : ""}
      />
      <KV k="Renewed" v={renew ? `${ageFromTimestamp(renew)} ago` : ""} />
    </Section>
  );
}
