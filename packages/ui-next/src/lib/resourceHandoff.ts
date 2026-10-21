/**
 * Cross-tab handoff when `/` (or anything else) opens `/terminals`,
 * `/forwards`, or a resource detail tab for a resource that already has an
 * identity.
 *
 * Those screens mount their own `NewSessionMenu` / `NewForwardDialog` /
 * ResourceMenu Pending confirm; there is no route param that can carry the
 * subject (or the verb). This module is the channel: the opener offers an
 * intent, then `openTab`s the screen; the screen takes the intent once and
 * opens the dialog already pointed at it.
 *
 * **Take-once.** A second visit to `/terminals` must not reopen yesterday's
 * pod. `offer` replaces any unread intent of the same kind; `take` clears it.
 *
 * **Not a start / not a mutate.** Offering a shell does not call
 * `startPodSession` — that is still the menu's job (and `ResourceMenu`'s,
 * which starts the session itself and never needs this channel). Offering a
 * forward does not start a tunnel; the dialog still asks for a remote port
 * when the opener did not know one. Offering an action does not call
 * `deleteResource` / `rolloutRestart` / … — ResourceMenu's Pending confirm
 * still owns the write.
 *
 * **Node vs pod.** A pod handoff carries namespace + pod; a node handoff
 * carries only the node name. `offerShell` for pods cannot name a node —
 * Overview's Node shell uses {@link offerNodeShell} instead.
 */

export type ShellHandoff =
  | { kind?: "pod"; context: string; namespace: string; pod: string }
  | { kind: "node"; context: string; node: string };

export interface ForwardHandoff {
  context: string;
  namespace: string;
  /** Kubernetes kind — `Pod` or `Service`. */
  kind: string;
  name: string;
}

/** Verbs the Console `/` Action group can hand to ResourceMenu's Pending. */
export type ActionHandoffVerb =
  | "delete"
  | "evict"
  | "suspend"
  | "trigger"
  | "scale"
  | "restart";

export interface ActionHandoff {
  context: string;
  kind: string;
  namespace: string;
  name: string;
  action: ActionHandoffVerb;
}

let shell: ShellHandoff | null = null;
let forward: ForwardHandoff | null = null;
let action: ActionHandoff | null = null;
const shellListeners = new Set<() => void>();
const forwardListeners = new Set<() => void>();
const actionListeners = new Set<() => void>();

function notify(listeners: Set<() => void>) {
  for (const l of listeners) l();
}

export function offerShell(intent: ShellHandoff): void {
  shell = intent;
  notify(shellListeners);
}

/** Overview / Node detail → Terminals, already on the Node kind with a pick. */
export function offerNodeShell(intent: { context: string; node: string }): void {
  offerShell({ kind: "node", context: intent.context, node: intent.node });
}

export function takeShell(): ShellHandoff | null {
  const next = shell;
  if (next === null) return null;
  shell = null;
  notify(shellListeners);
  return next;
}

export function peekShell(): ShellHandoff | null {
  return shell;
}

export function subscribeShell(listener: () => void): () => void {
  shellListeners.add(listener);
  return () => {
    shellListeners.delete(listener);
  };
}

export function offerForward(intent: ForwardHandoff): void {
  forward = intent;
  notify(forwardListeners);
}

export function takeForward(): ForwardHandoff | null {
  const next = forward;
  if (next === null) return null;
  forward = null;
  notify(forwardListeners);
  return next;
}

export function peekForward(): ForwardHandoff | null {
  return forward;
}

export function subscribeForward(listener: () => void): () => void {
  forwardListeners.add(listener);
  return () => {
    forwardListeners.delete(listener);
  };
}

export function offerAction(intent: ActionHandoff): void {
  action = intent;
  notify(actionListeners);
}

export function takeAction(): ActionHandoff | null {
  const next = action;
  if (next === null) return null;
  action = null;
  notify(actionListeners);
  return next;
}

export function peekAction(): ActionHandoff | null {
  return action;
}

export function subscribeAction(listener: () => void): () => void {
  actionListeners.add(listener);
  return () => {
    actionListeners.delete(listener);
  };
}

/** Clear every channel between tests. */
export function __resetResourceHandoffForTests(): void {
  shell = null;
  forward = null;
  action = null;
  shellListeners.clear();
  forwardListeners.clear();
  actionListeners.clear();
}
