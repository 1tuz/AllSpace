import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMergeRequestDiff, getPullRequestDiff } from "./changeDiff";

describe("changeDiff wrappers", () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
  });

  it("getMergeRequestDiff sends camelCase projectId, iid, maxFiles", async () => {
    invoke.mockResolvedValue({
      files: [{ path: "src/a.rs", status: "modified", patch: "+x\n" }],
      truncated: false,
      totalFiles: 1,
    });
    const out = await getMergeRequestDiff(
      { projectId: "7", iid: "482", maxFiles: 10 },
      invoke,
    );
    expect(invoke).toHaveBeenCalledWith("gitlab.getMergeRequestDiff", {
      projectId: "7",
      iid: 482,
      maxFiles: 10,
    });
    expect(out.files[0]?.path).toBe("src/a.rs");
    expect(out.truncated).toBe(false);
  });

  it("getPullRequestDiff sends camelCase projectKey, repositorySlug, pullRequestId", async () => {
    invoke.mockResolvedValue({
      files: [{ path: "a.txt", status: "added" }],
      truncated: true,
      totalFiles: 1,
    });
    await getPullRequestDiff(
      {
        projectKey: "KOMUS",
        repositorySlug: "checkout-api",
        pullRequestId: "8821",
        maxFiles: 5,
      },
      invoke,
    );
    expect(invoke).toHaveBeenCalledWith("bitbucket.getPullRequestDiff", {
      projectKey: "KOMUS",
      repositorySlug: "checkout-api",
      pullRequestId: 8821,
      maxFiles: 5,
    });
  });
});
