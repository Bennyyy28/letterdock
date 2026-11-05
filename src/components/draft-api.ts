import type { DraftInput, MailDraft } from "../lib/mail-types";

export class DraftRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function draftRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, cache: "no-store", credentials: "same-origin", headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "This request couldn’t finish. Please try again.";
    throw new DraftRequestError(response.status, message);
  }
  return body as T;
}

export interface DraftFields { to: string; cc: string; bcc: string; subject: string; text: string; }
export const emptyDraftFields: DraftFields = { to: "", cc: "", bcc: "", subject: "", text: "" };
export function draftFields(draft: MailDraft): DraftFields { return { to: draft.to.join(", "), cc: draft.cc.join(", "), bcc: draft.bcc.join(", "), subject: draft.subject, text: draft.text }; }
// Respect quoted display names while accepting comma-, semicolon-, or newline-separated addresses.
export function splitRecipients(value: string): string[] {
  const result: string[] = []; let current = ""; let quoted = false; let angle = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '"' && value[index - 1] !== "\\") quoted = !quoted;
    if (!quoted && character === "<") angle = true;
    if (!quoted && character === ">") angle = false;
    if (!quoted && !angle && /[,;\n]/.test(character)) { if (current.trim()) result.push(current.trim()); current = ""; }
    else current += character;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}
export function draftInput(fields: DraftFields): DraftInput { return { to: splitRecipients(fields.to), cc: splitRecipients(fields.cc), bcc: splitRecipients(fields.bcc), subject: fields.subject, text: fields.text }; }
