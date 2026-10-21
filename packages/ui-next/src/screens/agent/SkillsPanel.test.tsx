import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Skill, SkillMeta } from "@srelens/core";
import { SkillsPanel } from "./SkillsPanel";

const { listSkills, loadSkill, saveSkill, deleteSkill, notify } = vi.hoisted(() => ({
  listSkills: vi.fn(),
  loadSkill: vi.fn(),
  saveSkill: vi.fn(),
  deleteSkill: vi.fn(),
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@srelens/core", async (orig) => ({
  ...(await orig<typeof import("@srelens/core")>()),
  listSkills,
  loadSkill,
  saveSkill,
  deleteSkill,
  notify,
}));

const METAS: SkillMeta[] = [
  { name: "alpha", description: "First skill" },
  { name: "zeta", description: "Last skill" },
];

const ALPHA: Skill = { name: "alpha", description: "First skill", body: "Body for alpha" };

beforeEach(() => {
  vi.clearAllMocks();
  listSkills.mockResolvedValue(METAS);
  loadSkill.mockResolvedValue(ALPHA);
  saveSkill.mockResolvedValue(undefined);
  deleteSkill.mockResolvedValue(undefined);
});

describe("SkillsPanel", () => {
  it("lists skills by name and description", async () => {
    render(<SkillsPanel onClose={vi.fn()} />);

    expect(await screen.findByText("alpha")).toBeTruthy();
    expect(screen.getByText("First skill")).toBeTruthy();
    expect(screen.getByText("zeta")).toBeTruthy();
    expect(screen.getByText("Last skill")).toBeTruthy();
  });

  it("says the list read failed rather than claiming there are no skills", async () => {
    listSkills.mockRejectedValue(new Error("no such command: skill_list"));
    render(<SkillsPanel onClose={vi.fn()} />);

    expect(await screen.findByText(/could not be checked/i)).toBeTruthy();
    expect(screen.getByText(/skill_list/)).toBeTruthy();
    expect(screen.queryByText(/no skills yet/i)).toBeNull();
  });

  it('"New skill" opens an empty editor', async () => {
    render(<SkillsPanel onClose={vi.fn()} />);
    await screen.findByText("alpha");

    await userEvent.click(screen.getByRole("button", { name: "New skill" }));

    expect((await screen.findByLabelText("Skill name")) as HTMLInputElement).toHaveProperty(
      "value",
      "",
    );
    expect((screen.getByLabelText("Skill description") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Skill body") as HTMLTextAreaElement).value).toBe("");
  });

  it("selecting a skill loads it into the editor", async () => {
    render(<SkillsPanel onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText("alpha"));

    expect(loadSkill).toHaveBeenCalledWith("alpha");
    await waitFor(() => {
      expect((screen.getByLabelText("Skill name") as HTMLInputElement).value).toBe("alpha");
    });
    expect((screen.getByLabelText("Skill description") as HTMLInputElement).value).toBe("First skill");
    expect((screen.getByLabelText("Skill body") as HTMLTextAreaElement).value).toBe("Body for alpha");
  });

  it("Save calls saveSkill with the typed fields, refreshes, and notifies onChanged", async () => {
    const onChanged = vi.fn();
    render(<SkillsPanel onClose={vi.fn()} onChanged={onChanged} />);
    await screen.findByText("alpha");

    await userEvent.click(screen.getByRole("button", { name: "New skill" }));
    await userEvent.type(await screen.findByLabelText("Skill name"), "crashloop-triage");
    await userEvent.type(
      screen.getByLabelText("Skill description"),
      "Systematic triage for a pod that keeps restarting",
    );
    await userEvent.type(screen.getByLabelText("Skill body"), "Step 1: check the exit code.");

    listSkills.mockResolvedValueOnce([
      ...METAS,
      { name: "crashloop-triage", description: "Systematic triage for a pod that keeps restarting" },
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveSkill).toHaveBeenCalledTimes(1));
    expect(saveSkill).toHaveBeenCalledWith({
      name: "crashloop-triage",
      description: "Systematic triage for a pod that keeps restarting",
      body: "Step 1: check the exit code.",
    });
    await waitFor(() => expect(listSkills).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalledWith("Skill saved");
    expect(await screen.findByText("crashloop-triage")).toBeTruthy();
  });

  it("renaming an existing skill deletes the old file after writing the new one", async () => {
    render(<SkillsPanel onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText("alpha"));
    await waitFor(() =>
      expect((screen.getByLabelText("Skill name") as HTMLInputElement).value).toBe("alpha"),
    );

    const nameInput = screen.getByLabelText("Skill name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "alpha-renamed");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveSkill).toHaveBeenCalledWith(expect.objectContaining({ name: "alpha-renamed" })),
    );
    await waitFor(() => expect(deleteSkill).toHaveBeenCalledWith("alpha"));
  });

  it("refuses to rename a skill onto another existing skill's name", async () => {
    render(<SkillsPanel onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText("alpha"));
    await waitFor(() =>
      expect((screen.getByLabelText("Skill name") as HTMLInputElement).value).toBe("alpha"),
    );

    const nameInput = screen.getByLabelText("Skill name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "zeta");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/already exists/i)).toBeTruthy();
    expect(saveSkill).not.toHaveBeenCalled();
    expect(deleteSkill).not.toHaveBeenCalled();
  });

  it("saving an existing skill without renaming does not delete anything", async () => {
    render(<SkillsPanel onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText("alpha"));
    await waitFor(() =>
      expect((screen.getByLabelText("Skill name") as HTMLInputElement).value).toBe("alpha"),
    );

    await userEvent.clear(screen.getByLabelText("Skill body"));
    await userEvent.type(screen.getByLabelText("Skill body"), "edited body");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveSkill).toHaveBeenCalledTimes(1));
    expect(deleteSkill).not.toHaveBeenCalled();
  });

  it("Delete, once confirmed, calls deleteSkill with the skill's name", async () => {
    const onChanged = vi.fn();
    render(<SkillsPanel onClose={vi.fn()} onChanged={onChanged} />);
    await screen.findByText("alpha");

    await userEvent.click(screen.getByRole("button", { name: "Delete alpha" }));
    expect(await screen.findByText(/Delete "alpha"/)).toBeTruthy();

    listSkills.mockResolvedValueOnce([METAS[1]]);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteSkill).toHaveBeenCalledWith("alpha"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("Delete does not call deleteSkill when the confirmation is cancelled", async () => {
    render(<SkillsPanel onClose={vi.fn()} />);
    await screen.findByText("alpha");

    await userEvent.click(screen.getByRole("button", { name: "Delete alpha" }));
    await screen.findByText(/Delete "alpha"/);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteSkill).not.toHaveBeenCalled();
  });

  it("hides delete for a builtin skill", async () => {
    listSkills.mockResolvedValue([{ name: "shipped", description: "Built-in", builtin: true }]);
    render(<SkillsPanel onClose={vi.fn()} />);

    expect(await screen.findByText("shipped")).toBeTruthy();
    expect(screen.getByText("Default")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete shipped" })).toBeNull();
  });
});
