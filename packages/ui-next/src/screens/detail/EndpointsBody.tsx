import { asArray, asRecord, str, type K8sObject } from "@srelens/core";
import { KV } from "@srelens/ui-kit";
import { Section } from "./Section";
import { StringList } from "./sections";

function portText(p: Record<string, unknown>): string {
  const name = str(p.name);
  return `${name ? `${name}: ` : ""}${str(p.port)}/${str(p.protocol) || "TCP"}`;
}

function targetText(kind: string, name: string, namespace: string | null): string {
  if (!name) return "";
  return namespace ? `${kind}/${namespace}/${name}` : `${kind}/${name}`;
}

/**
 * An Endpoints object's subsets — classic's `EndpointsBody`. Addresses, ports,
 * and targetRefs as inert `Kind/ns/name` text (no ResourceLink).
 */
export function EndpointsDetailsBody({ object }: { object: K8sObject }) {
  const addrs: string[] = [];
  const ports: string[] = [];
  const targets: string[] = [];
  const namespace = str(asRecord(object.metadata).namespace) || null;

  asArray(object.subsets).forEach((s) => {
    const ss = asRecord(s);
    [...asArray(ss.addresses), ...asArray(ss.notReadyAddresses)].forEach((a) => {
      const address = asRecord(a);
      const ip = str(address.ip);
      if (ip) addrs.push(ip);
      const target = asRecord(address.targetRef);
      if (target.name) {
        const kind = str(target.kind);
        const ns = str(target.namespace) || namespace;
        const text = targetText(kind, str(target.name), ns);
        if (text) targets.push(text);
      }
    });
    asArray(ss.ports).forEach((p) => ports.push(portText(asRecord(p))));
  });

  return (
    <Section title="Endpoints">
      <KV k="Addresses" v={addrs.length > 0 ? <StringList items={addrs} /> : "None"} />
      <KV k="Ports" v={ports.length > 0 ? <StringList items={ports} /> : ""} />
      <KV k="Targets" v={targets.length > 0 ? <StringList items={targets} /> : ""} />
    </Section>
  );
}

/**
 * An EndpointSlice's addresses and ports — classic's `EndpointSliceBody`.
 * Targets are inert `Kind/ns/name` text.
 */
export function EndpointSliceDetailsBody({ object }: { object: K8sObject }) {
  const addrs = asArray(object.endpoints).flatMap((e) => asArray(asRecord(e).addresses).map(str).filter(Boolean));
  const ports = asArray(object.ports).map((p) => portText(asRecord(p)));
  const namespace = str(asRecord(object.metadata).namespace) || null;
  const targets = asArray(object.endpoints).flatMap((endpoint): string[] => {
    const target = asRecord(asRecord(endpoint).targetRef);
    if (!target.name) return [];
    const kind = str(target.kind);
    const ns = str(target.namespace) || namespace;
    const text = targetText(kind, str(target.name), ns);
    return text ? [text] : [];
  });

  return (
    <Section title="Endpoint Slice">
      <KV k="Address type" v={str(object.addressType)} />
      <KV k="Addresses" v={addrs.length > 0 ? <StringList items={addrs} /> : "None"} />
      <KV k="Ports" v={ports.length > 0 ? <StringList items={ports} /> : ""} />
      <KV k="Targets" v={targets.length > 0 ? <StringList items={targets} /> : ""} />
    </Section>
  );
}
