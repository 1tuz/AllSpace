import { asRecord, str, usagePercent, type K8sObject } from "@srelens/core";
import { EmptyState, Meter, Table, type Column } from "@srelens/ui-kit";
import { Section } from "./Section";

interface QuotaRow {
  key: string;
  resource: string;
  used: string;
  hard: string;
}

const QUOTA_COLUMNS: Column<QuotaRow>[] = [
  { key: "resource", header: "Resource", render: (r) => <span className="font-mono">{r.resource}</span> },
  { key: "used", header: "Used", render: (r) => r.used },
  { key: "hard", header: "Hard", render: (r) => r.hard },
  {
    key: "usage",
    header: "Usage",
    render: (r) => {
      const pct = usagePercent(r.used, r.hard);
      if (pct == null) return <span className="text-muted">—</span>;
      // Meter, not Progress: quota usage is a reading in a known range, and
      // classic's usage bar picked tone from the same thresholds Meter does.
      return <Meter value={pct} ariaLabel={`${r.resource} usage`} />;
    },
  },
];

/**
 * A ResourceQuota's used/hard table — classic's `ResourceQuotaBody`. Rows come
 * from `status.hard` keys; used values are looked up by the same key.
 */
export function ResourceQuotaDetailsBody({ object }: { object: K8sObject }) {
  const status = asRecord(object.status);
  const hard = asRecord(status.hard);
  const used = asRecord(status.used);
  const rows: QuotaRow[] = Object.keys(hard).map((k) => ({
    key: k,
    resource: k,
    used: str(used[k]),
    hard: str(hard[k]),
  }));

  return (
    <Section title="Quota">
      {rows.length > 0 ? (
        <Table columns={QUOTA_COLUMNS} data={rows} getRowKey={(r) => r.key} />
      ) : (
        <EmptyState title="No quota" />
      )}
    </Section>
  );
}
