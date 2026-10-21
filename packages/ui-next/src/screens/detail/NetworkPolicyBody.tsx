import { asArray, asRecord, str, type K8sObject } from "@srelens/core";
import { KV, PairList } from "@srelens/ui-kit";
import { Section } from "./Section";

/**
 * A NetworkPolicy's facts — classic's `NetworkPolicyBody`. Pod selector uses
 * `PairList` (this design's stand-in for classic's `Chips`); empty selector
 * still reads "all pods". Rule counts only — no rule-body drill.
 */
export function NetworkPolicyDetailsBody({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const sel = asRecord(asRecord(spec.podSelector).matchLabels) as Record<string, string>;
  const hasSelector = Object.keys(sel).length > 0;

  return (
    <Section title="Network Policy">
      <KV
        k="Pod selector"
        v={hasSelector ? <PairList pairs={Object.entries(sel)} breakValues /> : "all pods"}
      />
      <KV k="Policy types" v={asArray(spec.policyTypes).map(str).join(", ")} />
      <KV k="Ingress rules" v={str(asArray(spec.ingress).length)} />
      <KV k="Egress rules" v={str(asArray(spec.egress).length)} />
    </Section>
  );
}
