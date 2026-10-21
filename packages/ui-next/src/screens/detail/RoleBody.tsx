import { asArray, asRecord, str, type K8sObject } from "@srelens/core";
import { EmptyState, KV, Table, type Column } from "@srelens/ui-kit";
import { Section } from "./Section";

interface RuleRow {
  key: string;
  apiGroups: string;
  resources: string;
  verbs: string;
}

const RULE_COLUMNS: Column<RuleRow>[] = [
  { key: "apiGroups", header: "API Groups", render: (r) => <span className="font-mono">{r.apiGroups}</span> },
  { key: "resources", header: "Resources", render: (r) => <span className="font-mono">{r.resources}</span> },
  { key: "verbs", header: "Verbs", render: (r) => <span className="font-mono">{r.verbs}</span> },
];

/**
 * A Role / ClusterRole's rule table — classic's `RoleBody`. Same body for both
 * kinds; ClusterRole is just cluster-scoped.
 */
export function RoleDetailsBody({ object }: { object: K8sObject }) {
  const rows: RuleRow[] = asArray(object.rules).map((r, i) => {
    const rr = asRecord(r);
    return {
      key: String(i),
      apiGroups: asArray(rr.apiGroups).map((g) => str(g) || "*").join(", ") || "*",
      resources: asArray(rr.resources).map(str).join(", "),
      verbs: asArray(rr.verbs).map(str).join(", "),
    };
  });

  return (
    <Section title={`Rules (${rows.length})`}>
      {rows.length > 0 ? (
        <Table columns={RULE_COLUMNS} data={rows} getRowKey={(r) => r.key} />
      ) : (
        <EmptyState title="No rules" />
      )}
    </Section>
  );
}

interface SubjectRow {
  key: string;
  kind: string;
  name: string;
  namespace: string;
}

/**
 * A RoleBinding / ClusterRoleBinding — classic's `RoleBindingBody`. Role ref
 * and ServiceAccount subjects render as inert `Kind/name` text.
 */
export function RoleBindingDetailsBody({ object }: { object: K8sObject }) {
  const roleRef = asRecord(object.roleRef);
  const bindingNamespace = str(asRecord(object.metadata).namespace) || null;
  const subjects: SubjectRow[] = asArray(object.subjects).map((s, i) => {
    const ss = asRecord(s);
    return { key: String(i), kind: str(ss.kind), name: str(ss.name), namespace: str(ss.namespace) };
  });
  const subjectColumns: Column<SubjectRow>[] = [
    { key: "kind", header: "Kind", render: (r) => r.kind },
    {
      key: "name",
      header: "Name",
      // Classic links ServiceAccount subjects; here Kind/ns/name text is inert.
      // Namespace falls back to the binding's, matching classic's ResourceLink.
      render: (r) => {
        if (r.kind !== "ServiceAccount") return <span className="font-mono">{r.name}</span>;
        const ns = r.namespace || bindingNamespace;
        return (
          <span className="font-mono">{ns ? `ServiceAccount/${ns}/${r.name}` : `ServiceAccount/${r.name}`}</span>
        );
      },
    },
    { key: "namespace", header: "Namespace", render: (r) => <span className="font-mono">{r.namespace || "—"}</span> },
  ];
  const refKind = str(roleRef.kind);
  const refName = str(roleRef.name);
  // ClusterRole / ClusterRoleBinding refs are cluster-scoped; Role refs stay
  // in the binding's namespace.
  const refText =
    refKind === "Role" && bindingNamespace
      ? `${refKind}/${bindingNamespace}/${refName}`
      : `${refKind}/${refName}`;

  return (
    <>
      <Section title="Role Ref">
        <KV k="Kind" v={refKind} />
        <KV k="Name" v={refText} mono />
      </Section>
      {subjects.length > 0 && (
        <Section title={`Subjects (${subjects.length})`}>
          <Table columns={subjectColumns} data={subjects} getRowKey={(r) => r.key} />
        </Section>
      )}
    </>
  );
}
