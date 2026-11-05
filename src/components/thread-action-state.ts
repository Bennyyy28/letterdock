import type { MailThread, ThreadAction, ThreadActionResult } from "../lib/mail-types";
import { newerMessage, threadReadKey } from "./thread-read-state";

export interface ThreadActionAttempt { key: string; token: number; thread: MailThread; action: ThreadAction; }

export function availableThreadActions(folder: MailThread["folder"]): ThreadAction[] {
  return [folder === "archive" || folder === "trash" ? "inbox" : "archive", "unread", ...(folder === "trash" ? [] : ["trash" as const])];
}

export function confirmsThreadAction(value: unknown, thread: Pick<MailThread, "id">, action: ThreadAction): value is ThreadActionResult {
  if (!value || typeof value !== "object" || !("id" in value) || value.id !== thread.id) return false;
  return action === "unread" ? "read" in value && value.read === false : "folder" in value && value.folder === action;
}

/** Confirmed intent survives stale GETs; pending and failed writes never change rows. */
export class ThreadActionState {
  private pending = new Map<string, ThreadActionAttempt>();
  private failed = new Map<string, ThreadActionAttempt>();
  private folders = new Map<string, { thread: MailThread; folder: "archive" | "trash" | "inbox" }>();
  private writes = new Map<string, Promise<void>>();
  private sequence = 0;

  begin(thread: MailThread, action: ThreadAction): ThreadActionAttempt | null {
    const key = threadReadKey(thread);
    if (this.pending.has(key)) return null;
    const attempt = { key, token: ++this.sequence, thread: { ...thread }, action };
    this.pending.set(key, attempt);
    this.failed.delete(key);
    return attempt;
  }

  complete(attempt: ThreadActionAttempt): boolean {
    if (this.pending.get(attempt.key)?.token !== attempt.token) return false;
    this.pending.delete(attempt.key);
    if (attempt.action !== "unread") this.folders.set(attempt.key, { thread: attempt.thread, folder: attempt.action });
    return true;
  }

  fail(attempt: ThreadActionAttempt): boolean {
    if (this.pending.get(attempt.key)?.token !== attempt.token) return false;
    this.pending.delete(attempt.key);
    this.failed.set(attempt.key, attempt);
    return true;
  }

  pendingAction(thread: Pick<MailThread, "inboxKey" | "id">): ThreadAction | undefined { return this.pending.get(threadReadKey(thread))?.action; }
  failures(): ThreadActionAttempt[] { return [...this.failed.values()]; }

  apply(thread: MailThread): MailThread {
    const saved = this.folders.get(threadReadKey(thread));
    return saved && !newerMessage(thread, saved.thread) ? { ...thread, folder: saved.folder } : thread;
  }

  /** All metadata writes share one per-conversation queue, including read-on-open. */
  enqueue<T>(thread: Pick<MailThread, "inboxKey" | "id">, write: () => Promise<T>): Promise<T> {
    const key = threadReadKey(thread);
    const result = (this.writes.get(key) || Promise.resolve()).then(write);
    const settled = result.then(() => {}, () => {});
    this.writes.set(key, settled);
    void settled.then(() => { if (this.writes.get(key) === settled) this.writes.delete(key); });
    return result;
  }
}
