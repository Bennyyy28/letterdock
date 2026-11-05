import type { MailThread } from "../lib/mail-types";

export const threadReadKey = (thread: Pick<MailThread, "id" | "inboxKey">) => `${thread.inboxKey}:${thread.id}`;
export interface ReadAttempt { key: string; token: number; thread: MailThread; }
interface ReadEntry extends ReadAttempt { state: "pending" | "saved" | "failed"; unread: boolean; }
export function newerMessage(thread: MailThread, opened: MailThread) {
  return thread.messageCount > opened.messageCount || new Date(thread.updatedAt).getTime() > new Date(opened.updatedAt).getTime();
}

/** Local overlays preserve explicit read intent across stale GETs, without hiding newer mail. */
export class ThreadReadState {
  private entries = new Map<string, ReadEntry>();
  private sequence = 0;

  begin(thread: MailThread): ReadAttempt | null {
    if (!thread.unread) return null;
    const key = threadReadKey(thread);
    const previous = this.entries.get(key);
    if (previous && !previous.unread && previous.state !== "failed" && !newerMessage(thread, previous.thread)) return null;
    const attempt = { key, token: ++this.sequence, thread: { ...thread } };
    this.entries.set(key, { ...attempt, state: "pending", unread: false });
    return attempt;
  }
  complete(attempt: ReadAttempt): boolean { return this.settle(attempt, "saved"); }
  fail(attempt: ReadAttempt): boolean { return this.settle(attempt, "failed"); }
  markUnread(thread: MailThread) {
    const key = threadReadKey(thread);
    this.entries.set(key, { key, token: ++this.sequence, thread: { ...thread }, state: "saved", unread: true });
  }
  private settle(attempt: ReadAttempt, state: "saved" | "failed") {
    const current = this.entries.get(attempt.key);
    if (!current || current.token !== attempt.token || current.state !== "pending") return false;
    this.entries.set(attempt.key, { ...current, state });
    return true;
  }
  apply(thread: MailThread): MailThread {
    const entry = this.entries.get(threadReadKey(thread));
    return entry && entry.state !== "failed" && !newerMessage(thread, entry.thread) ? { ...thread, unread: entry.unread } : thread;
  }
  failures(): MailThread[] { return Array.from(this.entries.values()).filter(entry => entry.state === "failed").map(entry => entry.thread); }
}
