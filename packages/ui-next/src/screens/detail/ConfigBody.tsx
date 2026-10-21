import { asRecord, plural, str, type K8sObject } from "@srelens/core";
import { Section } from "./Section";
import { ConfigDataEditor } from "./ConfigDataEditor";

/**
 * A ConfigMap's Details pane: its `data` keys and values, with classic's
 * inline edit/save (`ConfigDataEditor`). `binaryData` is not read here —
 * classic's own `ConfigBody` never read it.
 */
export function ConfigDetailsBody({ object, context }: { object: K8sObject; context: string }) {
  const meta = object.metadata ?? {};
  const data = asRecord(object.data) as Record<string, string>;
  const keys = Object.keys(data);
  return (
    // Remembered as `Data`, not as `Data (3 keys)`: the heading counts what
    // is in the object, and a memory keyed on it would be lost the first
    // time someone added a key.
    //
    // Open on a first visit, because it is the only titled block a ConfigMap's
    // pane has: everything else on it is the unheaded lead fact list, so a
    // shut Data block is a pane that says a ConfigMap exists and nothing about
    // what is in it. It still folds, and a reader who folds it gets that back.
    <Section id="Data" title={`Data (${plural(keys.length, "key")})`} defaultOpen>
      <ConfigDataEditor
        context={context}
        kind="ConfigMap"
        namespace={str(meta.namespace)}
        name={str(meta.name)}
        data={data}
        secret={false}
      />
    </Section>
  );
}
