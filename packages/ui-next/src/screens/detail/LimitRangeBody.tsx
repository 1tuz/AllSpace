import { asArray, asRecord, str, type K8sObject } from "@srelens/core";
import { EmptyState, KV } from "@srelens/ui-kit";
import { Section } from "./Section";

/**
 * A LimitRange's limit types and constraint keys — classic's `LimitRangeBody`.
 * Says which constraint maps are present (default / min / max), not live usage.
 */
export function LimitRangeDetailsBody({ object }: { object: K8sObject }) {
  const limits = asArray(asRecord(object.spec).limits);

  return (
    <Section title={`Limits (${limits.length})`}>
      {limits.length > 0 ? (
        limits.map((l, i) => {
          const ll = asRecord(l);
          const constraints = Object.keys({
            ...asRecord(ll.default),
            ...asRecord(ll.max),
            ...asRecord(ll.min),
          });
          return (
            <KV
              key={String(i)}
              k={str(ll.type) || `Limit ${i + 1}`}
              v={constraints.join(", ") || "—"}
            />
          );
        })
      ) : (
        <EmptyState title="None" />
      )}
    </Section>
  );
}
