import { describe, expect, it } from "vitest";
import {
  commitsFromEntities,
  layoutLanes,
  laneColumnWidth,
  type LaneCommit,
} from "./laneGraph";

describe("layoutLanes", () => {
  it("keeps empty-parent stubs on a single lane", () => {
    const commits: LaneCommit[] = [
      { id: "a", parents: [], title: "one" },
      { id: "b", parents: [], title: "two" },
      { id: "c", parents: [], title: "three" },
    ];
    const rows = layoutLanes(commits);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.every((r) => r.edges.some((e) => e.fromLane === 0 && e.toLane === 0))).toBe(true);
  });

  it("continues first parent on the same lane", () => {
    const commits: LaneCommit[] = [
      { id: "tip", parents: ["mid"], title: "tip" },
      { id: "mid", parents: ["base"], title: "mid" },
      { id: "base", parents: [], title: "base" },
    ];
    const rows = layoutLanes(commits);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
  });

  it("opens a side lane for a second parent (merge)", () => {
    const commits: LaneCommit[] = [
      { id: "merge", parents: ["main", "feature"], title: "merge" },
      { id: "feature", parents: ["main"], title: "feature" },
      { id: "main", parents: [], title: "main" },
    ];
    const rows = layoutLanes(commits);
    expect(rows[0]!.lane).toBe(0);
    expect(rows[0]!.edges.some((e) => e.toLane === 1)).toBe(true);
    expect(rows[1]!.lane).toBe(1);
    expect(rows[2]!.lane).toBe(0);
  });
});

describe("commitsFromEntities", () => {
  it("maps sha + empty parents when graph data absent", () => {
    expect(
      commitsFromEntities([
        {
          id: "gitlab:commit:7:abc",
          kind: "commit",
          title: "Fix",
          attributes: { sha: "abc" },
        },
        { id: "gitlab:branch:7:main", kind: "branch", title: "main" },
      ]),
    ).toEqual([{ id: "abc", parents: [], title: "Fix" }]);
  });

  it("reads parents / parentIds when present", () => {
    expect(
      commitsFromEntities([
        {
          id: "x",
          kind: "commit",
          title: "m",
          attributes: { sha: "m1", parents: ["p1", "p2"] },
        },
      ]),
    ).toEqual([{ id: "m1", parents: ["p1", "p2"], title: "m" }]);
  });
});

describe("laneColumnWidth", () => {
  it("grows with lane count", () => {
    expect(laneColumnWidth(2)).toBeGreaterThan(laneColumnWidth(1));
  });
});
