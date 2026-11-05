import type { Mailbox } from './mail-types';
export class MailError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireId(id: string) { if (!UUID.test(id)) throw new MailError('Invalid message identifier.', 400); return id; }

/** Operator configuration, never request input. Empty configuration stays disconnected. */
export function parseMailboxes(raw: string | undefined): Mailbox[] {
  if (!raw?.trim()) return [];
  const invalid = () => new MailError('Check RESEND_INBOXES in the server configuration.', 503);
  if (raw.length > 20000) throw invalid();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw invalid(); }
  if (!Array.isArray(value) || value.length > 10) throw invalid();
  const keys = new Set<string>(), ids = new Set<string>(), addresses = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some(k => !['key','id','name','address','description'].includes(k))) throw invalid();
    const {key,id,name,address,description = ''} = item;
    if (typeof key !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(key) || ['all','constructor','prototype'].includes(key) || keys.has(key) ||
        typeof id !== 'string' || !UUID.test(id) || ids.has(id.toLowerCase()) ||
        typeof name !== 'string' || !name.trim() || name.length > 60 ||
        typeof address !== 'string' || address.length > 254 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address) || addresses.has(address.toLowerCase()) ||
        typeof description !== 'string' || description.length > 160) throw invalid();
    keys.add(key);ids.add(id.toLowerCase());addresses.add(address.toLowerCase());
    return {key,id,name:name.trim(),address,description};
  });
}
export const MAILBOXES: Mailbox[] = parseMailboxes(process.env.RESEND_INBOXES);
export function mailbox(key: string) {
  const box = MAILBOXES.find(b => b.key === key);
  if (!box) throw new MailError('Unknown inbox.', 400);
  return box;
}
export function sendingMailbox() {
  const key = process.env.LETTERDOCK_SENDING_INBOX;
  if (!key) throw new MailError('Sending is disabled for this installation.', 403);
  return mailbox(key);
}
