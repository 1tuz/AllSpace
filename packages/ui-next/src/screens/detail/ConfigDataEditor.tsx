import { useEffect, useState } from "react";
import {
  decodeBase64,
  describeError,
  str,
  updateConfigData,
} from "@srelens/core";
import {
  denyReason,
  reportActionError,
  useAccess,
  type AccessCheck,
} from "@srelens/core/react";
import { Button, EmptyState, Spinner } from "@srelens/ui-kit";

/**
 * Editable key/value data for ConfigMaps and Secrets — classic's
 * `ConfigDataEditor`, on kit primitives.
 *
 * Secret values stay masked until the reader reveals a key (which decodes it
 * for editing). Save only sends the keys that actually changed, as plaintext
 * (the backend patches ConfigMap `data` / Secret `stringData`, so the
 * apiserver handles encoding). Editing is only enabled when a `context` is
 * available.
 *
 * For Secrets, {@link valuesAvailable} is the gate from `SecretDataState`:
 * until `getSecret` answers, Reveal stays disabled and nothing is decoded —
 * the same ruling `SecretEntry` already enforces for TLS/Docker Data rows.
 */
export function ConfigDataEditor({
  context,
  kind,
  namespace,
  name,
  data,
  secret,
  valuesAvailable = true,
  withheldReason,
  onSaved,
}: {
  context: string;
  kind: string;
  namespace: string;
  name: string;
  /** Plaintext (ConfigMap) or base64 (Secret) values by key. For Secrets these
   *  are the real values from the gated `getSecret`, once available. */
  data: Record<string, string>;
  secret: boolean;
  /** False while a Secret's values are loading or refused — Reveal disabled. */
  valuesAvailable?: boolean;
  /** Short label beside a disabled Reveal when values are not on hand. */
  withheldReason?: string;
  onSaved?: () => void;
}) {
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const keys = Object.keys(data);

  const updateCheck: AccessCheck = {
    verb: "update",
    resource: kind === "Secret" ? "secrets" : "configmaps",
    namespace,
  };
  const access = useAccess(context, [updateCheck]);

  useEffect(() => {
    if (secret && !valuesAvailable) return;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) out[k] = secret ? decodeBase64(str(v)) : str(v);
    setBaseline(out);
  }, [data, secret, valuesAvailable]);

  useEffect(() => {
    setEdited({});
    setRevealed({});
  }, [context, kind, namespace, name]);

  const valueOf = (k: string) => edited[k] ?? baseline[k] ?? "";
  const changedKeys = keys.filter((k) => edited[k] !== undefined && edited[k] !== (baseline[k] ?? ""));
  const editable = context !== "" && (!secret || valuesAvailable);

  async function copy(k: string) {
    try {
      await navigator.clipboard?.writeText(valueOf(k));
      setCopied(k);
      setTimeout(() => setCopied((c) => (c === k ? null : c)), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  async function save() {
    setBusy(true);
    setErr("");
    const patch = Object.fromEntries(changedKeys.map((k) => [k, edited[k]]));
    const r = await updateConfigData(context, kind, namespace, name, patch);
    setBusy(false);
    if (r.error) {
      setErr(describeError(r.error).detail);
      reportActionError(context, `Failed to save ${name}`, r.error);
      return;
    }
    // Optimistic: fold the saved edits into the baseline so the pane stays
    // correct without a parent reload of the object.
    setBaseline((b) => {
      const next = { ...b };
      for (const k of changedKeys) next[k] = edited[k] ?? next[k];
      return next;
    });
    setEdited({});
    onSaved?.();
  }

  if (keys.length === 0) return <EmptyState title="No data" />;

  return (
    <div className="flex flex-col gap-4">
      {keys.map((k) => {
        const shown = !secret || revealed[k] === true;
        return (
          <div key={k} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[0.8125rem] font-medium">{k}</span>
              <div className="flex items-center gap-2">
                {secret && !valuesAvailable && withheldReason && (
                  <span className="text-[0.75rem] text-muted">{withheldReason}</span>
                )}
                {shown && valuesAvailable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={`Copy value for ${k}`}
                    onClick={() => void copy(k)}
                  >
                    {copied === k ? "Copied" : "Copy"}
                  </Button>
                )}
                {secret && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={!valuesAvailable}
                    onClick={() => setRevealed((r) => ({ ...r, [k]: !r[k] }))}
                  >
                    {revealed[k] ? "Hide" : "Reveal"}
                  </Button>
                )}
              </div>
            </div>
            {shown && valuesAvailable ? (
              <textarea
                className="w-full resize-y rounded-md border px-2 py-1 font-mono text-[0.8125rem] leading-relaxed outline-none"
                style={{ background: "var(--surface-sunk)", borderColor: "var(--rule)" }}
                aria-label={`Value for ${k}`}
                value={valueOf(k)}
                readOnly={!editable}
                onChange={(e) => setEdited((ed) => ({ ...ed, [k]: e.target.value }))}
                rows={valueOf(k).split("\n").length > 1 ? 4 : 1}
              />
            ) : (
              <pre className="whitespace-pre-wrap break-all font-mono text-[0.8125rem] text-muted">
                ••••••••
              </pre>
            )}
          </div>
        );
      })}
      {editable && changedKeys.length > 0 && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={busy || !access.allowed(updateCheck)}
            title={denyReason(access, updateCheck)}
          >
            {busy ? <Spinner label="Saving" /> : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEdited({})} disabled={busy}>
            Reset
          </Button>
        </div>
      )}
      {err && <p className="text-[0.8125rem] text-sev">{err}</p>}
    </div>
  );
}
