import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __resetResourceHandoffForTests,
  offerAction,
  offerForward,
  offerShell,
  peekAction,
  peekForward,
  peekShell,
  subscribeAction,
  subscribeForward,
  subscribeShell,
  takeAction,
  takeForward,
  takeShell,
} from "./resourceHandoff";

beforeEach(() => {
  __resetResourceHandoffForTests();
});

describe("resourceHandoff", () => {
  it("hands a shell intent to the next take, then forgets it", () => {
    offerShell({ context: "prod-eu", namespace: "checkout", pod: "api-0" });
    expect(peekShell()).toEqual({ context: "prod-eu", namespace: "checkout", pod: "api-0" });
    expect(takeShell()).toEqual({ context: "prod-eu", namespace: "checkout", pod: "api-0" });
    expect(takeShell()).toBeNull();
    expect(peekShell()).toBeNull();
  });

  it("hands a forward intent to the next take, then forgets it", () => {
    offerForward({ context: "prod-eu", namespace: "checkout", kind: "Pod", name: "api-0" });
    expect(peekForward()).toEqual({
      context: "prod-eu",
      namespace: "checkout",
      kind: "Pod",
      name: "api-0",
    });
    expect(takeForward()).toEqual({
      context: "prod-eu",
      namespace: "checkout",
      kind: "Pod",
      name: "api-0",
    });
    expect(takeForward()).toBeNull();
  });

  it("hands an action intent to the next take, then forgets it", () => {
    offerAction({
      context: "prod-eu",
      kind: "Deployment",
      namespace: "checkout",
      name: "api",
      action: "delete",
    });
    expect(peekAction()).toEqual({
      context: "prod-eu",
      kind: "Deployment",
      namespace: "checkout",
      name: "api",
      action: "delete",
    });
    expect(takeAction()?.action).toBe("delete");
    expect(takeAction()).toBeNull();
    expect(peekAction()).toBeNull();
  });

  it("replaces an unread shell intent when a newer one is offered", () => {
    offerShell({ context: "prod-eu", namespace: "checkout", pod: "old" });
    offerShell({ context: "staging", namespace: "default", pod: "new" });
    expect(takeShell()).toMatchObject({ pod: "new" });
  });

  it("replaces an unread action intent when a newer one is offered", () => {
    offerAction({
      context: "prod-eu",
      kind: "Pod",
      namespace: "checkout",
      name: "old",
      action: "evict",
    });
    offerAction({
      context: "staging",
      kind: "Deployment",
      namespace: "default",
      name: "new",
      action: "restart",
    });
    expect(takeAction()).toEqual({
      context: "staging",
      kind: "Deployment",
      namespace: "default",
      name: "new",
      action: "restart",
    });
  });

  it("notifies shell subscribers on offer and on take", () => {
    const seen = vi.fn();
    const unsub = subscribeShell(seen);
    offerShell({ context: "prod-eu", namespace: "checkout", pod: "api-0" });
    expect(seen).toHaveBeenCalledTimes(1);
    takeShell();
    expect(seen).toHaveBeenCalledTimes(2);
    unsub();
    offerShell({ context: "prod-eu", namespace: "checkout", pod: "api-1" });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("notifies forward subscribers on offer and on take", () => {
    const seen = vi.fn();
    const unsub = subscribeForward(seen);
    offerForward({ context: "prod-eu", namespace: "checkout", kind: "Service", name: "api" });
    expect(seen).toHaveBeenCalledTimes(1);
    takeForward();
    expect(seen).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("notifies action subscribers on offer and on take", () => {
    const seen = vi.fn();
    const unsub = subscribeAction(seen);
    offerAction({
      context: "prod-eu",
      kind: "Pod",
      namespace: "checkout",
      name: "api-0",
      action: "delete",
    });
    expect(seen).toHaveBeenCalledTimes(1);
    takeAction();
    expect(seen).toHaveBeenCalledTimes(2);
    unsub();
  });
});
