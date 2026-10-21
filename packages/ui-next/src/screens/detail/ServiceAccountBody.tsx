import { asArray, asRecord, str, type K8sObject } from "@srelens/core";
import { KV } from "@srelens/ui-kit";
import { Section } from "./Section";
import { StringList } from "./sections";

/**
 * A ServiceAccount's facts — classic's `ServiceAccountBody`, minus the live
 * "Used by" reverse lookups (`bindingsForServiceAccount` / `podsForServiceAccount`).
 * Secrets and image-pull secrets are inert `Secret/name` lists.
 */
export function ServiceAccountDetailsBody({ object }: { object: K8sObject }) {
  const secrets = asArray(object.secrets)
    .map((s) => str(asRecord(s).name))
    .filter(Boolean);
  const pull = asArray(object.imagePullSecrets)
    .map((s) => str(asRecord(s).name))
    .filter(Boolean);

  return (
    <Section title="Service Account">
      <KV
        k="Secrets"
        v={secrets.length > 0 ? <StringList items={secrets.map((n) => `Secret/${n}`)} /> : ""}
      />
      <KV
        k="Image pull secrets"
        v={pull.length > 0 ? <StringList items={pull.map((n) => `Secret/${n}`)} /> : ""}
      />
      <KV k="Automount token" v={object.automountServiceAccountToken === false ? "No" : "Yes"} />
    </Section>
  );
}
