import {
  asArray,
  asRecord,
  formatStorageSize,
  phaseKind,
  str,
  type K8sObject,
} from "@srelens/core";
import { KV, StatusPill } from "@srelens/ui-kit";
import { Section } from "./Section";

/**
 * Kubernetes' labels for a PersistentVolume source field, keyed on which
 * volume plugin field of `spec` is set — matches classic's
 * `VOLUME_TYPE_LABELS` / `PERSISTENT_VOLUME_SOURCE_TYPES` pair. Keys that are
 * not in the label table print as the raw field name.
 */
const VOLUME_TYPE_LABELS: Record<string, string> = {
  persistentVolumeClaim: "Persistent Volume Claim",
  emptyDir: "Empty Dir",
  secret: "Secret",
  configMap: "Config Map",
  projected: "Projected",
  hostPath: "Host Path",
  downwardAPI: "Downward API",
  nfs: "NFS",
  csi: "CSI",
};

const PERSISTENT_VOLUME_SOURCE_TYPES = new Set([
  "awsElasticBlockStore",
  "azureDisk",
  "azureFile",
  "cephfs",
  "cinder",
  "csi",
  "fc",
  "flexVolume",
  "flocker",
  "gcePersistentDisk",
  "glusterfs",
  "hostPath",
  "iscsi",
  "local",
  "nfs",
  "photonPersistentDisk",
  "portworxVolume",
  "quobyte",
  "rbd",
  "scaleIO",
  "storageos",
  "vsphereVolume",
]);

/** Bound / Available read as Ready for tone — core's `phaseKind` has no Bound. */
function volumePhaseKind(phase: string) {
  return phaseKind(phase === "Bound" || phase === "Available" ? "Ready" : phase);
}

/**
 * A PersistentVolumeClaim's Volume facts — classic's `PvcBody`, minus the
 * live "Consumed by" pods drill (`podsForPvc`). That reverse lookup is a
 * drill the task leaves out; this pane says only what the claim object has.
 * Storage class and bound volume render as inert `Kind/name` text.
 */
export function PvcDetailsBody({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);
  const phase = str(status.phase);
  const storageClass = str(spec.storageClassName);
  const volumeName = str(spec.volumeName);

  return (
    <Section title="Volume">
      <KV
        k="Status"
        v={<StatusPill status={phase || "—"} kind={volumePhaseKind(phase)} />}
      />
      <KV k="Capacity" v={formatStorageSize(str(asRecord(status.capacity).storage))} />
      <KV k="Access modes" v={asArray(spec.accessModes).map(str).join(", ")} />
      <KV k="Storage class" v={storageClass ? `StorageClass/${storageClass}` : ""} mono />
      <KV k="Volume" v={volumeName ? `PersistentVolume/${volumeName}` : ""} mono />
    </Section>
  );
}

/**
 * A PersistentVolume's facts — classic's `PersistentVolumeBody`. Claim and
 * storage class are inert `Kind/name` text; no live reverse lookups.
 */
export function PersistentVolumeDetailsBody({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);
  const claim = asRecord(spec.claimRef);
  const phase = str(status.phase);
  const sourceType = Object.keys(spec).find((key) => PERSISTENT_VOLUME_SOURCE_TYPES.has(key)) ?? "";
  const storageClass = str(spec.storageClassName);
  const claimName = str(claim.name);
  const claimNs = str(claim.namespace);

  return (
    <Section title="Persistent Volume">
      <KV
        k="Status"
        v={<StatusPill status={phase || "—"} kind={volumePhaseKind(phase)} />}
      />
      <KV k="Capacity" v={formatStorageSize(str(asRecord(spec.capacity).storage))} />
      <KV k="Access modes" v={asArray(spec.accessModes).map(str).join(", ")} />
      <KV k="Reclaim policy" v={str(spec.persistentVolumeReclaimPolicy)} />
      <KV k="Volume mode" v={str(spec.volumeMode)} />
      <KV k="Source" v={sourceType ? VOLUME_TYPE_LABELS[sourceType] ?? sourceType : ""} />
      <KV k="Storage class" v={storageClass ? `StorageClass/${storageClass}` : ""} mono />
      <KV
        k="Claim"
        v={
          claimName
            ? `PersistentVolumeClaim/${claimNs ? `${claimNs}/` : ""}${claimName}`
            : ""
        }
        mono
      />
    </Section>
  );
}
