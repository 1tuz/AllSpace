import { asRecord, str, type K8sObject } from "@srelens/core";
import { KV } from "@srelens/ui-kit";
import { Section } from "./Section";

/**
 * An HPA's Autoscaler facts — classic's `HpaBody`. Scale target is inert
 * `Kind/name` text rather than a `ResourceLink`; no live metrics.
 */
export function HpaDetailsBody({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);
  const target = asRecord(spec.scaleTargetRef);
  const targetKind = str(target.kind);
  const targetName = str(target.name);

  return (
    <Section title="Autoscaler">
      <KV
        k="Scale target"
        v={targetName ? `${targetKind}/${targetName}` : ""}
        mono
      />
      <KV
        k="Replicas"
        v={`${str(status.currentReplicas) || "?"} current / ${str(status.desiredReplicas) || "?"} desired`}
      />
      <KV k="Min replicas" v={str(spec.minReplicas)} />
      <KV k="Max replicas" v={str(spec.maxReplicas)} />
    </Section>
  );
}
