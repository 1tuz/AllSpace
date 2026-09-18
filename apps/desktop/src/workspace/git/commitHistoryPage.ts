/**
 * Client-side commit history paging over an already-fetched list.
 * Provider-side pagination (cursor / page token on listCommits) may come later.
 */

export const DEFAULT_COMMIT_PAGE_SIZE = 30;
export const COMMIT_PAGE_SIZE_OPTIONS = [30, 50, 100] as const;

export type CommitPageSlice<T> = {
  items: T[];
  pageIndex: number;
  pageSize: number;
  total: number;
  pageCount: number;
  hasPrev: boolean;
  hasNext: boolean;
};

/** Clamp page size to a positive integer; fall back to the default. */
export function normalizeCommitPageSize(pageSize: number): number {
  const n = Math.floor(pageSize);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_COMMIT_PAGE_SIZE;
}

/**
 * Slice `items` into one page. Out-of-range `pageIndex` clamps into
 * `[0, pageCount)`. Empty lists yield `pageCount: 0` and an empty slice.
 */
export function sliceCommitPage<T>(
  items: readonly T[],
  pageIndex: number,
  pageSize: number,
): CommitPageSlice<T> {
  const total = items.length;
  const size = normalizeCommitPageSize(pageSize);
  const pageCount = total === 0 ? 0 : Math.ceil(total / size);
  const maxIndex = Math.max(0, pageCount - 1);
  const rawIndex = Math.floor(pageIndex);
  const index = Number.isFinite(rawIndex)
    ? Math.min(Math.max(0, rawIndex), maxIndex)
    : 0;
  const start = index * size;
  return {
    items: items.slice(start, start + size) as T[],
    pageIndex: index,
    pageSize: size,
    total,
    pageCount,
    hasPrev: index > 0,
    hasNext: pageCount > 0 && index + 1 < pageCount,
  };
}
