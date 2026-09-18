/**
 * Tiny SVG commit-lane column for the delivery Git history.
 *
 * Lane assignment is a minimal in-order walk (first parent continues the lane;
 * extra parents open/merge side lanes). Inspired by common git-graph layout
 * ideas (e.g. mubashirjamali101/gitgraph patterns) — no MIT code copied.
 *
 * Lane SVG is drawn for the current history page only (see commitHistoryPage).
 * Provider-side listCommits pagination may come later.
 */

export type LaneCommit = {
  id: string;
  parents: string[];
  title: string;
};

export type LaneEdge = {
  fromLane: number;
  toLane: number;
};

export type LaneRow = {
  id: string;
  title: string;
  lane: number;
  /** Active lane slots after placing this commit (id waiting, or null hole). */
  active: (string | null)[];
  edges: LaneEdge[];
};

const LANE_GAP = 14;
const PAD_X = 8;
const NODE_R = 3.5;

/** Assign lane indices + parent edges for a small page of commits. */
export function layoutLanes(commits: LaneCommit[]): LaneRow[] {
  const active: (string | null)[] = [];
  const rows: LaneRow[] = [];

  for (const commit of commits) {
    let lane = active.indexOf(commit.id);
    if (lane < 0) {
      lane = active.indexOf(null);
      if (lane < 0) {
        active.push(commit.id);
        lane = active.length - 1;
      } else {
        active[lane] = commit.id;
      }
    }

    const edges: LaneEdge[] = [];
    const parents = commit.parents.filter((p) => p.length > 0);

    // Always emit a primary downward edge so empty-parent stubs still draw a
    // single vertical lane; SVG skips the last row.
    edges.push({ fromLane: lane, toLane: lane });

    if (parents.length === 0) {
      active[lane] = null;
    } else {
      const [first, ...rest] = parents;
      active[lane] = first;

      for (const parent of rest) {
        let toLane = active.indexOf(parent);
        if (toLane < 0) {
          toLane = active.indexOf(null);
          if (toLane < 0) {
            active.push(parent);
            toLane = active.length - 1;
          } else {
            active[toLane] = parent;
          }
        }
        edges.push({ fromLane: lane, toLane });
      }
    }

    rows.push({
      id: commit.id,
      title: commit.title,
      lane,
      active: active.slice(),
      edges,
    });
  }

  return rows;
}

export function laneColumnWidth(laneCount: number): number {
  const n = Math.max(1, laneCount);
  return PAD_X * 2 + (n - 1) * LANE_GAP + NODE_R * 2;
}

function laneX(lane: number): number {
  return PAD_X + NODE_R + lane * LANE_GAP;
}

type PanelEntityLike = {
  id: string;
  kind: string;
  title: string;
  attributes?: Record<string, unknown>;
};

/**
 * Map provider-neutral commit entities → lane nodes.
 * Missing parents → [] (honest single-lane stub topology).
 */
export function commitsFromEntities(entities: PanelEntityLike[]): LaneCommit[] {
  return entities
    .filter((e) => e.kind === "commit")
    .map((e) => {
      const attrs = e.attributes ?? {};
      const sha = typeof attrs.sha === "string" && attrs.sha.length > 0 ? attrs.sha : e.id;
      const rawParents = attrs.parents ?? attrs.parentIds;
      const parents = Array.isArray(rawParents)
        ? rawParents.filter((p): p is string => typeof p === "string" && p.length > 0)
        : [];
      return { id: sha, parents, title: e.title };
    });
}

export type LaneGraphSvgProps = {
  rows: LaneRow[];
  rowHeight?: number;
  className?: string;
};

/** One SVG covering all rows on the current history page. */
export function LaneGraphSvg({ rows, rowHeight = 56, className }: LaneGraphSvgProps) {
  const laneCount = rows.reduce((max, r) => Math.max(max, r.active.length, r.lane + 1), 1);
  const width = laneColumnWidth(laneCount);
  const height = Math.max(rowHeight, rows.length * rowHeight);

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      data-testid="git-lane-graph"
      data-lane-count={laneCount}
    >
      {rows.map((row, i) => {
        const y = i * rowHeight + rowHeight / 2;
        const x = laneX(row.lane);
        const nextY = (i + 1) * rowHeight + rowHeight / 2;
        return (
          <g key={row.id} data-commit-id={row.id} data-lane={row.lane}>
            {row.edges.map((edge, ei) => {
              const x1 = laneX(edge.fromLane);
              const x2 = laneX(edge.toLane);
              if (i >= rows.length - 1) return null;
              if (x1 === x2) {
                return (
                  <line
                    key={ei}
                    x1={x1}
                    y1={y}
                    x2={x2}
                    y2={nextY}
                    stroke="currentColor"
                    strokeWidth={1.25}
                    opacity={0.55}
                  />
                );
              }
              const midY = (y + nextY) / 2;
              return (
                <path
                  key={ei}
                  d={`M ${x1} ${y} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${nextY}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.25}
                  opacity={0.55}
                />
              );
            })}
            {/* Continuity for active lanes that are not this node (pass-through). */}
            {row.active.map((waiting, li) => {
              if (waiting == null || li === row.lane || i >= rows.length - 1) return null;
              const px = laneX(li);
              return (
                <line
                  key={`pass-${li}`}
                  x1={px}
                  y1={y}
                  x2={px}
                  y2={nextY}
                  stroke="currentColor"
                  strokeWidth={1}
                  opacity={0.35}
                />
              );
            })}
            <circle
              cx={x}
              cy={y}
              r={NODE_R}
              fill="currentColor"
              opacity={0.9}
            />
          </g>
        );
      })}
    </svg>
  );
}
