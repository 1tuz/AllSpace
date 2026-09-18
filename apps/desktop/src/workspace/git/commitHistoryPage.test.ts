import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMIT_PAGE_SIZE,
  normalizeCommitPageSize,
  sliceCommitPage,
} from "./commitHistoryPage";

describe("normalizeCommitPageSize", () => {
  it("keeps positive integers", () => {
    expect(normalizeCommitPageSize(50)).toBe(50);
  });

  it("falls back for zero, negative, and NaN", () => {
    expect(normalizeCommitPageSize(0)).toBe(DEFAULT_COMMIT_PAGE_SIZE);
    expect(normalizeCommitPageSize(-3)).toBe(DEFAULT_COMMIT_PAGE_SIZE);
    expect(normalizeCommitPageSize(Number.NaN)).toBe(DEFAULT_COMMIT_PAGE_SIZE);
  });

  it("floors fractional sizes", () => {
    expect(normalizeCommitPageSize(30.9)).toBe(30);
  });
});

describe("sliceCommitPage", () => {
  const ids = Array.from({ length: 75 }, (_, i) => `c${i}`);

  it("returns the first page by default", () => {
    const page = sliceCommitPage(ids, 0, 30);
    expect(page.items).toEqual(ids.slice(0, 30));
    expect(page.pageIndex).toBe(0);
    expect(page.pageCount).toBe(3);
    expect(page.total).toBe(75);
    expect(page.hasPrev).toBe(false);
    expect(page.hasNext).toBe(true);
  });

  it("returns a middle page", () => {
    const page = sliceCommitPage(ids, 1, 30);
    expect(page.items).toEqual(ids.slice(30, 60));
    expect(page.hasPrev).toBe(true);
    expect(page.hasNext).toBe(true);
  });

  it("returns a short last page", () => {
    const page = sliceCommitPage(ids, 2, 30);
    expect(page.items).toEqual(ids.slice(60, 75));
    expect(page.hasPrev).toBe(true);
    expect(page.hasNext).toBe(false);
  });

  it("clamps pageIndex past the end", () => {
    const page = sliceCommitPage(ids, 99, 30);
    expect(page.pageIndex).toBe(2);
    expect(page.items).toEqual(ids.slice(60, 75));
  });

  it("clamps negative pageIndex to zero", () => {
    const page = sliceCommitPage(ids, -4, 30);
    expect(page.pageIndex).toBe(0);
    expect(page.items).toEqual(ids.slice(0, 30));
  });

  it("handles an empty list", () => {
    const page = sliceCommitPage([], 0, 30);
    expect(page).toEqual({
      items: [],
      pageIndex: 0,
      pageSize: 30,
      total: 0,
      pageCount: 0,
      hasPrev: false,
      hasNext: false,
    });
  });

  it("uses a single page when total fits", () => {
    const page = sliceCommitPage(ids.slice(0, 10), 0, 30);
    expect(page.pageCount).toBe(1);
    expect(page.hasNext).toBe(false);
    expect(page.items).toHaveLength(10);
  });
});
