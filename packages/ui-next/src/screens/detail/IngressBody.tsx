import { asArray, asRecord, str, type K8sObject } from "@srelens/core";
import { KV, Table, type Column } from "@srelens/ui-kit";
import { Section } from "./Section";
import { StringList } from "./sections";

interface IngressPathRow {
  key: string;
  host: string;
  path: string;
  backend: string;
}

const RULE_COLUMNS: Column<IngressPathRow>[] = [
  { key: "host", header: "Host", render: (r) => <span className="font-mono">{r.host}</span> },
  { key: "path", header: "Path", render: (r) => <span className="font-mono">{r.path}</span> },
  // Classic's Backend cell is a `ResourceLink` to the Service; here the same
  // "svc:port" string is inert — `PaneBody` has no navigation contract yet.
  { key: "backend", header: "Backend", render: (r) => <span className="font-mono">{r.backend}</span> },
];

/**
 * An Ingress's Details pane: class, TLS, and the host/path → backend table —
 * classic's `IngressBody`, fact-for-fact, without the clickable Service /
 * Secret links (same inert substitution every other body uses).
 */
export function IngressDetailsBody({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const rows: IngressPathRow[] = [];
  asArray(spec.rules).forEach((r, ri) => {
    const rr = asRecord(r);
    const host = str(rr.host) || "*";
    asArray(asRecord(rr.http).paths).forEach((p, pi) => {
      const pp = asRecord(p);
      const svc = asRecord(asRecord(pp.backend).service);
      const port = asRecord(svc.port);
      rows.push({
        key: `${ri}-${pi}`,
        host,
        path: str(pp.path) || "/",
        backend: `${str(svc.name)}:${str(port.number) || str(port.name)}`,
      });
    });
  });
  const tlsHosts = asArray(spec.tls).flatMap((t) => asArray(asRecord(t).hosts).map(str));
  const tlsSecrets = asArray(spec.tls)
    .map((t) => str(asRecord(t).secretName))
    .filter(Boolean);

  return (
    <>
      <Section title="Ingress">
        <KV k="Class" v={str(spec.ingressClassName)} />
        <KV k="TLS hosts" v={tlsHosts.length ? tlsHosts.join(", ") : ""} />
        <KV
          k="TLS secrets"
          v={
            tlsSecrets.length > 0 ? (
              <StringList items={tlsSecrets.map((name) => `Secret/${name}`)} />
            ) : (
              ""
            )
          }
        />
      </Section>
      {rows.length > 0 && (
        <Section title="Rules">
          <Table columns={RULE_COLUMNS} data={rows} getRowKey={(r) => r.key} />
        </Section>
      )}
    </>
  );
}
