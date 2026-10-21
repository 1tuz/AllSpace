import { useEffect, useState } from "react";
import {
  deleteSkill,
  listSkills,
  loadSkill,
  notify,
  saveSkill,
  type Skill,
  type SkillMeta,
} from "@srelens/core";
import { Alert, Button, ConfirmDialog, Dialog, Field, TextInput, cx } from "@srelens/ui-kit";

const BLANK: Skill = { name: "", description: "", body: "" };

/**
 * Skills CRUD for the Agent rail — list / create / edit / save / delete.
 *
 * Same disk store and core wrappers as classic `SkillsPanel`
 * (`listSkills` / `loadSkill` / `saveSkill` / `deleteSkill`). Opened from
 * {@link RunsRail}'s Skills section; the rail keeps the per-run
 * `activeSkills` toggles and refreshes its list via `onChanged`.
 *
 * TODO: Generate with AI — classic wires a one-shot `startChat`/`sendChat`
 * meta-prompt plus front-matter parse into the editor (never auto-saves).
 * Port when wanted; not needed for usable CRUD.
 */
export function SkillsPanel({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  /** Fired after a successful save or delete so the rail can re-list. */
  onChanged?: () => void;
}) {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [listError, setListError] = useState<unknown>(null);

  async function refresh() {
    try {
      setListError(null);
      setSkills(await listSkills());
    } catch (e) {
      setListError(e);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function select(name: string) {
    setError("");
    try {
      const skill = await loadSkill(name);
      setSelected(name);
      setEditing(skill);
    } catch (e) {
      setError(String(e));
    }
  }

  function newSkill() {
    setError("");
    setSelected(null);
    setEditing({ ...BLANK });
  }

  async function save() {
    if (!editing) return;
    setError("");
    const renamedFrom = selected;
    // Refuse to clobber a DIFFERENT existing skill — create or rename onto
    // another's name would overwrite that file, and rename-cleanup would then
    // delete the source.
    if (skills.some((s) => s.name === editing.name && s.name !== renamedFrom)) {
      setError(`A skill named "${editing.name}" already exists — choose a different name.`);
      return;
    }
    try {
      await saveSkill(editing);
      if (renamedFrom && renamedFrom !== editing.name) {
        await deleteSkill(renamedFrom);
      }
      setSelected(editing.name);
      await refresh();
      onChanged?.();
      notify.success("Skill saved");
    } catch (e) {
      setError(String(e));
    }
  }

  async function confirmDelete() {
    const name = pendingDelete;
    if (!name) return;
    setPendingDelete(null);
    try {
      await deleteSkill(name);
      if (selected === name) {
        setSelected(null);
        setEditing(null);
      }
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <>
      <Dialog
        title="Skills"
        maxWidth={720}
        onClose={onClose}
        footer={
          editing ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => void save()}
              disabled={!editing.name.trim()}
            >
              Save
            </Button>
          ) : undefined
        }
      >
        <div className="flex h-[28rem] min-h-0 gap-0">
          <div className="flex w-56 shrink-0 flex-col border-r border-rule">
            <div className="border-b border-rule px-3 py-2">
              <Button variant="secondary" size="sm" className="w-full" onClick={newSkill}>
                New skill
              </Button>
            </div>
            {listError !== null ? (
              <Alert tone="sev" className="m-2" title="Saved skills could not be checked">
                {String(listError)}
              </Alert>
            ) : skills.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted">No skills yet.</p>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto">
                {skills.map((s) => (
                  <li
                    key={s.name}
                    className={cx(
                      "group flex items-center gap-1 border-b border-rule px-2 py-1.5 last:border-b-0",
                      selected === s.name && "bg-sunk",
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-sm hover:opacity-90"
                      onClick={() => void select(s.name)}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate font-medium">{s.name}</span>
                        {s.builtin && (
                          <span className="shrink-0 rounded border border-rule px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                            Default
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted">{s.description}</span>
                    </button>
                    {!s.builtin && (
                      <button
                        type="button"
                        aria-label={`Delete ${s.name}`}
                        onClick={() => setPendingDelete(s.name)}
                        className="shrink-0 px-1 text-muted opacity-0 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
            {editing ? (
              <>
                <Field label="Name">
                  <TextInput
                    aria-label="Skill name"
                    value={editing.name}
                    onValueChange={(v) => setEditing({ ...editing, name: v })}
                    placeholder="crashloop-triage"
                  />
                </Field>
                <Field label="Description">
                  <TextInput
                    aria-label="Skill description"
                    value={editing.description}
                    onValueChange={(v) => setEditing({ ...editing, description: v })}
                    placeholder="Systematic triage for a pod that keeps restarting"
                  />
                </Field>
                <Field label="Body" className="min-h-0 flex-1">
                  <textarea
                    aria-label="Skill body"
                    value={editing.body}
                    onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                    spellCheck={false}
                    className="h-full min-h-[12rem] w-full resize-none rounded-md border px-2 py-1 font-mono text-[0.75rem] leading-relaxed outline-none"
                    style={{ background: "var(--surface-sunk)", borderColor: "var(--rule)" }}
                  />
                </Field>
              </>
            ) : (
              <p className="text-sm text-muted">Select a skill, or create a new one.</p>
            )}
            {error && (
              <p role="alert" className="text-sm text-sev">
                {error}
              </p>
            )}
          </div>
        </div>
      </Dialog>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete}"?`}
          message="This removes the skill's file from disk. This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
