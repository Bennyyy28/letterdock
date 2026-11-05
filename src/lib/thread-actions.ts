import { mailbox, MailError, requireId } from './mailboxes';
import { reserveResendSlot } from './reader';
import type { ThreadAction, ThreadActionResult } from './mail-types';

const actions: readonly ThreadAction[] = ['archive', 'trash', 'unread', 'inbox'];
export function parseThreadAction(value: unknown): ThreadAction {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 ||
      !Object.hasOwn(value, 'action') || !actions.includes((value as {action: ThreadAction}).action)) {
    throw new MailError('Choose Archive, Trash, Mark unread, or Move to inbox.', 400);
  }
  return (value as {action: ThreadAction}).action;
}

/** One small, explicit action; no caller-selected sender, folder, labels, or inbox ID. */
export async function threadActionBody(request: Request): Promise<ThreadAction> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    throw new MailError('Use a JSON inbox action.', 415);
  }
  if (Number(request.headers.get('content-length') || 0) > 1024) throw new MailError('The inbox action is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new MailError('The inbox action is empty.', 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024) { await reader.cancel(); throw new MailError('The inbox action is too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new MailError('The inbox action is invalid.', 400); }
  return parseThreadAction(value);
}

/** A user-clicked thread action. Trash is reversible; no permanent-delete endpoint. */
export async function manageThread(inboxKey: string, threadId: string, action: ThreadAction): Promise<ThreadActionResult> {
  const box = mailbox(inboxKey);
  requireId(threadId);
  parseThreadAction({action});
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new MailError('The mail connection needs attention.', 503);
  const patch = action === 'unread' ? {read: false} : {folder: action};
  await reserveResendSlot();
  let response: Response;
  try {
    response = await fetch(`https://api.resend.com/inboxes/${box.id}/threads/${threadId}`, {
      method: 'PATCH', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(patch), cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
  } catch { throw new MailError('This change could not be saved. Try again.'); }
  if (response.status === 401 || response.status === 403) throw new MailError('The mail connection cannot save inbox changes.', 503);
  if (response.status === 404) throw new MailError('This conversation could not be found.', 404);
  if (response.status === 429) throw new MailError('Resend is busy. Try again shortly.', 429);
  if (!response.ok) throw new MailError('This change could not be saved. Try again.');
  let result: {id?: unknown; read?: unknown; folder?: unknown} | null;
  try { result = await response.json(); }
  catch { throw new MailError('Resend did not confirm this change. Refresh and try again.'); }
  if (!result || result.id !== threadId || (action === 'unread' ? result.read !== false : result.folder !== action)) {
    throw new MailError('Resend did not confirm this change. Refresh and try again.');
  }
  return action === 'unread' ? {id: threadId, read: false} : {id: threadId, folder: action};
}
