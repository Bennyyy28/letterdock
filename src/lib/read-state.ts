import { mailbox, MailError, requireId } from './mailboxes';
import { reserveResendSlot } from './reader';

/** Human-opened conversations may only be marked read; no folder or sender input. */
export async function markThreadRead(inboxKey: string, threadId: string): Promise<{ read: true }> {
  const box = mailbox(inboxKey);
  requireId(threadId);
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new MailError('The mail connection needs attention.', 503);
  await reserveResendSlot();
  let response: Response;
  try {
    response = await fetch(`https://api.resend.com/inboxes/${box.id}/threads/${threadId}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }), cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
  } catch { throw new MailError('Read status could not be saved. Please try again.'); }
  if (response.status === 401 || response.status === 403) throw new MailError('The mail connection cannot save read status.', 503);
  if (response.status === 404) throw new MailError('This conversation could not be found.', 404);
  if (response.status === 429) throw new MailError('Resend is busy. Try saving read status again shortly.', 429);
  if (!response.ok) throw new MailError('Read status could not be saved. Please try again.');
  let result: { id?: unknown; read?: unknown } | null;
  try { result = await response.json(); } catch { throw new MailError('Resend did not confirm the saved read status. Please try again.'); }
  if (!result || result.id !== threadId || result.read !== true) throw new MailError('Resend did not confirm the saved read status. Please try again.');
  return { read: true };
}

/** Accept empty incoming streams, but reject body bytes before any provider write. */
export async function requireEmptyReadBody(request: Request): Promise<void> {
  // Some runtimes represent even a bodyless POST as an empty stream.
  if (!request.body) return;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength) {
        await reader.cancel();
        throw new MailError('This read-status request does not accept a body.', 400);
      }
    }
  } finally { reader.releaseLock(); }
}
