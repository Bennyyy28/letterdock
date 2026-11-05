export type InboxKey = string;
export type Folder = "inbox" | "sent" | "archive" | "spam" | "trash";
export interface Mailbox { key: Exclude<InboxKey,"all">; id: string; name: string; address: string; description: string; }
export interface MailThread { id: string; inboxId: string; inboxKey: Exclude<InboxKey,"all">; subject: string; sender: string; preview: string; updatedAt: string; unread: boolean; messageCount: number; folder: Folder; }
export interface MailAttachment { id: string; filename: string; size?: number; contentType?: string; downloadUrl?: string; }
export interface MailMessage { id: string; from: string; to: string[]; cc: string[]; subject: string; text: string; safeHtml?: string; receivedAt: string; attachments: MailAttachment[]; direction: "inbound" | "outbound"; }
export interface ThreadDetail { thread: MailThread; messages: MailMessage[]; }
export interface MailStatus { connected: boolean; mode: "live" | "setup"; authenticated: boolean; requiresLogin: boolean; mailboxes: Omit<Mailbox,"id">[]; sendingEnabled: boolean; sendingInbox: string | null; ownerName: string; }
export interface ThreadList { threads: MailThread[]; hasMore: boolean; nextCursor?: string; }

export interface MailDraftSummary { id: string; type: "standalone" | "reply"; to: string[]; cc: string[]; bcc: string[]; subject: string; snippet: string; threadId: string | null; replyToEmailId: string | null; updatedAt: string; attachments: MailAttachment[]; }
export interface MailDraft extends MailDraftSummary { text: string; hasHtml: boolean; emailId: string | null; }
export interface DraftInput { to?: string[]; cc?: string[]; bcc?: string[]; subject?: string; text?: string; threadId?: string; replyToEmailId?: string; }
export interface DraftList { drafts: MailDraftSummary[]; hasMore: boolean; nextCursor?: string; }
export interface DraftReview { draft: MailDraft; reviewToken: string; expiresAt: string; }

export type ThreadAction = "archive" | "trash" | "unread" | "inbox";
export type ThreadActionResult = { id: string; read: false } | { id: string; folder: "archive" | "trash" | "inbox" };
