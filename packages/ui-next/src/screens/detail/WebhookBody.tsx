import { asArray, asRecord, str, type K8sObject } from "@srelens/core";
import { EmptyState } from "@srelens/ui-kit";
import { Section } from "./Section";
import { StringList } from "./sections";

/**
 * Mutating / ValidatingWebhookConfiguration webhook names — classic's
 * `WebhookBody`. Names only; no clientConfig / rule drill.
 */
export function WebhookDetailsBody({ object }: { object: K8sObject }) {
  const webhooks = asArray(object.webhooks)
    .map((w) => str(asRecord(w).name))
    .filter(Boolean);

  return (
    <Section title={`Webhooks (${webhooks.length})`}>
      {webhooks.length > 0 ? <StringList items={webhooks} /> : <EmptyState title="None" />}
    </Section>
  );
}
