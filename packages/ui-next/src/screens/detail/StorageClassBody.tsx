import { str, type K8sObject } from "@srelens/core";
import { KV } from "@srelens/ui-kit";
import { Section } from "./Section";

/**
 * A StorageClass's provisioner and binding facts — classic's `StorageClassBody`.
 */
export function StorageClassDetailsBody({ object }: { object: K8sObject }) {
  return (
    <Section title="Storage Class">
      <KV k="Provisioner" v={str(object.provisioner)} mono />
      <KV k="Reclaim policy" v={str(object.reclaimPolicy)} />
      <KV k="Volume binding mode" v={str(object.volumeBindingMode)} />
      <KV k="Allow expansion" v={object.allowVolumeExpansion === true ? "Yes" : "No"} />
    </Section>
  );
}
